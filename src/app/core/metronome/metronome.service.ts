import { DestroyRef, Injectable, NgZone, computed, inject, signal } from '@angular/core';

import { LibraryStorageService } from '../../shared/storage/library-storage.service';
import { DEFAULT_APP_PREFERENCES } from '../../shared/models/setlist.model';
import { DEFAULT_METRONOME_SETTINGS, type MetronomeSettings, type RhythmOption, type Song, type SubdivisionOption } from '../../shared/models/song.model';
import {
  calculateTapTempo,
  clampBeatsPerBar,
  clampTempo,
  clampVolume,
  emphasisForTick,
  moveItem,
  normalizeMetronomeSettings,
  pulseDurationSeconds,
  pulsesPerBeatForSettings,
  type ScheduledTick,
  type VisualizerSnapshot,
} from './metronome.helpers';
import { scheduleClickVoice } from './click-voice';

const SCHEDULER_WAKE_MS = 25;
const LOOKAHEAD_SECONDS = 0.12;
const START_LATENCY_SECONDS = 0.08;
const SILENT_GAIN = 0.0001;

@Injectable({ providedIn: 'root' })
export class MetronomeService {
  private readonly storage = inject(LibraryStorageService);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  readonly tempo = signal(DEFAULT_METRONOME_SETTINGS.tempo);
  readonly beatsPerBar = signal(DEFAULT_METRONOME_SETTINGS.beatsPerBar);
  readonly subdivision = signal(DEFAULT_METRONOME_SETTINGS.subdivision);
  readonly rhythm = signal<RhythmOption>(DEFAULT_METRONOME_SETTINGS.rhythm);
  readonly volume = signal(DEFAULT_METRONOME_SETTINGS.volume);

  readonly isPlaying = signal(false);
  readonly currentBeatInBar = signal(1);
  readonly currentPulseInBeat = signal(1);
  readonly activeSongId = signal<string | null>(null);
  readonly activeSongName = signal<string | null>(null);
  readonly activeSetlistId = signal<string | null>(null);
  readonly activeSetlistName = signal<string | null>(null);
  readonly activeSetlistIndex = signal(0);

  private readonly beatProgress = signal(0);
  private readonly flashStrength = signal(0);
  private readonly lastEmphasis = signal<'bar' | 'beat' | 'subdivision'>('bar');

  readonly currentSettings = computed<MetronomeSettings>(() =>
    normalizeMetronomeSettings({
      tempo: this.tempo(),
      beatsPerBar: this.beatsPerBar(),
      subdivision: this.subdivision(),
      rhythm: this.rhythm(),
      volume: this.volume(),
    }),
  );

  readonly pulsesPerBeat = computed(() => pulsesPerBeatForSettings(this.currentSettings()));
  readonly canAdvanceSetlist = computed(() => this.activeSetlistSongIds().length > this.activeSetlistIndex() + 1);
  readonly visualizer = computed<VisualizerSnapshot>(() => {
    const progress = this.beatProgress();

    return {
      isPlaying: this.isPlaying(),
      currentBeatInBar: this.currentBeatInBar(),
      beatsPerBar: this.beatsPerBar(),
      currentPulseInBeat: this.currentPulseInBeat(),
      pulsesPerBeat: this.pulsesPerBeat(),
      beatProgress: progress,
      pendulumOffset: Math.sin((progress * Math.PI * 2) - (Math.PI / 2)),
      flashStrength: this.flashStrength(),
      emphasis: this.lastEmphasis(),
      nextBeatInBar: this.visualQueue[0]?.beatInBar ?? null,
    };
  });

  private readonly activeSetlistSongIds = signal<string[]>([]);
  private readonly tapHistory = signal<number[]>([]);

  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private transportGain: GainNode | null = null;
  private schedulerWorker: Worker | null = null;
  private fallbackTimerId: number | null = null;
  private animationFrameId: number | null = null;
  private preferencesTimeoutId: number | null = null;

  private beatCursor = 0;
  private pulseCursor = 0;
  private nextPulseTime = 0;
  private hasTriggeredPlayback = false;
  private lastTriggeredTickTime = 0;
  private visualQueue: ScheduledTick[] = [];

  constructor() {
    void this.restorePreferences();
    this.destroyRef.onDestroy(() => this.dispose());
  }

  async play(): Promise<void> {
    if (this.isPlaying()) {
      return;
    }

    const context = await this.ensureAudioContext();

    if (!context) {
      return;
    }

    this.isPlaying.set(true);
    this.openTransportGate();

    if (!this.hasTriggeredPlayback) {
      this.resetPosition();
    } else {
      this.prepareNextCursorFromDisplay();
    }

    this.nextPulseTime = context.currentTime + START_LATENCY_SECONDS;
    this.visualQueue = [];
    this.beatProgress.set(0);
    this.flashStrength.set(0);
    this.schedulePendingPulses();
    this.startScheduler();
    this.startVisualizerLoop();
  }

  pause(): void {
    if (!this.isPlaying()) {
      return;
    }

    this.isPlaying.set(false);
    this.closeTransportGate();
    this.stopScheduler();
    this.stopVisualizerLoop();
    this.visualQueue = [];
    this.prepareNextCursorFromDisplay();
    this.beatProgress.set(0);
    this.flashStrength.set(0);
  }

  stop(): void {
    this.pause();
    this.resetPosition();
  }

  setTempo(value: number): void {
    this.commitSettings({ ...this.currentSettings(), tempo: clampTempo(value) });
  }

  nudgeTempo(amount: number): void {
    this.setTempo(this.tempo() + amount);
  }

  setBeatsPerBar(value: number): void {
    this.commitSettings({ ...this.currentSettings(), beatsPerBar: clampBeatsPerBar(value) });
  }

  setSubdivision(value: SubdivisionOption): void {
    this.commitSettings({ ...this.currentSettings(), subdivision: value, rhythm: this.rhythm() });
  }

  setRhythm(value: RhythmOption): void {
    this.commitSettings({ ...this.currentSettings(), rhythm: value, subdivision: this.subdivision() });
  }

  setVolume(value: number): void {
    this.commitSettings({ ...this.currentSettings(), volume: clampVolume(value) });
  }

  tapTempo(): number | null {
    const timestamp = performance.now();
    const history = [...this.tapHistory(), timestamp].slice(-8);
    const tempo = calculateTapTempo(history);
    this.tapHistory.set(history);

    if (tempo !== null) {
      this.setTempo(tempo);
    }

    return tempo;
  }

  async loadSong(songOrId: Song | string, preserveSetlist = false): Promise<Song | null> {
    const song = typeof songOrId === 'string' ? await this.storage.getSong(songOrId) : songOrId;

    if (!song) {
      return null;
    }

    const wasPlaying = this.isPlaying();

    if (wasPlaying) {
      this.pause();
    }

    this.commitSettings(song);
    this.activeSongId.set(song.id);
    this.activeSongName.set(song.name);

    if (!preserveSetlist) {
      this.activeSetlistId.set(null);
      this.activeSetlistName.set(null);
      this.activeSetlistIndex.set(0);
      this.activeSetlistSongIds.set([]);
    }

    this.schedulePreferencesSave();

    if (wasPlaying) {
      await this.play();
    }

    return song;
  }

  async saveCurrentAsSong(name: string): Promise<Song> {
    const song = await this.storage.saveSong({
      name: name.trim(),
      ...this.currentSettings(),
    });

    this.activeSongId.set(song.id);
    this.activeSongName.set(song.name);
    this.schedulePreferencesSave();
    return song;
  }

  async startSetlist(setlistId: string, startIndex = 0): Promise<void> {
    const setlist = await this.storage.getResolvedSetlist(setlistId);

    if (!setlist) {
      return;
    }

    const safeIndex = Math.max(0, Math.min(startIndex, Math.max(setlist.entries.length - 1, 0)));
    this.activeSetlistId.set(setlist.id);
    this.activeSetlistName.set(setlist.name);
    this.activeSetlistIndex.set(safeIndex);
    this.activeSetlistSongIds.set([...setlist.songIds]);
    this.schedulePreferencesSave();

    const activeEntry = setlist.entries[safeIndex];

    if (activeEntry) {
      await this.loadSong(activeEntry.song, true);
    }
  }

  async nextSong(): Promise<void> {
    if (!this.activeSetlistId() || !this.canAdvanceSetlist()) {
      return;
    }

    await this.startSetlist(this.activeSetlistId()!, this.activeSetlistIndex() + 1);
  }

  async reorderSetlistSongs(setlistId: string, songIds: string[]): Promise<void> {
    const updatedSetlist = await this.storage.reorderSetlistSongs(setlistId, songIds);

    if (!updatedSetlist) {
      return;
    }

    if (this.activeSetlistId() === updatedSetlist.id) {
      this.activeSetlistSongIds.set([...updatedSetlist.songIds]);

      if (this.activeSongId()) {
        const nextIndex = updatedSetlist.songIds.indexOf(this.activeSongId()!);
        this.activeSetlistIndex.set(nextIndex >= 0 ? nextIndex : 0);
      }

      this.schedulePreferencesSave();
    }
  }

  moveActiveSetlistSong(fromIndex: number, toIndex: number): string[] {
    return moveItem(this.activeSetlistSongIds(), fromIndex, toIndex);
  }

  private commitSettings(settings: Partial<MetronomeSettings>): void {
    const normalized = normalizeMetronomeSettings(settings);
    this.tempo.set(normalized.tempo);
    this.beatsPerBar.set(normalized.beatsPerBar);
    this.subdivision.set(normalized.subdivision);
    this.rhythm.set(normalized.rhythm);
    this.volume.set(normalized.volume);
    this.syncMasterGain();
    this.syncCursorBounds();
    this.schedulePreferencesSave();
  }

  private syncCursorBounds(): void {
    this.beatCursor = Math.min(this.beatCursor, this.beatsPerBar() - 1);
    this.pulseCursor = Math.min(this.pulseCursor, this.pulsesPerBeat() - 1);
    this.currentBeatInBar.set(Math.min(this.currentBeatInBar(), this.beatsPerBar()));
    this.currentPulseInBeat.set(Math.min(this.currentPulseInBeat(), this.pulsesPerBeat()));
  }

  private async ensureAudioContext(): Promise<AudioContext | null> {
    if (typeof window === 'undefined') {
      return null;
    }

    if (!this.audioContext) {
      const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (!AudioContextCtor) {
        return null;
      }

      this.audioContext = new AudioContextCtor();
      this.masterGain = this.audioContext.createGain();
      this.transportGain = this.audioContext.createGain();

      this.masterGain.gain.value = this.volume();
      this.transportGain.gain.value = SILENT_GAIN;

      this.masterGain.connect(this.transportGain);
      this.transportGain.connect(this.audioContext.destination);
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    this.syncMasterGain();
    return this.audioContext;
  }

  private startScheduler(): void {
    if (typeof Worker !== 'undefined') {
      const worker = this.getSchedulerWorker();
      worker.postMessage({ type: 'start', intervalMs: SCHEDULER_WAKE_MS });
      return;
    }

    this.startFallbackScheduler();
  }

  private stopScheduler(): void {
    this.schedulerWorker?.postMessage({ type: 'stop' });

    if (this.fallbackTimerId !== null) {
      clearTimeout(this.fallbackTimerId);
      this.fallbackTimerId = null;
    }
  }

  private getSchedulerWorker(): Worker {
    if (!this.schedulerWorker) {
      this.schedulerWorker = new Worker(new URL('./scheduler.worker', import.meta.url), { type: 'module' });
      this.schedulerWorker.addEventListener('message', () => this.schedulePendingPulses());
    }

    return this.schedulerWorker;
  }

  private startFallbackScheduler(): void {
    const tick = () => {
      this.schedulePendingPulses();

      if (!this.isPlaying()) {
        this.fallbackTimerId = null;
        return;
      }

      this.fallbackTimerId = window.setTimeout(tick, SCHEDULER_WAKE_MS);
    };

    if (this.fallbackTimerId === null) {
      this.fallbackTimerId = window.setTimeout(tick, SCHEDULER_WAKE_MS);
    }
  }

  private schedulePendingPulses(): void {
    const context = this.audioContext;
    const output = this.masterGain;

    if (!context || !output || !this.isPlaying()) {
      return;
    }

    while (this.nextPulseTime < context.currentTime + LOOKAHEAD_SECONDS) {
      const settings = this.currentSettings();
      const pulsesPerBeat = pulsesPerBeatForSettings(settings);
      const beatInBar = this.beatCursor + 1;
      const pulseInBeat = this.pulseCursor + 1;
      const emphasis = emphasisForTick(beatInBar, pulseInBeat);

      scheduleClickVoice(context, {
        output,
        when: this.nextPulseTime,
        volume: settings.volume,
        emphasis,
      });

      this.visualQueue.push({
        time: this.nextPulseTime,
        beatInBar,
        pulseInBeat,
        pulsesPerBeat,
        emphasis,
      });

      this.nextPulseTime += pulseDurationSeconds(settings, this.pulseCursor);
      this.pulseCursor += 1;

      if (this.pulseCursor >= pulsesPerBeat) {
        this.pulseCursor = 0;
        this.beatCursor = (this.beatCursor + 1) % settings.beatsPerBar;
      }
    }
  }

  private startVisualizerLoop(): void {
    if (this.animationFrameId !== null) {
      return;
    }

    const render = () => {
      if (!this.isPlaying()) {
        this.animationFrameId = null;
        return;
      }

      const currentTime = this.audioContext?.currentTime ?? 0;

      while (this.visualQueue.length > 0 && this.visualQueue[0].time <= currentTime + 0.001) {
        const tick = this.visualQueue.shift()!;
        this.currentBeatInBar.set(tick.beatInBar);
        this.currentPulseInBeat.set(tick.pulseInBeat);
        this.lastTriggeredTickTime = tick.time;
        this.lastEmphasis.set(tick.emphasis);
        this.flashStrength.set(1);
        this.hasTriggeredPlayback = true;
      }

      const nextTick = this.visualQueue[0] ?? null;
      const defaultInterval = pulseDurationSeconds(this.currentSettings(), Math.max(0, this.currentPulseInBeat() - 1));
      const interval = nextTick ? Math.max(nextTick.time - this.lastTriggeredTickTime, 0.001) : defaultInterval;
      const progress = this.lastTriggeredTickTime > 0 ? Math.min(1, Math.max(0, (currentTime - this.lastTriggeredTickTime) / interval)) : 0;

      this.beatProgress.set(progress);
      this.flashStrength.set(Math.max(0, 1 - progress * 1.6));
      this.animationFrameId = requestAnimationFrame(render);
    };

    this.zone.runOutsideAngular(() => {
      this.animationFrameId = requestAnimationFrame(render);
    });
  }

  private stopVisualizerLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private openTransportGate(): void {
    const context = this.audioContext;
    const transportGain = this.transportGain;

    if (!context || !transportGain) {
      return;
    }

    transportGain.gain.cancelScheduledValues(context.currentTime);
    transportGain.gain.setValueAtTime(Math.max(SILENT_GAIN, transportGain.gain.value), context.currentTime);
    transportGain.gain.exponentialRampToValueAtTime(1, context.currentTime + 0.01);
  }

  private closeTransportGate(): void {
    const context = this.audioContext;
    const transportGain = this.transportGain;

    if (!context || !transportGain) {
      return;
    }

    transportGain.gain.cancelScheduledValues(context.currentTime);
    transportGain.gain.setValueAtTime(Math.max(SILENT_GAIN, transportGain.gain.value), context.currentTime);
    transportGain.gain.exponentialRampToValueAtTime(SILENT_GAIN, context.currentTime + 0.015);
  }

  private syncMasterGain(): void {
    const context = this.audioContext;
    const gainNode = this.masterGain;

    if (!context || !gainNode) {
      return;
    }

    gainNode.gain.cancelScheduledValues(context.currentTime);
    gainNode.gain.setValueAtTime(Math.max(SILENT_GAIN, gainNode.gain.value), context.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(SILENT_GAIN, this.volume()), context.currentTime + 0.01);
  }

  private resetPosition(): void {
    this.beatCursor = 0;
    this.pulseCursor = 0;
    this.currentBeatInBar.set(1);
    this.currentPulseInBeat.set(1);
    this.lastTriggeredTickTime = 0;
    this.hasTriggeredPlayback = false;
  }

  private prepareNextCursorFromDisplay(): void {
    if (!this.hasTriggeredPlayback) {
      this.beatCursor = 0;
      this.pulseCursor = 0;
      return;
    }

    const pulsesPerBeat = this.pulsesPerBeat();
    let nextBeatCursor = this.currentBeatInBar() - 1;
    let nextPulseCursor = this.currentPulseInBeat();

    if (nextPulseCursor >= pulsesPerBeat) {
      nextPulseCursor = 0;
      nextBeatCursor = (nextBeatCursor + 1) % this.beatsPerBar();
    }

    this.beatCursor = nextBeatCursor;
    this.pulseCursor = nextPulseCursor;
  }

  private schedulePreferencesSave(): void {
    if (this.preferencesTimeoutId !== null) {
      clearTimeout(this.preferencesTimeoutId);
    }

    this.preferencesTimeoutId = window.setTimeout(() => {
      this.preferencesTimeoutId = null;
      void this.storage.savePreferences({
        lastTransport: this.currentSettings(),
        lastSongId: this.activeSongId(),
        lastSongName: this.activeSongName(),
        lastSetlistId: this.activeSetlistId(),
        lastSetlistName: this.activeSetlistName(),
        activeSetlistIndex: this.activeSetlistIndex(),
      });
    }, 160);
  }

  private async restorePreferences(): Promise<void> {
    const preferences = await this.storage.loadPreferences();
    this.commitSettings(preferences.lastTransport ?? DEFAULT_APP_PREFERENCES.lastTransport);
    this.activeSongId.set(preferences.lastSongId);
    this.activeSongName.set(preferences.lastSongName);
    this.activeSetlistId.set(preferences.lastSetlistId);
    this.activeSetlistName.set(preferences.lastSetlistName);
    this.activeSetlistIndex.set(preferences.activeSetlistIndex);

    if (preferences.lastSetlistId) {
      const setlist = await this.storage.getSetlist(preferences.lastSetlistId);
      this.activeSetlistSongIds.set(setlist?.songIds ?? []);
    }
  }

  private dispose(): void {
    this.stopScheduler();
    this.stopVisualizerLoop();

    if (this.preferencesTimeoutId !== null) {
      clearTimeout(this.preferencesTimeoutId);
      this.preferencesTimeoutId = null;
    }

    this.schedulerWorker?.terminate();
    this.schedulerWorker = null;
  }
}

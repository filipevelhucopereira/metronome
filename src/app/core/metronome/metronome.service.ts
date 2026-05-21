import { DestroyRef, Injectable, NgZone, computed, inject, signal } from '@angular/core';

import { LibraryStorageService } from '../../shared/storage/library-storage.service';
import { DEFAULT_APP_PREFERENCES, type AppPreferences } from '../../shared/models/setlist.model';
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
  type VisualizerMotion,
  type VisualizerStructure,
} from './metronome.helpers';
import { scheduleClickVoice } from './click-voice';

const SCHEDULER_WAKE_MS = 25;
const LOOKAHEAD_SECONDS = 0.12;
const START_LATENCY_SECONDS = 0.08;
const SILENT_GAIN = 0.0001;
const VISUAL_TICK_TOLERANCE_SECONDS = 0.001;

type SilentModeSupportState = 'idle' | 'active' | 'unsupported' | 'failed';

type RestoredSetlistSessionResult =
  | {
      found: true;
      setlist: { id: string; name: string; songIds: string[] };
      activeSetlistIndex: number;
    }
  | { found: false };

interface PlaybackAudioSession {
  type: string;
}

interface NavigatorWithAudioSession extends Navigator {
  audioSession?: PlaybackAudioSession;
}

function detectAppleMobileDevice(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const userAgent = navigator.userAgent ?? '';
  const platform = navigator.platform ?? '';
  const maxTouchPoints = navigator.maxTouchPoints ?? 0;

  return /iPad|iPhone|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

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
  readonly isAppleMobileDevice = signal(detectAppleMobileDevice());
  readonly silentModeSupportState = signal<SilentModeSupportState>('idle');

  private readonly beatProgress = signal(0);
  private readonly flashStrength = signal(0);
  private readonly lastEmphasis = signal<'bar' | 'beat' | 'subdivision'>('bar');
  private readonly nextBeatInBar = signal<number | null>(null);
  private readonly audioActivationError = signal<string | null>(null);

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
  readonly audioSupportMessage = computed(() => {
    const activationError = this.audioActivationError();

    if (activationError) {
      return activationError;
    }

    if (!this.isAppleMobileDevice()) {
      return null;
    }

    switch (this.silentModeSupportState()) {
      case 'unsupported':
        return 'This iPhone browser does not expose silent-mode playback controls, so the metronome may stay muted while Silent Mode is enabled.';
      case 'failed':
        return 'Silent-mode playback could not be activated on this iPhone. Turn Silent Mode off and try again.';
      default:
        return null;
    }
  });
  readonly visualizerStructure = computed<VisualizerStructure>(() => ({
    isPlaying: this.isPlaying(),
    currentBeatInBar: this.currentBeatInBar(),
    beatsPerBar: this.beatsPerBar(),
    currentPulseInBeat: this.currentPulseInBeat(),
    pulsesPerBeat: this.pulsesPerBeat(),
    emphasis: this.lastEmphasis(),
    nextBeatInBar: this.nextBeatInBar(),
  }));
  readonly visualizerMotion = computed<VisualizerMotion>(() => {
    const progress = this.beatProgress();

    return {
      beatProgress: progress,
      pendulumOffset: Math.sin((progress * Math.PI * 2) - (Math.PI / 2)),
      flashStrength: this.flashStrength(),
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
  private visualQueueHead = 0;

  constructor() {
    void this.restorePreferences();
    this.destroyRef.onDestroy(() => this.dispose());
  }

  async play(): Promise<void> {
    if (this.isPlaying()) {
      return;
    }

    this.audioActivationError.set(null);

    const context = await this.ensureAudioContext();

    if (!context || context.state !== 'running') {
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
    this.resetVisualQueue();
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
    this.resetPlaybackAudioSession();
    this.resetVisualQueue();
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

    await this.applyLoadedSong(song, { preserveSetlist, persistPreferences: true });

    return song;
  }

  async saveCurrentAsSong(name: string): Promise<Song> {
    const song = await this.storage.saveSong({
      name: name.trim(),
      ...this.currentSettings(),
    });

    this.applyActiveSongSession(song.id, song.name);
    this.schedulePreferencesSave();
    return song;
  }

  async startSetlist(setlistId: string, startIndex = 0): Promise<void> {
    const setlist = await this.storage.getResolvedSetlist(setlistId);

    if (!setlist) {
      return;
    }

    const safeIndex = this.clampSetlistIndex(startIndex, setlist.entries.length);
    this.applyActiveSetlistSession(setlist, safeIndex);

    const activeEntry = setlist.entries[safeIndex];

    if (activeEntry) {
      await this.applyLoadedSong(activeEntry.song, { preserveSetlist: true, persistPreferences: false });
    }

    this.schedulePreferencesSave();
  }

  async nextSong(): Promise<void> {
    if (!this.activeSetlistId() || !this.canAdvanceSetlist()) {
      return;
    }

    await this.startSetlist(this.activeSetlistId()!, this.activeSetlistIndex() + 1);
  }

  async reorderSetlistSongs(setlistId: string, songIds: string[]): Promise<void> {
    if (this.activeSetlistId() !== setlistId) {
      return;
    }

    this.activeSetlistSongIds.set([...songIds]);

    if (this.activeSongId()) {
      const nextIndex = songIds.indexOf(this.activeSongId()!);
      this.activeSetlistIndex.set(nextIndex >= 0 ? nextIndex : 0);
    }

    this.schedulePreferencesSave();
  }

  moveActiveSetlistSong(fromIndex: number, toIndex: number): string[] {
    return moveItem(this.activeSetlistSongIds(), fromIndex, toIndex);
  }

  private commitSettings(settings: Partial<MetronomeSettings>, persistPreferences = true): void {
    const normalized = normalizeMetronomeSettings(settings);
    this.tempo.set(normalized.tempo);
    this.beatsPerBar.set(normalized.beatsPerBar);
    this.subdivision.set(normalized.subdivision);
    this.rhythm.set(normalized.rhythm);
    this.volume.set(normalized.volume);
    this.syncMasterGain();
    this.syncCursorBounds();

    if (persistPreferences) {
      this.schedulePreferencesSave();
    }
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

    this.configurePlaybackAudioSession();

    if (!this.audioContext) {
      const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (!AudioContextCtor) {
        this.markAudioActivationFailure('This browser does not expose Web Audio output for the metronome.');
        return null;
      }

      try {
        this.audioContext = new AudioContextCtor();
      } catch (error) {
        console.error('[Metronome] Failed to create an AudioContext.', error);
        this.markAudioActivationFailure('Audio playback could not be initialized in this browser.');
        return null;
      }

      this.masterGain = this.audioContext.createGain();
      this.transportGain = this.audioContext.createGain();

      this.masterGain.gain.value = this.volume();
      this.transportGain.gain.value = SILENT_GAIN;

      this.masterGain.connect(this.transportGain);
      this.transportGain.connect(this.audioContext.destination);
    }

    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (error) {
        console.error('[Metronome] AudioContext.resume() failed.', error);
        this.markAudioActivationFailure(
          this.isAppleMobileDevice()
            ? 'Audio playback could not start. If your iPhone is in Silent Mode, turn it off and try again.'
            : 'Audio playback could not start in this browser.',
        );
        return null;
      }
    }

    if (this.audioContext.state !== 'running') {
      this.markAudioActivationFailure(
        this.isAppleMobileDevice()
          ? 'Audio playback is still suspended on this iPhone browser. Turn Silent Mode off and try again.'
          : 'Audio playback is still suspended in this browser.',
      );
      return null;
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

    if (!context || !output || !this.isPlaying() || context.state !== 'running') {
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
      this.syncNextBeatInBar();

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
      let tick = this.dequeueDueVisualTick(currentTime);

      while (tick) {
        this.currentBeatInBar.set(tick.beatInBar);
        this.currentPulseInBeat.set(tick.pulseInBeat);
        this.lastTriggeredTickTime = tick.time;
        this.lastEmphasis.set(tick.emphasis);
        this.flashStrength.set(1);
        this.hasTriggeredPlayback = true;
        tick = this.dequeueDueVisualTick(currentTime);
      }

      const nextTick = this.peekVisualTick();
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
    this.nextBeatInBar.set(null);
  }

  private resetVisualQueue(): void {
    this.visualQueue = [];
    this.visualQueueHead = 0;
    this.nextBeatInBar.set(null);
  }

  private peekVisualTick(): ScheduledTick | null {
    return this.visualQueue[this.visualQueueHead] ?? null;
  }

  private dequeueDueVisualTick(currentTime: number): ScheduledTick | null {
    const tick = this.peekVisualTick();

    if (!tick || tick.time > currentTime + VISUAL_TICK_TOLERANCE_SECONDS) {
      return null;
    }

    this.visualQueueHead += 1;
    this.compactVisualQueue();
    this.syncNextBeatInBar();
    return tick;
  }

  private compactVisualQueue(): void {
    if (this.visualQueueHead === this.visualQueue.length) {
      this.resetVisualQueue();
      return;
    }

    if (this.visualQueueHead > 32 && this.visualQueueHead * 2 >= this.visualQueue.length) {
      this.visualQueue = this.visualQueue.slice(this.visualQueueHead);
      this.visualQueueHead = 0;
    }
  }

  private syncNextBeatInBar(): void {
    this.nextBeatInBar.set(this.peekVisualTick()?.beatInBar ?? null);
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

  private clampSetlistIndex(index: number, songCount: number): number {
    return Math.max(0, Math.min(index, Math.max(songCount - 1, 0)));
  }

  private clearActiveSetlistSession(): void {
    this.activeSetlistId.set(null);
    this.activeSetlistName.set(null);
    this.activeSetlistIndex.set(0);
    this.activeSetlistSongIds.set([]);
  }

  private applyActiveSetlistSession(
    setlist: { id: string; name: string; songIds: string[] },
    activeSetlistIndex: number,
  ): void {
    this.activeSetlistId.set(setlist.id);
    this.activeSetlistName.set(setlist.name);
    this.activeSetlistIndex.set(activeSetlistIndex);
    this.activeSetlistSongIds.set([...setlist.songIds]);
  }

  private applyActiveSongSession(songId: string | null, songName: string | null): void {
    this.activeSongId.set(songId);
    this.activeSongName.set(songName);
  }

  private async applyLoadedSong(
    song: Song,
    options: { preserveSetlist: boolean; persistPreferences: boolean },
  ): Promise<void> {
    const wasPlaying = this.isPlaying();

    if (wasPlaying) {
      this.pause();
    }

    this.commitSettings(song, false);
    this.applyActiveSongSession(song.id, song.name);

    if (!options.preserveSetlist) {
      this.clearActiveSetlistSession();
    }

    if (options.persistPreferences) {
      this.schedulePreferencesSave();
    }

    if (wasPlaying) {
      await this.play();
    }
  }

  private createPreferenceSnapshot(): AppPreferences {
    return {
      lastTransport: this.currentSettings(),
      lastSongId: this.activeSongId(),
      lastSongName: this.activeSongName(),
      lastSetlistId: this.activeSetlistId(),
      lastSetlistName: this.activeSetlistName(),
      activeSetlistIndex: this.activeSetlistIndex(),
    };
  }

  private clearScheduledPreferencesSave(): void {
    if (this.preferencesTimeoutId === null) {
      return;
    }

    clearTimeout(this.preferencesTimeoutId);
    this.preferencesTimeoutId = null;
  }

  private persistCurrentPreferences(): void {
    void this.storage.savePreferences(this.createPreferenceSnapshot());
  }

  private restoredSetlistSessionMissing(): RestoredSetlistSessionResult {
    return { found: false };
  }

  private restoredSetlistSessionFound(
    setlist: { id: string; name: string; songIds: string[] },
    activeSetlistIndex: number,
  ): RestoredSetlistSessionResult {
    return { found: true, setlist, activeSetlistIndex };
  }

  private applyRestoredTransport(settings: Partial<MetronomeSettings> | undefined): void {
    this.commitSettings(settings ?? DEFAULT_APP_PREFERENCES.lastTransport, false);
  }

  private async applyRestoredPreferences(preferences: AppPreferences): Promise<void> {
    this.applyRestoredTransport(preferences.lastTransport);
    this.applyActiveSongSession(preferences.lastSongId, preferences.lastSongName);
    await this.restoreActiveSetlistSession(preferences);
  }

  private applyRestoredSetlistSession(result: RestoredSetlistSessionResult): void {
    if (!result.found) {
      this.clearActiveSetlistSession();
      return;
    }

    this.applyActiveSetlistSession(result.setlist, result.activeSetlistIndex);
  }

  private resolveRestoredSetlistSession(
    preferences: AppPreferences,
    setlist: { id: string; name: string; songIds: string[] } | null,
  ): RestoredSetlistSessionResult {
    if (!preferences.lastSetlistId || !setlist) {
      return this.restoredSetlistSessionMissing();
    }

    return this.restoredSetlistSessionFound(
      setlist,
      this.clampSetlistIndex(preferences.activeSetlistIndex, setlist.songIds.length),
    );
  }

  private async restoreActiveSetlistSession(preferences: AppPreferences): Promise<void> {
    const setlist = preferences.lastSetlistId ? await this.storage.getSetlist(preferences.lastSetlistId) : null;
    const result = this.resolveRestoredSetlistSession(preferences, setlist);
    this.applyRestoredSetlistSession(result);
  }

  private schedulePreferencesSave(): void {
    this.clearScheduledPreferencesSave();

    this.preferencesTimeoutId = window.setTimeout(() => {
      this.preferencesTimeoutId = null;
      this.persistCurrentPreferences();
    }, 160);
  }

  private async restorePreferences(): Promise<void> {
    const preferences = await this.storage.loadPreferences();
    await this.applyRestoredPreferences(preferences);
  }

  private dispose(): void {
    this.stopScheduler();
    this.stopVisualizerLoop();
    this.resetPlaybackAudioSession();
    this.clearScheduledPreferencesSave();

    this.schedulerWorker?.terminate();
    this.schedulerWorker = null;
  }

  private configurePlaybackAudioSession(): void {
    if (!this.isAppleMobileDevice()) {
      return;
    }

    const audioSession = this.getPlaybackAudioSession();

    if (!audioSession) {
      this.silentModeSupportState.set('unsupported');
      return;
    }

    try {
      if (audioSession.type !== 'playback') {
        audioSession.type = 'playback';
      }

      this.silentModeSupportState.set('active');
    } catch (error) {
      console.error('[Metronome] Failed to activate playback audio session.', error);
      this.silentModeSupportState.set('failed');
      this.audioActivationError.set('Silent-mode playback could not be activated on this iPhone browser.');
    }
  }

  private resetPlaybackAudioSession(): void {
    const audioSession = this.getPlaybackAudioSession();

    if (!audioSession) {
      return;
    }

    try {
      if (audioSession.type === 'playback') {
        audioSession.type = 'auto';
      }
    } catch (error) {
      console.warn('[Metronome] Failed to restore the browser audio session.', error);
    }
  }

  private getPlaybackAudioSession(): PlaybackAudioSession | null {
    if (typeof navigator === 'undefined') {
      return null;
    }

    return (navigator as NavigatorWithAudioSession).audioSession ?? null;
  }

  private markAudioActivationFailure(message: string): void {
    this.audioActivationError.set(message);

    if (this.isAppleMobileDevice() && this.silentModeSupportState() !== 'unsupported') {
      this.silentModeSupportState.set('failed');
    }
  }
}

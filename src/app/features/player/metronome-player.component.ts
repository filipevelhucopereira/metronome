import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { MetronomeService } from '../../core/metronome/metronome.service';
import { BEATS_PER_BAR_OPTIONS, RHYTHM_OPTIONS, SUBDIVISION_OPTIONS, type RhythmOption, type SubdivisionOption } from '../../shared/models/song.model';
import { MetronomeVisualizerComponent } from './metronome-visualizer.component';

const RHYTHM_LABELS = new Map(RHYTHM_OPTIONS.map((option) => [option.value, option.label]));
const SUBDIVISION_LABELS = new Map(SUBDIVISION_OPTIONS.map((option) => [option.value, option.label]));
const SUBDIVISION_SHORT_LABELS = new Map(SUBDIVISION_OPTIONS.map((option) => [option.value, option.shortLabel]));

@Component({
  selector: 'app-metronome-player',
  imports: [MetronomeVisualizerComponent],
  templateUrl: './metronome-player.component.html',
  styleUrl: './metronome-player.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetronomePlayerComponent {
  protected readonly metronome = inject(MetronomeService);

  protected readonly beatOptions = BEATS_PER_BAR_OPTIONS;
  protected readonly subdivisionOptions = SUBDIVISION_OPTIONS;
  protected readonly rhythmOptions = RHYTHM_OPTIONS;
  protected readonly audioSupportMessage = computed(() => this.metronome.audioSupportMessage());
  protected readonly beatMarkers = computed(() => Array.from({ length: this.metronome.beatsPerBar() }, (_, index) => index + 1));
  protected readonly rhythmLabel = computed(() => RHYTHM_LABELS.get(this.metronome.rhythm()) ?? 'Straight');
  protected readonly subdivisionLabel = computed(() => SUBDIVISION_LABELS.get(this.metronome.subdivision()) ?? 'Quarter');
  protected readonly subdivisionShortLabel = computed(() => SUBDIVISION_SHORT_LABELS.get(this.metronome.subdivision()) ?? 'Quarter');

  protected readonly meterCaption = computed(() => {
    return `${this.metronome.beatsPerBar()}/4 · ${this.subdivisionShortLabel().toLowerCase()} · ${this.rhythmLabel().toLowerCase()}`;
  });
  protected readonly settingsCaption = computed(() => {
    return `${this.metronome.beatsPerBar()}/4 · ${this.subdivisionLabel()} · ${this.rhythmLabel()}`;
  });

  protected readonly currentSessionLabel = computed(() => this.metronome.activeSongName() ?? 'Live Session');
  protected readonly currentSetlistBadge = computed(() => {
    const setlistName = this.metronome.activeSetlistName();

    if (!setlistName) {
      return null;
    }

    const [firstToken] = setlistName.trim().split(/\s+/);
    return firstToken.toUpperCase().slice(0, 8);
  });
  protected readonly pulseCaption = computed(() => `Pulse ${this.metronome.currentPulseInBeat()} of ${this.metronome.pulsesPerBeat()}`);
  protected readonly beatCaption = computed(() => `Beat ${this.metronome.currentBeatInBar()} of ${this.metronome.beatsPerBar()}`);
  protected readonly beatStripCaption = computed(() => `${this.beatCaption()} · ${this.pulseCaption()}`);
  protected readonly lookaheadCaption = computed(() => `Lookahead sync ${this.metronome.isPlaying() ? 'running' : 'stable'}`);
  protected readonly tempoSliderCaption = computed(() => `Range 30 to 240 BPM. Current ${this.metronome.tempo()} BPM.`);
  protected readonly volumeSliderCaption = computed(() => `Range 0 to 100 percent. Current ${Math.round(this.metronome.volume() * 100)} percent.`);

  protected togglePlayback(): void {
    if (this.metronome.isPlaying()) {
      this.metronome.stop();
      return;
    }

    void this.metronome.play();
  }

  protected adjustTempo(amount: number): void {
    this.metronome.nudgeTempo(amount);
  }

  protected updateTempo(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.metronome.setTempo(Number(input?.value));
  }

  protected updateVolume(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.metronome.setVolume(Number(input?.value));
  }

  protected selectBeatsPerBar(value: number): void {
    this.metronome.setBeatsPerBar(value);
  }

  protected selectSubdivision(value: SubdivisionOption): void {
    this.metronome.setSubdivision(value);
  }

  protected selectRhythm(value: RhythmOption): void {
    this.metronome.setRhythm(value);
  }

  protected tapTempo(): void {
    this.metronome.tapTempo();
  }

  protected previousSong(): void {
    void this.metronome.previousSong();
  }

  protected nextSong(): void {
    void this.metronome.nextSong();
  }
}

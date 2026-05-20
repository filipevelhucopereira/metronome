import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { MetronomeService } from '../../core/metronome/metronome.service';
import { BEATS_PER_BAR_OPTIONS, RHYTHM_OPTIONS, SUBDIVISION_OPTIONS, type RhythmOption, type SubdivisionOption } from '../../shared/models/song.model';
import { MetronomeVisualizerComponent } from './metronome-visualizer.component';

@Component({
  selector: 'app-metronome-player',
  imports: [MetronomeVisualizerComponent],
  templateUrl: './metronome-player.component.html',
  styleUrl: './metronome-player.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'player-page',
  },
})
export class MetronomePlayerComponent {
  protected readonly metronome = inject(MetronomeService);

  protected readonly beatOptions = BEATS_PER_BAR_OPTIONS;
  protected readonly subdivisionOptions = SUBDIVISION_OPTIONS;
  protected readonly rhythmOptions = RHYTHM_OPTIONS;
  protected readonly audioSupportMessage = computed(() => this.metronome.audioSupportMessage());
  protected readonly beatMarkers = computed(() => Array.from({ length: this.metronome.beatsPerBar() }, (_, index) => index + 1));

  protected readonly meterCaption = computed(() => {
    const rhythmLabel = this.rhythmOptions.find((option) => option.value === this.metronome.rhythm())?.label ?? 'Straight';
    const subdivisionLabel = this.subdivisionOptions.find((option) => option.value === this.metronome.subdivision())?.shortLabel ?? 'Quarter';

    return `${this.metronome.beatsPerBar()}/4 · ${subdivisionLabel.toLowerCase()} · ${rhythmLabel.toLowerCase()}`;
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
  protected readonly lookaheadCaption = computed(() => `Lookahead sync ${this.metronome.isPlaying() ? 'running' : 'stable'}`);

  protected togglePlayback(): void {
    if (this.metronome.isPlaying()) {
      this.metronome.pause();
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

  protected nextSong(): void {
    void this.metronome.nextSong();
  }
}

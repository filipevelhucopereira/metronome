import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { VisualizerSnapshot } from '../../core/metronome/metronome.helpers';

@Component({
  selector: 'app-metronome-visualizer',
  templateUrl: './metronome-visualizer.component.html',
  styleUrl: './metronome-visualizer.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'metronome-visualizer-host',
  },
})
export class MetronomeVisualizerComponent {
  readonly snapshot = input.required<VisualizerSnapshot>();

  protected readonly laneMarkers = computed(() => {
    const snapshot = this.snapshot();

    return Array.from({ length: snapshot.beatsPerBar }, (_, index) => {
      const angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / snapshot.beatsPerBar);

      return {
        index: index + 1,
        x: 60 + (Math.cos(angle) * 44),
        y: 60 + (Math.sin(angle) * 44),
        isCurrent: index + 1 === snapshot.currentBeatInBar,
        isPassed: index + 1 < snapshot.currentBeatInBar,
      };
    });
  });

  protected readonly pulseTransform = computed(() => {
    const scale = 1 + (this.snapshot().flashStrength * 0.1);
    return `translate(60 60) scale(${scale.toFixed(3)}) translate(-60 -60)`;
  });

  protected readonly haloOpacity = computed(() => 0.16 + (this.snapshot().flashStrength * 0.42));
  protected readonly stateLabel = computed(() => this.snapshot().isPlaying ? 'Live' : 'Ready');
  protected readonly progressDashOffset = computed(() => {
    const snapshot = this.snapshot();
    const progress = ((snapshot.currentBeatInBar - 1) + ((snapshot.currentPulseInBeat - 1) / snapshot.pulsesPerBeat)) / snapshot.beatsPerBar;
    const circumference = 2 * Math.PI * 44;

    return (circumference * (1 - progress)).toFixed(2);
  });

  protected readonly emphasisLabel = computed(() => {
    switch (this.snapshot().emphasis) {
      case 'bar':
        return 'Downbeat accent';
      case 'beat':
        return 'Primary beat';
      default:
        return 'Subdivision pulse';
    }
  });

  protected readonly liveLabel = computed(
    () =>
      `Beat ${this.snapshot().currentBeatInBar} of ${this.snapshot().beatsPerBar}, pulse ${this.snapshot().currentPulseInBeat} of ${this.snapshot().pulsesPerBeat}`,
  );
}

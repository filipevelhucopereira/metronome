import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { VisualizerMotion, VisualizerStructure } from '../../core/metronome/metronome.helpers';

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
  readonly structure = input.required<VisualizerStructure>();
  readonly motion = input.required<VisualizerMotion>();

  protected readonly laneMarkers = computed(() => {
    const structure = this.structure();

    return Array.from({ length: structure.beatsPerBar }, (_, index) => {
      const angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / structure.beatsPerBar);

      return {
        index: index + 1,
        x: 60 + (Math.cos(angle) * 44),
        y: 60 + (Math.sin(angle) * 44),
        isCurrent: index + 1 === structure.currentBeatInBar,
        isPassed: index + 1 < structure.currentBeatInBar,
      };
    });
  });

  protected readonly pulseTransform = computed(() => {
    const scale = 1 + (this.motion().flashStrength * 0.1);
    return `translate(60 60) scale(${scale.toFixed(3)}) translate(-60 -60)`;
  });

  protected readonly haloOpacity = computed(() => 0.16 + (this.motion().flashStrength * 0.42));
  protected readonly stateLabel = computed(() => this.structure().isPlaying ? 'Live' : 'Ready');
  protected readonly progressDashOffset = computed(() => {
    const structure = this.structure();
    const progress = ((structure.currentBeatInBar - 1) + ((structure.currentPulseInBeat - 1) / structure.pulsesPerBeat)) / structure.beatsPerBar;
    const circumference = 2 * Math.PI * 44;

    return (circumference * (1 - progress)).toFixed(2);
  });

  protected readonly emphasisLabel = computed(() => {
    switch (this.structure().emphasis) {
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
      `Beat ${this.structure().currentBeatInBar} of ${this.structure().beatsPerBar}, pulse ${this.structure().currentPulseInBeat} of ${this.structure().pulsesPerBeat}`,
  );
}

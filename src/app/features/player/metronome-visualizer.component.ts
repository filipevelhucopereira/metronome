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
        x: 160 + (Math.cos(angle) * 112),
        y: 160 + (Math.sin(angle) * 112),
        isCurrent: index + 1 === snapshot.currentBeatInBar,
        isPassed: index + 1 < snapshot.currentBeatInBar,
      };
    });
  });

  protected readonly pendulumTransform = computed(
    () => `rotate(${(this.snapshot().pendulumOffset * 28).toFixed(2)} 160 160)`,
  );

  protected readonly pulseTransform = computed(() => {
    const scale = 1 + (this.snapshot().flashStrength * 0.16);
    return `translate(160 160) scale(${scale.toFixed(3)}) translate(-160 -160)`;
  });

  protected readonly haloOpacity = computed(() => 0.2 + (this.snapshot().flashStrength * 0.6));

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

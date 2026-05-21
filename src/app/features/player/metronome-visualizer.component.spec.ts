import { TestBed } from '@angular/core/testing';

import { type VisualizerMotion, type VisualizerStructure } from '../../core/metronome/metronome.helpers';
import { MetronomeVisualizerComponent } from './metronome-visualizer.component';

describe('MetronomeVisualizerComponent', () => {
  const baseStructure: VisualizerStructure = {
    isPlaying: true,
    currentBeatInBar: 1,
    beatsPerBar: 4,
    currentPulseInBeat: 1,
    pulsesPerBeat: 2,
    emphasis: 'bar',
    nextBeatInBar: 2,
  };

  const baseMotion: VisualizerMotion = {
    beatProgress: 0.1,
    flashStrength: 0.35,
    pendulumOffset: -0.8,
  };

  async function createComponent() {
    await TestBed.configureTestingModule({
      imports: [MetronomeVisualizerComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(MetronomeVisualizerComponent);

    return {
      fixture,
      component: fixture.componentInstance as unknown as {
        laneMarkers(): Array<{ index: number; isCurrent: boolean }>;
        pulseTransform(): string;
      },
    };
  }

  async function setInputs(
    fixture: ReturnType<typeof TestBed.createComponent<MetronomeVisualizerComponent>>,
    structure: VisualizerStructure,
    motion: VisualizerMotion,
  ): Promise<void> {
    fixture.componentRef.setInput('structure', structure);
    fixture.componentRef.setInput('motion', motion);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('keeps lane markers stable when only motion changes', async () => {
    const { fixture, component } = await createComponent();

    await setInputs(fixture, baseStructure, baseMotion);

    const firstMarkers = component.laneMarkers();
    const firstTransform = component.pulseTransform();

    await setInputs(fixture, baseStructure, {
      beatProgress: 0.55,
      flashStrength: 0.82,
      pendulumOffset: 0.2,
    });

    expect(component.laneMarkers()).toBe(firstMarkers);
    expect(component.pulseTransform()).not.toBe(firstTransform);
  });

  it('rebuilds lane markers when the structure changes', async () => {
    const { fixture, component } = await createComponent();

    await setInputs(fixture, baseStructure, baseMotion);

    const firstMarkers = component.laneMarkers();

    await setInputs(fixture, {
      ...baseStructure,
      currentBeatInBar: 2,
      nextBeatInBar: 3,
    }, baseMotion);

    expect(component.laneMarkers()).not.toBe(firstMarkers);
    expect(component.laneMarkers().find((marker) => marker.isCurrent)?.index).toBe(2);
  });
});

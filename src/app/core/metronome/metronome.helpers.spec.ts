import { calculateTapTempo, moveItem, normalizeMetronomeSettings, pulseDurationSeconds } from './metronome.helpers';

describe('metronome.helpers', () => {
  it('forces swing mode to eighth-note subdivision', () => {
    const settings = normalizeMetronomeSettings({
      tempo: 112,
      beatsPerBar: 4,
      subdivision: 4,
      rhythm: 'swing',
      volume: 0.6,
    });

    expect(settings.subdivision).toBe(2);
  });

  it('forces compound mode to triplet subdivision', () => {
    const settings = normalizeMetronomeSettings({
      tempo: 112,
      beatsPerBar: 4,
      subdivision: 1,
      rhythm: 'compound',
      volume: 0.6,
    });

    expect(settings.subdivision).toBe(3);
  });

  it('calculates tap tempo from recent intervals', () => {
    expect(calculateTapTempo([0, 500, 1000, 1500])).toBe(120);
  });

  it('uses a long-short split for swing pulse duration', () => {
    const swingSettings = normalizeMetronomeSettings({
      tempo: 120,
      beatsPerBar: 4,
      subdivision: 2,
      rhythm: 'swing',
      volume: 0.6,
    });

    expect(pulseDurationSeconds(swingSettings, 0)).toBeCloseTo(1 / 3, 5);
    expect(pulseDurationSeconds(swingSettings, 1)).toBeCloseTo(1 / 6, 5);
  });

  it('moves items without mutating the original array', () => {
    const source = ['one', 'two', 'three'];
    const reordered = moveItem(source, 0, 2);

    expect(reordered).toEqual(['two', 'three', 'one']);
    expect(source).toEqual(['one', 'two', 'three']);
  });
});

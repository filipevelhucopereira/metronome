export const TEMPO_MIN = 30;
export const TEMPO_MAX = 240;

export const BEATS_PER_BAR_OPTIONS = [2, 3, 4, 5, 7] as const;

export const SUBDIVISION_OPTIONS = [
  { value: 1, label: 'Quarter notes', shortLabel: 'Quarter', pulsesPerBeat: 1 },
  { value: 2, label: 'Eighth notes', shortLabel: 'Eighth', pulsesPerBeat: 2 },
  { value: 3, label: 'Triplets', shortLabel: 'Triplet', pulsesPerBeat: 3 },
  { value: 4, label: 'Sixteenths', shortLabel: 'Sixteenth', pulsesPerBeat: 4 },
] as const;

export const RHYTHM_OPTIONS = [
  { value: 'straight', label: 'Straight' },
  { value: 'swing', label: 'Swing' },
  { value: 'compound', label: 'Compound' },
] as const;

export type SubdivisionOption = (typeof SUBDIVISION_OPTIONS)[number]['value'];
export type RhythmOption = (typeof RHYTHM_OPTIONS)[number]['value'];

export interface MetronomeSettings {
  tempo: number;
  beatsPerBar: number;
  subdivision: SubdivisionOption;
  rhythm: RhythmOption;
  volume: number;
}

export interface Song extends MetronomeSettings {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export type SongDraft = Omit<Song, 'id' | 'createdAt' | 'updatedAt'>;

export const DEFAULT_METRONOME_SETTINGS: MetronomeSettings = {
  tempo: 120,
  beatsPerBar: 4,
  subdivision: 1,
  rhythm: 'straight',
  volume: 0.72,
};

export const DEFAULT_SONG_DRAFT: SongDraft = {
  name: '',
  ...DEFAULT_METRONOME_SETTINGS,
};

export function isSubdivisionOption(value: number): value is SubdivisionOption {
  return SUBDIVISION_OPTIONS.some((option) => option.value === value);
}

export function isRhythmOption(value: string): value is RhythmOption {
  return RHYTHM_OPTIONS.some((option) => option.value === value);
}

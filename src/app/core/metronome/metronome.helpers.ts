import {
  DEFAULT_METRONOME_SETTINGS,
  TEMPO_MAX,
  TEMPO_MIN,
  isRhythmOption,
  isSubdivisionOption,
  type MetronomeSettings,
  type RhythmOption,
  type Song,
  type SongDraft,
  type SubdivisionOption,
} from '../../shared/models/song.model';
import type { ResolvedSetlist, ResolvedSetlistEntry, Setlist } from '../../shared/models/setlist.model';

export type ClickEmphasis = 'bar' | 'beat' | 'subdivision';

export interface ScheduledTick {
  time: number;
  beatInBar: number;
  pulseInBeat: number;
  pulsesPerBeat: number;
  emphasis: ClickEmphasis;
}

export interface VisualizerSnapshot {
  isPlaying: boolean;
  currentBeatInBar: number;
  beatsPerBar: number;
  currentPulseInBeat: number;
  pulsesPerBeat: number;
  beatProgress: number;
  pendulumOffset: number;
  flashStrength: number;
  emphasis: ClickEmphasis;
  nextBeatInBar: number | null;
}

export function clampTempo(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_METRONOME_SETTINGS.tempo;
  }

  return Math.round(Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, value)));
}

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_METRONOME_SETTINGS.volume;
  }

  return Math.min(1, Math.max(0, value));
}

export function clampBeatsPerBar(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_METRONOME_SETTINGS.beatsPerBar;
  }

  return Math.max(1, Math.min(12, Math.round(value)));
}

export function normalizeMetronomeSettings(input: Partial<MetronomeSettings>): MetronomeSettings {
  const rhythm: RhythmOption = isRhythmOption(input.rhythm ?? '')
    ? (input.rhythm ?? DEFAULT_METRONOME_SETTINGS.rhythm)
    : DEFAULT_METRONOME_SETTINGS.rhythm;
  const subdivisionValue = Number(input.subdivision);
  let subdivision: SubdivisionOption = isSubdivisionOption(subdivisionValue)
    ? subdivisionValue
    : DEFAULT_METRONOME_SETTINGS.subdivision;

  if (rhythm === 'swing') {
    subdivision = 2;
  }

  if (rhythm === 'compound') {
    subdivision = 3;
  }

  return {
    tempo: clampTempo(input.tempo ?? DEFAULT_METRONOME_SETTINGS.tempo),
    beatsPerBar: clampBeatsPerBar(input.beatsPerBar ?? DEFAULT_METRONOME_SETTINGS.beatsPerBar),
    subdivision,
    rhythm,
    volume: clampVolume(input.volume ?? DEFAULT_METRONOME_SETTINGS.volume),
  };
}

export function normalizeSongDraft(input: Partial<SongDraft>): SongDraft {
  const settings = normalizeMetronomeSettings(input);

  return {
    name: typeof input.name === 'string' ? input.name.trim() : '',
    tempo: settings.tempo,
    beatsPerBar: settings.beatsPerBar,
    subdivision: settings.subdivision,
    rhythm: settings.rhythm,
    volume: settings.volume,
  };
}

export function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createTimestamp(): string {
  return new Date().toISOString();
}

export function pulsesPerBeatForSettings(settings: MetronomeSettings): number {
  if (settings.rhythm === 'compound') {
    return 3;
  }

  return settings.subdivision;
}

export function beatDurationSeconds(settings: MetronomeSettings): number {
  return 60 / clampTempo(settings.tempo);
}

export function pulseDurationSeconds(settings: MetronomeSettings, pulseIndexInBeat: number): number {
  const beatSeconds = beatDurationSeconds(settings);

  if (settings.rhythm === 'swing' && settings.subdivision === 2) {
    return pulseIndexInBeat === 0 ? beatSeconds * (2 / 3) : beatSeconds * (1 / 3);
  }

  return beatSeconds / pulsesPerBeatForSettings(settings);
}

export function calculateTapTempo(timestamps: readonly number[]): number | null {
  if (timestamps.length < 2) {
    return null;
  }

  const recentTimestamps = timestamps.slice(-8);
  const intervals = recentTimestamps.slice(1).map((value, index) => value - recentTimestamps[index]);
  const saneIntervals = intervals.filter((interval) => interval > 150 && interval < 2000);

  if (!saneIntervals.length) {
    return null;
  }

  const averageInterval = saneIntervals.reduce((total, interval) => total + interval, 0) / saneIntervals.length;
  return clampTempo(60000 / averageInterval);
}

export function moveItem<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  const result = [...items];

  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= result.length ||
    toIndex >= result.length ||
    fromIndex === toIndex
  ) {
    return result;
  }

  const [item] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, item);
  return result;
}

export function createResolvedSetlistEntryId(setlistId: string, order: number, songId: string): string {
  return `${setlistId}:${order}:${songId}`;
}

export function resolveSetlist(setlist: Setlist, songs: readonly Song[]): ResolvedSetlist {
  const songMap = new Map(songs.map((song) => [song.id, song]));
  const entries: ResolvedSetlistEntry[] = [];
  const missingSongIds: string[] = [];

  setlist.songIds.forEach((songId, order) => {
    const song = songMap.get(songId);

    if (!song) {
      missingSongIds.push(songId);
      return;
    }

    entries.push({
      id: createResolvedSetlistEntryId(setlist.id, order, songId),
      songId,
      order,
      song,
    });
  });

  return {
    ...setlist,
    entries,
    missingSongIds,
  };
}

export function emphasisForTick(beatInBar: number, pulseInBeat: number): ClickEmphasis {
  if (beatInBar === 1 && pulseInBeat === 1) {
    return 'bar';
  }

  if (pulseInBeat === 1) {
    return 'beat';
  }

  return 'subdivision';
}

export function asSongRecord(song: Song | SongDraft, existingId?: string, existingCreatedAt?: string): Song {
  const draft = normalizeSongDraft(song);
  const timestamp = createTimestamp();

  return {
    id: existingId ?? ('id' in song ? song.id : createId()),
    name: draft.name || 'Untitled Song',
    tempo: draft.tempo,
    beatsPerBar: draft.beatsPerBar,
    subdivision: draft.subdivision,
    rhythm: draft.rhythm,
    volume: draft.volume,
    createdAt: existingCreatedAt ?? ('createdAt' in song ? song.createdAt : timestamp),
    updatedAt: timestamp,
  };
}

export function asRhythmOption(value: string | null | undefined): RhythmOption {
  return isRhythmOption(value ?? '') ? (value as RhythmOption) : DEFAULT_METRONOME_SETTINGS.rhythm;
}

export function asSubdivisionOption(value: number): SubdivisionOption {
  return isSubdivisionOption(value) ? value : DEFAULT_METRONOME_SETTINGS.subdivision;
}

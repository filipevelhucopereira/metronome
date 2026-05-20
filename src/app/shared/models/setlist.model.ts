import { DEFAULT_METRONOME_SETTINGS, type MetronomeSettings, type Song } from './song.model';

export interface Setlist {
  id: string;
  name: string;
  songIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type SetlistDraft = Omit<Setlist, 'id' | 'createdAt' | 'updatedAt'>;

export interface ResolvedSetlistEntry {
  id: string;
  songId: string;
  order: number;
  song: Song;
}

export interface ResolvedSetlist extends Setlist {
  entries: ResolvedSetlistEntry[];
  missingSongIds: string[];
}

export interface AppPreferences {
  lastTransport: MetronomeSettings;
  lastSongId: string | null;
  lastSongName: string | null;
  lastSetlistId: string | null;
  lastSetlistName: string | null;
  activeSetlistIndex: number;
}

export const DEFAULT_SETLIST_DRAFT: SetlistDraft = {
  name: '',
  songIds: [],
};

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  lastTransport: { ...DEFAULT_METRONOME_SETTINGS },
  lastSongId: null,
  lastSongName: null,
  lastSetlistId: null,
  lastSetlistName: null,
  activeSetlistIndex: 0,
};

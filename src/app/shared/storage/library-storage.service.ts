import { Injectable } from '@angular/core';

import { DEFAULT_APP_PREFERENCES, DEFAULT_SETLIST_DRAFT, type AppPreferences, type ResolvedSetlist, type Setlist, type SetlistDraft } from '../models/setlist.model';
import { DEFAULT_METRONOME_SETTINGS, type Song, type SongDraft } from '../models/song.model';
import { asSongRecord, createId, createTimestamp, normalizeMetronomeSettings, resolveSetlist } from '../../core/metronome/metronome.helpers';

@Injectable({ providedIn: 'root' })
export class LibraryStorageService {
  private readonly databaseName = 'metronome-pwa';
  private readonly databaseVersion = 1;
  private readonly songsStore = 'songs';
  private readonly setlistsStore = 'setlists';
  private readonly preferencesStore = 'preferences';
  private readonly preferencesKey = 'app-preferences';

  private databasePromise: Promise<IDBDatabase | null> | null = null;

  async listSongs(): Promise<Song[]> {
    const songs = await this.readCollection<Song>(this.songsStore);
    return songs
      .map((song) => asSongRecord(song, song.id, song.createdAt))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getSong(songId: string): Promise<Song | null> {
    if (!songId) {
      return null;
    }

    const song = await this.readRecord<Song>(this.songsStore, songId);
    return song ? asSongRecord(song, song.id, song.createdAt) : null;
  }

  async saveSong(song: SongDraft | Song): Promise<Song> {
    const existingSong = 'id' in song ? await this.getSong(song.id) : null;
    const record = asSongRecord(song, existingSong?.id, existingSong?.createdAt);
    await this.writeRecord(this.songsStore, record);
    return record;
  }

  async deleteSong(songId: string): Promise<void> {
    if (!songId) {
      return;
    }

    await this.deleteRecord(this.songsStore, songId);

    const setlists = await this.listSetlists();
    await Promise.all(
      setlists
        .filter((setlist) => setlist.songIds.includes(songId))
        .map((setlist) =>
          this.saveSetlist({
            ...setlist,
            songIds: setlist.songIds.filter((id) => id !== songId),
          }),
        ),
    );
  }

  async duplicateSong(songId: string): Promise<Song | null> {
    const song = await this.getSong(songId);

    if (!song) {
      return null;
    }

    return this.saveSong({
      ...song,
      id: createId(),
      name: `${song.name} Copy`,
      createdAt: createTimestamp(),
      updatedAt: createTimestamp(),
    });
  }

  async listSetlists(): Promise<Setlist[]> {
    const setlists = await this.readCollection<Setlist>(this.setlistsStore);
    return setlists
      .map((setlist) => this.normalizeSetlist(setlist))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async getSetlist(setlistId: string): Promise<Setlist | null> {
    if (!setlistId) {
      return null;
    }

    const setlist = await this.readRecord<Setlist>(this.setlistsStore, setlistId);
    return setlist ? this.normalizeSetlist(setlist) : null;
  }

  async getResolvedSetlist(setlistId: string): Promise<ResolvedSetlist | null> {
    const setlist = await this.getSetlist(setlistId);

    if (!setlist) {
      return null;
    }

    const songs = await this.listSongs();
    return resolveSetlist(setlist, songs);
  }

  async saveSetlist(setlist: SetlistDraft | Setlist): Promise<Setlist> {
    const existingSetlist = 'id' in setlist ? await this.getSetlist(setlist.id) : null;
    const timestamp = createTimestamp();
    const record: Setlist = {
      id: existingSetlist?.id ?? ('id' in setlist ? setlist.id : createId()),
      name: (setlist.name ?? DEFAULT_SETLIST_DRAFT.name).trim() || 'Untitled Setlist',
      songIds: Array.isArray(setlist.songIds) ? [...setlist.songIds] : [],
      createdAt: existingSetlist?.createdAt ?? ('createdAt' in setlist ? setlist.createdAt : timestamp),
      updatedAt: timestamp,
    };

    await this.writeRecord(this.setlistsStore, record);
    return record;
  }

  async deleteSetlist(setlistId: string): Promise<void> {
    if (!setlistId) {
      return;
    }

    await this.deleteRecord(this.setlistsStore, setlistId);
  }

  async addSongToSetlist(setlistId: string, songId: string): Promise<Setlist | null> {
    const setlist = await this.getSetlist(setlistId);

    if (!setlist) {
      return null;
    }

    return this.saveSetlist({
      ...setlist,
      songIds: [...setlist.songIds, songId],
    });
  }

  async removeSongFromSetlist(setlistId: string, songIndex: number): Promise<Setlist | null> {
    const setlist = await this.getSetlist(setlistId);

    if (!setlist) {
      return null;
    }

    const nextSongIds = [...setlist.songIds];
    nextSongIds.splice(songIndex, 1);

    return this.saveSetlist({
      ...setlist,
      songIds: nextSongIds,
    });
  }

  async reorderSetlistSongs(setlistId: string, songIds: string[]): Promise<Setlist | null> {
    const setlist = await this.getSetlist(setlistId);

    if (!setlist) {
      return null;
    }

    return this.saveSetlist({
      ...setlist,
      songIds,
    });
  }

  async loadPreferences(): Promise<AppPreferences> {
    const storedPreferences = await this.readRecord<AppPreferences>(this.preferencesStore, this.preferencesKey);

    if (!storedPreferences) {
      return { ...DEFAULT_APP_PREFERENCES };
    }

    return {
      lastTransport: normalizeMetronomeSettings(storedPreferences.lastTransport ?? DEFAULT_METRONOME_SETTINGS),
      lastSongId: storedPreferences.lastSongId ?? null,
      lastSongName: storedPreferences.lastSongName ?? null,
      lastSetlistId: storedPreferences.lastSetlistId ?? null,
      lastSetlistName: storedPreferences.lastSetlistName ?? null,
      activeSetlistIndex: Math.max(0, Math.floor(storedPreferences.activeSetlistIndex ?? 0)),
    };
  }

  async savePreferences(preferences: AppPreferences): Promise<void> {
    const record: AppPreferences = {
      lastTransport: normalizeMetronomeSettings(preferences.lastTransport),
      lastSongId: preferences.lastSongId ?? null,
      lastSongName: preferences.lastSongName ?? null,
      lastSetlistId: preferences.lastSetlistId ?? null,
      lastSetlistName: preferences.lastSetlistName ?? null,
      activeSetlistIndex: Math.max(0, Math.floor(preferences.activeSetlistIndex ?? 0)),
    };

    await this.writeRecord(this.preferencesStore, {
      id: this.preferencesKey,
      ...record,
    });
  }

  private normalizeSetlist(setlist: Setlist): Setlist {
    return {
      id: setlist.id,
      name: setlist.name?.trim() || 'Untitled Setlist',
      songIds: Array.isArray(setlist.songIds) ? [...setlist.songIds] : [],
      createdAt: setlist.createdAt || createTimestamp(),
      updatedAt: setlist.updatedAt || createTimestamp(),
    };
  }

  private async openDatabase(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') {
      return null;
    }

    if (this.databasePromise) {
      return this.databasePromise;
    }

    this.databasePromise = new Promise((resolve) => {
      const request = indexedDB.open(this.databaseName, this.databaseVersion);

      request.onupgradeneeded = () => {
        const database = request.result;

        if (!database.objectStoreNames.contains(this.songsStore)) {
          database.createObjectStore(this.songsStore, { keyPath: 'id' });
        }

        if (!database.objectStoreNames.contains(this.setlistsStore)) {
          database.createObjectStore(this.setlistsStore, { keyPath: 'id' });
        }

        if (!database.objectStoreNames.contains(this.preferencesStore)) {
          database.createObjectStore(this.preferencesStore, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });

    return this.databasePromise;
  }

  private async readCollection<T extends { id: string }>(storeName: string): Promise<T[]> {
    const database = await this.openDatabase();

    if (!database) {
      return this.readCollectionFromLocalStorage<T>(storeName);
    }

    return new Promise((resolve) => {
      const transaction = database.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).getAll();

      request.onsuccess = () => resolve((request.result ?? []) as T[]);
      request.onerror = () => resolve([]);
    });
  }

  private async readRecord<T>(storeName: string, recordId: string): Promise<T | null> {
    const database = await this.openDatabase();

    if (!database) {
      return this.readRecordFromLocalStorage<T>(storeName, recordId);
    }

    return new Promise((resolve) => {
      const transaction = database.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).get(recordId);

      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => resolve(null);
    });
  }

  private async writeRecord<T extends { id: string }>(storeName: string, record: T): Promise<void> {
    const database = await this.openDatabase();

    if (!database) {
      this.writeRecordToLocalStorage(storeName, record);
      return;
    }

    await new Promise<void>((resolve) => {
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
  }

  private async deleteRecord(storeName: string, recordId: string): Promise<void> {
    const database = await this.openDatabase();

    if (!database) {
      this.deleteRecordFromLocalStorage(storeName, recordId);
      return;
    }

    await new Promise<void>((resolve) => {
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).delete(recordId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
  }

  private readCollectionFromLocalStorage<T extends { id: string }>(storeName: string): T[] {
    if (typeof localStorage === 'undefined') {
      return [];
    }

    const rawValue = localStorage.getItem(this.localStorageKey(storeName));

    if (!rawValue) {
      return [];
    }

    try {
      return JSON.parse(rawValue) as T[];
    } catch {
      return [];
    }
  }

  private readRecordFromLocalStorage<T>(storeName: string, recordId: string): T | null {
    const records = this.readCollectionFromLocalStorage<Array<Record<string, unknown>>[number] & { id: string }>(storeName);
    return (records.find((record) => record.id === recordId) as T | undefined) ?? null;
  }

  private writeRecordToLocalStorage<T extends { id: string }>(storeName: string, record: T): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    const records = this.readCollectionFromLocalStorage<T>(storeName);
    const existingIndex = records.findIndex((entry) => entry.id === record.id);

    if (existingIndex >= 0) {
      records.splice(existingIndex, 1, record);
    } else {
      records.push(record);
    }

    localStorage.setItem(this.localStorageKey(storeName), JSON.stringify(records));
  }

  private deleteRecordFromLocalStorage(storeName: string, recordId: string): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    const records = this.readCollectionFromLocalStorage<{ id: string }>(storeName);
    const nextRecords = records.filter((record) => record.id !== recordId);
    localStorage.setItem(this.localStorageKey(storeName), JSON.stringify(nextRecords));
  }

  private localStorageKey(storeName: string): string {
    return `${this.databaseName}:${storeName}`;
  }
}

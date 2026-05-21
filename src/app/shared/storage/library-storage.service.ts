import { Injectable } from '@angular/core';

import { DEFAULT_APP_PREFERENCES, DEFAULT_SETLIST_DRAFT, type AppPreferences, type ResolvedSetlist, type Setlist, type SetlistDraft } from '../models/setlist.model';
import { DEFAULT_METRONOME_SETTINGS, type Song, type SongDraft } from '../models/song.model';
import { asSongRecord, createId, createTimestamp, normalizeMetronomeSettings, resolveSetlist } from '../../core/metronome/metronome.helpers';

type PersistenceFailureReason = 'unavailable' | 'blocked' | 'request-error' | 'transaction-error' | 'aborted' | 'invalid-state';

type PersistenceResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: PersistenceFailureReason; retryable: boolean };

type PersistenceRecordResult<T> =
  | { ok: true; found: true; value: T }
  | { ok: true; found: false }
  | { ok: false; reason: PersistenceFailureReason; retryable: boolean };

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

  async deleteSong(songId: string): Promise<Setlist[]> {
    if (!songId) {
      return [];
    }

    await this.deleteRecord(this.songsStore, songId);

    const setlists = await this.listSetlists();
    return await Promise.all(
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
      activeSetlistIndex: this.normalizeActiveSetlistIndex(storedPreferences.activeSetlistIndex),
    };
  }

  async savePreferences(preferences: AppPreferences): Promise<void> {
    const record: AppPreferences = {
      lastTransport: normalizeMetronomeSettings(preferences.lastTransport),
      lastSongId: preferences.lastSongId ?? null,
      lastSongName: preferences.lastSongName ?? null,
      lastSetlistId: preferences.lastSetlistId ?? null,
      lastSetlistName: preferences.lastSetlistName ?? null,
      activeSetlistIndex: this.normalizeActiveSetlistIndex(preferences.activeSetlistIndex),
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

  private normalizeActiveSetlistIndex(value: unknown): number {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return 0;
    }

    return Math.max(0, Math.floor(numericValue));
  }

  private resetDatabaseConnection(): void {
    this.databasePromise = null;
  }

  private success<T>(value: T): PersistenceResult<T> {
    return { ok: true, value };
  }

  private failure<T>(reason: PersistenceFailureReason, retryable = false): PersistenceResult<T> {
    return { ok: false, reason, retryable };
  }

  private foundRecord<T>(value: T): PersistenceRecordResult<T> {
    return { ok: true, found: true, value };
  }

  private missingRecord<T>(): PersistenceRecordResult<T> {
    return { ok: true, found: false };
  }

  private recordFailure<T>(reason: PersistenceFailureReason, retryable = false): PersistenceRecordResult<T> {
    return { ok: false, reason, retryable };
  }

  private async resolveWithIndexedDbFallback<T>(
    runIndexedDb: (database: IDBDatabase) => Promise<PersistenceResult<T>>,
    runFallback: () => T | Promise<T>,
    allowRetry = true,
  ): Promise<T> {
    const databaseResult = await this.openDatabase();

    if (!databaseResult.ok) {
      return await runFallback();
    }

    const operationResult = await runIndexedDb(databaseResult.value);

    if (operationResult.ok) {
      return operationResult.value;
    }

    if (allowRetry && operationResult.retryable) {
      this.resetDatabaseConnection();
      return this.resolveWithIndexedDbFallback(runIndexedDb, runFallback, false);
    }

    return await runFallback();
  }

  private async resolveRecordWithIndexedDbFallback<T>(
    runIndexedDb: (database: IDBDatabase) => Promise<PersistenceRecordResult<T>>,
    runFallback: () => T | null | Promise<T | null>,
    allowRetry = true,
  ): Promise<T | null> {
    const databaseResult = await this.openDatabase();

    if (!databaseResult.ok) {
      return await runFallback();
    }

    const operationResult = await runIndexedDb(databaseResult.value);

    if (operationResult.ok) {
      return operationResult.found ? operationResult.value : null;
    }

    if (allowRetry && operationResult.retryable) {
      this.resetDatabaseConnection();
      return this.resolveRecordWithIndexedDbFallback(runIndexedDb, runFallback, false);
    }

    return await runFallback();
  }

  private async openDatabase(): Promise<PersistenceResult<IDBDatabase>> {
    if (typeof indexedDB === 'undefined') {
      return this.failure('unavailable');
    }

    if (this.databasePromise) {
      const database = await this.databasePromise;
      return database ? this.success(database) : this.failure('unavailable');
    }

    let failureReason: PersistenceFailureReason = 'request-error';

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
      request.onerror = () => {
        failureReason = 'request-error';
        this.resetDatabaseConnection();
        resolve(null);
      };
      request.onblocked = () => {
        failureReason = 'blocked';
        this.resetDatabaseConnection();
        resolve(null);
      };
    });

    const database = await this.databasePromise;
    return database ? this.success(database) : this.failure(failureReason);
  }

  private async readCollection<T extends { id: string }>(storeName: string): Promise<T[]> {
    return this.resolveWithIndexedDbFallback(
      (database) => this.readCollectionFromIndexedDb<T>(database, storeName),
      () => this.readCollectionFromLocalStorage<T>(storeName),
    );
  }

  private async readRecord<T>(storeName: string, recordId: string): Promise<T | null> {
    return this.resolveRecordWithIndexedDbFallback(
      (database) => this.readRecordFromIndexedDb<T>(database, storeName, recordId),
      () => this.readRecordFromLocalStorage<T>(storeName, recordId),
    );
  }

  private async writeRecord<T extends { id: string }>(storeName: string, record: T): Promise<void> {
    await this.resolveWithIndexedDbFallback(
      (database) => this.writeRecordToIndexedDb<T>(database, storeName, record),
      () => {
        this.writeRecordToLocalStorage(storeName, record);
      },
    );
  }

  private async deleteRecord(storeName: string, recordId: string): Promise<void> {
    await this.resolveWithIndexedDbFallback(
      (database) => this.deleteRecordFromIndexedDb(database, storeName, recordId),
      () => {
        this.deleteRecordFromLocalStorage(storeName, recordId);
      },
    );
  }

  private async readCollectionFromIndexedDb<T extends { id: string }>(
    database: IDBDatabase,
    storeName: string,
  ): Promise<PersistenceResult<T[]>> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: PersistenceResult<T[]>) => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(result);
      };

      try {
        const transaction = database.transaction(storeName, 'readonly');
        const request = transaction.objectStore(storeName).getAll();

        request.onsuccess = () => finish(this.success((request.result ?? []) as T[]));
        request.onerror = () => finish(this.failure('request-error', true));
        transaction.onerror = () => finish(this.failure('transaction-error', true));
        transaction.onabort = () => finish(this.failure('aborted', true));
      } catch {
        finish(this.failure('invalid-state', true));
      }
    });
  }

  private async readRecordFromIndexedDb<T>(
    database: IDBDatabase,
    storeName: string,
    recordId: string,
  ): Promise<PersistenceRecordResult<T>> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: PersistenceRecordResult<T>) => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(result);
      };

      try {
        const transaction = database.transaction(storeName, 'readonly');
        const request = transaction.objectStore(storeName).get(recordId);

        request.onsuccess = () => {
          const result = request.result as T | undefined;
          finish(result === undefined ? this.missingRecord<T>() : this.foundRecord(result));
        };
        request.onerror = () => finish(this.recordFailure('request-error', true));
        transaction.onerror = () => finish(this.recordFailure('transaction-error', true));
        transaction.onabort = () => finish(this.recordFailure('aborted', true));
      } catch {
        finish(this.recordFailure('invalid-state', true));
      }
    });
  }

  private async writeRecordToIndexedDb<T extends { id: string }>(
    database: IDBDatabase,
    storeName: string,
    record: T,
  ): Promise<PersistenceResult<void>> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: PersistenceResult<void>) => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(result);
      };

      try {
        const transaction = database.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).put(record);
        transaction.oncomplete = () => finish(this.success(undefined));
        transaction.onerror = () => finish(this.failure('transaction-error', true));
        transaction.onabort = () => finish(this.failure('aborted', true));
      } catch {
        finish(this.failure('invalid-state', true));
      }
    });
  }

  private async deleteRecordFromIndexedDb(
    database: IDBDatabase,
    storeName: string,
    recordId: string,
  ): Promise<PersistenceResult<void>> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: PersistenceResult<void>) => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(result);
      };

      try {
        const transaction = database.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).delete(recordId);
        transaction.oncomplete = () => finish(this.success(undefined));
        transaction.onerror = () => finish(this.failure('transaction-error', true));
        transaction.onabort = () => finish(this.failure('aborted', true));
      } catch {
        finish(this.failure('invalid-state', true));
      }
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
      const parsedValue = JSON.parse(rawValue) as unknown;
      return Array.isArray(parsedValue) ? (parsedValue as T[]) : [];
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

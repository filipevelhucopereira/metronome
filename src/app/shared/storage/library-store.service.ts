import { Injectable, computed, inject, signal } from '@angular/core';

import { type Setlist, type SetlistDraft } from '../models/setlist.model';
import { type Song, type SongDraft } from '../models/song.model';
import { LibraryStorageService } from './library-storage.service';

@Injectable({ providedIn: 'root' })
export class LibraryStoreService {
  private readonly storage = inject(LibraryStorageService);

  private readonly songsState = signal<Song[]>([]);
  private readonly songsLoaded = signal(false);
  private readonly setlistsState = signal<Setlist[]>([]);
  private readonly setlistsLoaded = signal(false);

  readonly songs = computed(() => this.songsState());
  readonly setlists = computed(() => this.setlistsState());

  async ensureSongsLoaded(): Promise<void> {
    if (this.songsLoaded()) {
      return;
    }

    this.songsState.set(await this.storage.listSongs());
    this.songsLoaded.set(true);
  }

  async saveSong(song: SongDraft | Song): Promise<Song> {
    const savedSong = await this.storage.saveSong(song);
    this.upsertSong(savedSong);
    return savedSong;
  }

  async ensureSetlistsLoaded(): Promise<void> {
    if (this.setlistsLoaded()) {
      return;
    }

    this.replaceSetlists(await this.storage.listSetlists());
  }

  async saveSetlist(setlist: SetlistDraft | Setlist): Promise<Setlist> {
    const savedSetlist = await this.storage.saveSetlist(setlist);
    this.mergeSetlist(savedSetlist);
    return savedSetlist;
  }

  async getSetlist(setlistId: string): Promise<Setlist | null> {
    if (!setlistId) {
      return null;
    }

    const cachedSetlist = this.setlistsState().find((setlist) => setlist.id === setlistId) ?? null;

    if (cachedSetlist) {
      return cachedSetlist;
    }

    const storedSetlist = await this.storage.getSetlist(setlistId);

    if (storedSetlist) {
      this.mergeSetlist(storedSetlist);
    }

    return storedSetlist;
  }

  async addSongToSetlist(setlistId: string, songId: string): Promise<Setlist | null> {
    const updatedSetlist = await this.storage.addSongToSetlist(setlistId, songId);

    if (!updatedSetlist) {
      return null;
    }

    this.mergeSetlist(updatedSetlist);
    return updatedSetlist;
  }

  async removeSongFromSetlist(setlistId: string, songIndex: number): Promise<Setlist | null> {
    const updatedSetlist = await this.storage.removeSongFromSetlist(setlistId, songIndex);

    if (!updatedSetlist) {
      return null;
    }

    this.mergeSetlist(updatedSetlist);
    return updatedSetlist;
  }

  async reorderSetlistSongs(setlistId: string, songIds: string[]): Promise<Setlist | null> {
    const updatedSetlist = await this.storage.reorderSetlistSongs(setlistId, songIds);

    if (!updatedSetlist) {
      return null;
    }

    this.mergeSetlist(updatedSetlist);
    return updatedSetlist;
  }

  async deleteSetlist(setlistId: string): Promise<void> {
    await this.storage.deleteSetlist(setlistId);
    this.setlistsState.update((setlists) => setlists.filter((setlist) => setlist.id !== setlistId));
  }

  async duplicateSong(songId: string): Promise<Song | null> {
    const duplicatedSong = await this.storage.duplicateSong(songId);

    if (!duplicatedSong) {
      return null;
    }

    this.upsertSong(duplicatedSong);
    return duplicatedSong;
  }

  async deleteSong(songId: string): Promise<void> {
    const updatedSetlists = await this.storage.deleteSong(songId);
    this.songsState.update((songs) => songs.filter((song) => song.id !== songId));
    this.songsLoaded.set(true);
    this.mergeSetlists(updatedSetlists ?? []);
  }

  private upsertSong(song: Song): void {
    this.songsState.update((songs) => {
      const nextSongs = songs.filter((existingSong) => existingSong.id !== song.id);
      nextSongs.push(song);
      nextSongs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      return nextSongs;
    });
    this.songsLoaded.set(true);
  }

  private replaceSetlists(setlists: Setlist[]): void {
    this.setlistsState.set(this.sortSetlists(setlists));
    this.setlistsLoaded.set(true);
  }

  private mergeSetlist(setlist: Setlist): void {
    this.mergeSetlists([setlist]);
  }

  private mergeSetlists(setlists: Setlist[]): void {
    if (setlists.length === 0) {
      return;
    }

    this.setlistsState.update((currentSetlists) => {
      const updatedSetlistsById = new Map(setlists.map((setlist) => [setlist.id, setlist]));
      const nextSetlists = currentSetlists.filter((setlist) => !updatedSetlistsById.has(setlist.id));
      nextSetlists.push(...updatedSetlistsById.values());
      return this.sortSetlists(nextSetlists);
    });
  }

  private sortSetlists(setlists: Setlist[]): Setlist[] {
    return [...setlists].sort((left, right) => left.name.localeCompare(right.name));
  }
}

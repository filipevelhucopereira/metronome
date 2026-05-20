import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { MetronomeService } from '../../core/metronome/metronome.service';
import { LibraryStorageService } from '../../shared/storage/library-storage.service';
import { type RhythmOption, type Song, type SongDraft } from '../../shared/models/song.model';
import { SongEditorComponent } from './song-editor.component';

type SongFilterValue = 'all' | RhythmOption;

@Component({
  selector: 'app-song-library',
  imports: [SongEditorComponent],
  templateUrl: './song-library.component.html',
  styleUrl: './song-library.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SongLibraryComponent {
  private readonly storage = inject(LibraryStorageService);
  private readonly metronome = inject(MetronomeService);
  private readonly router = inject(Router);

  protected readonly songs = signal<Song[]>([]);
  protected readonly editorOpen = signal(false);
  protected readonly editingSong = signal<Song | null>(null);
  protected readonly rhythmFilters = [
    { value: 'all', label: 'All' },
    { value: 'straight', label: 'Straight' },
    { value: 'swing', label: 'Swing' },
    { value: 'compound', label: 'Compound' },
  ] as const;
  protected readonly selectedFilter = signal<SongFilterValue>('all');
  protected readonly currentSongId = computed(() => this.metronome.activeSongId());
  protected readonly activeSong = computed(() => this.songs().find((song) => song.id === this.currentSongId()) ?? null);
  protected readonly filteredSongs = computed(() => {
    const filter = this.selectedFilter();

    if (filter === 'all') {
      return this.songs();
    }

    return this.songs().filter((song) => song.rhythm === filter);
  });

  constructor() {
    void this.refresh();
  }

  protected openNewSong(): void {
    this.editingSong.set(null);
    this.editorOpen.set(true);
  }

  protected openEditSong(song: Song): void {
    this.editingSong.set(song);
    this.editorOpen.set(true);
  }

  protected closeEditor(): void {
    this.editorOpen.set(false);
    this.editingSong.set(null);
  }

  protected setFilter(value: SongFilterValue): void {
    this.selectedFilter.set(value);
  }

  protected async saveSong(draft: SongDraft): Promise<void> {
    const existingSong = this.editingSong();
    await this.storage.saveSong(existingSong ? { ...existingSong, ...draft } : draft);
    await this.refresh();
    this.closeEditor();
  }

  protected async loadSong(song: Song): Promise<void> {
    await this.metronome.loadSong(song);
    await this.router.navigateByUrl('/');
  }

  protected async duplicateSong(songId: string): Promise<void> {
    await this.storage.duplicateSong(songId);
    await this.refresh();
  }

  protected async deleteSong(songId: string): Promise<void> {
    await this.storage.deleteSong(songId);
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    this.songs.set(await this.storage.listSongs());
  }
}

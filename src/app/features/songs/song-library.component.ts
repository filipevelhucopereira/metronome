import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { MetronomeService } from '../../core/metronome/metronome.service';
import { LibraryStorageService } from '../../shared/storage/library-storage.service';
import { type Song, type SongDraft } from '../../shared/models/song.model';
import { SongEditorComponent } from './song-editor.component';

@Component({
  selector: 'app-song-library',
  imports: [RouterLink, SongEditorComponent],
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
  protected readonly currentSongId = computed(() => this.metronome.activeSongId());

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

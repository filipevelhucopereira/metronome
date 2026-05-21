import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { moveItem, resolveSetlist } from '../../core/metronome/metronome.helpers';
import { MetronomeService } from '../../core/metronome/metronome.service';
import { type ResolvedSetlist, type ResolvedSetlistEntry, type Setlist } from '../../shared/models/setlist.model';
import { type Song } from '../../shared/models/song.model';
import { LibraryStoreService } from '../../shared/storage/library-store.service';

@Component({
  selector: 'app-setlist-detail',
  imports: [ReactiveFormsModule, RouterLink, CdkDropList, CdkDrag, CdkDragHandle],
  templateUrl: './setlist-detail.component.html',
  styleUrl: './setlist-detail.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetlistDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly libraryStore = inject(LibraryStoreService);
  private readonly metronome = inject(MetronomeService);

  protected readonly setlist = signal<ResolvedSetlist | null>(null);
  protected readonly librarySongs = signal<Song[]>([]);
  protected readonly announcement = signal('');
  protected readonly activeSetlistId = computed(() => this.metronome.activeSetlistId());
  protected readonly activeSetlistIndex = computed(() => this.metronome.activeSetlistIndex());
  protected readonly isActiveSetlist = computed(() => this.setlist()?.id === this.activeSetlistId());
  protected readonly currentOrder = computed(() => (this.isActiveSetlist() ? this.activeSetlistIndex() : -1));
  protected readonly nextOrder = computed(() => (this.isActiveSetlist() ? this.activeSetlistIndex() + 1 : -1));

  protected readonly nameControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.pattern(/\S/), Validators.maxLength(64)],
  });

  protected readonly addSongControl = new FormControl('', {
    nonNullable: true,
  });

  constructor() {
    void this.refresh();
  }

  protected async saveName(): Promise<void> {
    const setlist = this.setlist();

    if (!setlist || this.nameControl.invalid) {
      this.nameControl.markAsTouched();
      return;
    }

    const updatedSetlist = await this.libraryStore.saveSetlist({
      ...setlist,
      name: this.nameControl.getRawValue().trim(),
    });

    this.nameControl.markAsPristine();
    this.applyStoredSetlist(updatedSetlist);
  }

  protected async addSong(): Promise<void> {
    const setlist = this.setlist();
    const songId = this.addSongControl.getRawValue();

    if (!setlist || !songId) {
      return;
    }

    const updatedSetlist = await this.libraryStore.addSongToSetlist(setlist.id, songId);

    if (!updatedSetlist) {
      return;
    }

    this.addSongControl.reset('');
    this.applyStoredSetlist(updatedSetlist);
  }

  protected async removeSong(index: number): Promise<void> {
    const setlist = this.setlist();

    if (!setlist) {
      return;
    }

    const updatedSetlist = await this.libraryStore.removeSongFromSetlist(setlist.id, index);

    if (!updatedSetlist) {
      return;
    }

    this.applyStoredSetlist(updatedSetlist);
  }

  protected async moveSong(previousIndex: number, currentIndex: number): Promise<void> {
    const setlist = this.setlist();

    if (!setlist || previousIndex === currentIndex || currentIndex < 0 || currentIndex >= setlist.songIds.length) {
      return;
    }

    const nextSongIds = moveItem(setlist.songIds, previousIndex, currentIndex);
    await this.persistSongOrder(nextSongIds);
    this.announceMove(currentIndex);
    this.focusHandle(currentIndex);
  }

  protected async dropSong(event: CdkDragDrop<ResolvedSetlistEntry[]>): Promise<void> {
    await this.moveSong(event.previousIndex, event.currentIndex);
  }

  protected async playSetlist(): Promise<void> {
    const setlist = this.setlist();

    if (!setlist) {
      return;
    }

    await this.metronome.startSetlist(setlist.id);
    await this.router.navigateByUrl('/');
  }

  private announceMove(position: number): void {
    this.announcement.set(`Moved song to position ${position + 1}.`);
  }

  private focusHandle(position: number): void {
    queueMicrotask(() => {
      document.getElementById(`setlist-handle-${position}`)?.focus();
    });
  }

  private async persistSongOrder(songIds: string[]): Promise<void> {
    const setlist = this.setlist();

    if (!setlist) {
      return;
    }

    const updatedSetlist = await this.libraryStore.reorderSetlistSongs(setlist.id, songIds);

    if (!updatedSetlist) {
      return;
    }

    await this.metronome.reorderSetlistSongs(setlist.id, songIds);
    this.applyStoredSetlist(updatedSetlist);
  }

  private async refresh(): Promise<void> {
    const setlistId = this.route.snapshot.paramMap.get('id');

    if (!setlistId) {
      return;
    }

    await this.libraryStore.ensureSongsLoaded();

    const [storedSetlist, songs] = await Promise.all([
      this.libraryStore.getSetlist(setlistId),
      Promise.resolve(this.libraryStore.songs()),
    ]);

    this.librarySongs.set(songs);
    this.applyStoredSetlist(storedSetlist, songs);
  }

  private applyStoredSetlist(storedSetlist: Setlist | null, songs = this.librarySongs()): void {
    const setlist = storedSetlist ? resolveSetlist(storedSetlist, songs) : null;

    this.setlist.set(setlist);

    if (setlist && !this.nameControl.dirty) {
      this.nameControl.setValue(setlist.name);
      this.nameControl.markAsUntouched();
    }
  }
}

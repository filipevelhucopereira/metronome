import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { moveItem } from '../../core/metronome/metronome.helpers';
import { MetronomeService } from '../../core/metronome/metronome.service';
import { type ResolvedSetlist, type ResolvedSetlistEntry } from '../../shared/models/setlist.model';
import { type Song } from '../../shared/models/song.model';
import { LibraryStorageService } from '../../shared/storage/library-storage.service';

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
  private readonly storage = inject(LibraryStorageService);
  private readonly metronome = inject(MetronomeService);

  protected readonly setlist = signal<ResolvedSetlist | null>(null);
  protected readonly librarySongs = signal<Song[]>([]);
  protected readonly announcement = signal('');
  protected readonly activeSetlistId = computed(() => this.metronome.activeSetlistId());
  protected readonly activeSetlistIndex = computed(() => this.metronome.activeSetlistIndex());
  protected readonly isActiveSetlist = computed(() => this.setlist()?.id === this.activeSetlistId());

  protected readonly nameControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(64)],
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

    await this.storage.saveSetlist({
      ...setlist,
      name: this.nameControl.getRawValue().trim(),
    });

    await this.refresh();
  }

  protected async addSong(): Promise<void> {
    const setlist = this.setlist();
    const songId = this.addSongControl.getRawValue();

    if (!setlist || !songId) {
      return;
    }

    await this.storage.addSongToSetlist(setlist.id, songId);
    this.addSongControl.reset('');
    await this.refresh();
  }

  protected async removeSong(index: number): Promise<void> {
    const setlist = this.setlist();

    if (!setlist) {
      return;
    }

    await this.storage.removeSongFromSetlist(setlist.id, index);
    await this.refresh();
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

  protected isCurrentEntry(entry: ResolvedSetlistEntry): boolean {
    return this.isActiveSetlist() && this.activeSetlistIndex() === entry.order;
  }

  protected isNextEntry(entry: ResolvedSetlistEntry): boolean {
    return this.isActiveSetlist() && this.activeSetlistIndex() + 1 === entry.order;
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

    await this.storage.reorderSetlistSongs(setlist.id, songIds);
    await this.metronome.reorderSetlistSongs(setlist.id, songIds);
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    const setlistId = this.route.snapshot.paramMap.get('id');

    if (!setlistId) {
      return;
    }

    const [setlist, songs] = await Promise.all([
      this.storage.getResolvedSetlist(setlistId),
      this.storage.listSongs(),
    ]);

    this.setlist.set(setlist);
    this.librarySongs.set(songs);

    if (setlist) {
      this.nameControl.setValue(setlist.name);
    }
  }
}

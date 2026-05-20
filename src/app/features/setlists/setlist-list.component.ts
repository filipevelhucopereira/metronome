import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { MetronomeService } from '../../core/metronome/metronome.service';
import { LibraryStorageService } from '../../shared/storage/library-storage.service';
import { type Setlist } from '../../shared/models/setlist.model';

type SetlistFilterValue = 'all' | 'active' | 'recent';

@Component({
  selector: 'app-setlist-list',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './setlist-list.component.html',
  styleUrl: './setlist-list.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetlistListComponent {
  private readonly storage = inject(LibraryStorageService);
  private readonly metronome = inject(MetronomeService);
  private readonly router = inject(Router);

  protected readonly setlists = signal<Setlist[]>([]);
  protected readonly setlistFilters = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'recent', label: 'Recent' },
  ] as const;
  protected readonly selectedFilter = signal<SetlistFilterValue>('all');
  protected readonly currentSetlistId = computed(() => this.metronome.activeSetlistId());
  protected readonly activeSetlist = computed(() => this.setlists().find((setlist) => setlist.id === this.currentSetlistId()) ?? null);
  protected readonly filteredSetlists = computed(() => {
    const filter = this.selectedFilter();
    const setlists = this.setlists();

    if (filter === 'active') {
      const activeId = this.currentSetlistId();
      return activeId ? setlists.filter((setlist) => setlist.id === activeId) : [];
    }

    if (filter === 'recent') {
      return [...setlists].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }

    return setlists;
  });
  protected readonly createControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(64)],
  });

  constructor() {
    void this.refresh();
  }

  protected async createSetlist(): Promise<void> {
    if (this.createControl.invalid) {
      this.createControl.markAsTouched();
      return;
    }

    const setlist = await this.storage.saveSetlist({
      name: this.createControl.getRawValue().trim(),
      songIds: [],
    });

    this.createControl.reset('');
    await this.refresh();
    await this.router.navigate(['/setlists', setlist.id]);
  }

  protected async startSetlist(setlistId: string): Promise<void> {
    await this.metronome.startSetlist(setlistId);
    await this.router.navigateByUrl('/');
  }

  protected async deleteSetlist(setlistId: string): Promise<void> {
    await this.storage.deleteSetlist(setlistId);
    await this.refresh();
  }

  protected setFilter(value: SetlistFilterValue): void {
    this.selectedFilter.set(value);
  }

  protected previewWidth(songCount: number): string {
    return `${Math.min(82, 18 + (songCount * 9))}%`;
  }

  private async refresh(): Promise<void> {
    this.setlists.set(await this.storage.listSetlists());
  }
}

import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { MetronomeService } from '../../core/metronome/metronome.service';
import { type Setlist } from '../../shared/models/setlist.model';
import { LibraryStorageService } from '../../shared/storage/library-storage.service';
import { SetlistListComponent } from './setlist-list.component';

describe('SetlistListComponent', () => {
  const alphaSetlist: Setlist = {
    id: 'set-1',
    name: 'Alpha Flow',
    songIds: ['song-1'],
    createdAt: '2026-05-21T08:00:00.000Z',
    updatedAt: '2026-05-21T08:00:00.000Z',
  };

  const deltaSetlist: Setlist = {
    id: 'set-2',
    name: 'Delta Pocket',
    songIds: ['song-2', 'song-3'],
    createdAt: '2026-05-21T08:10:00.000Z',
    updatedAt: '2026-05-21T08:10:00.000Z',
  };

  const bravoSetlist: Setlist = {
    id: 'set-3',
    name: 'Bravo Line',
    songIds: [],
    createdAt: '2026-05-21T08:20:00.000Z',
    updatedAt: '2026-05-21T08:20:00.000Z',
  };

  function createStorageStub() {
    return {
      listSetlists: vi.fn().mockResolvedValue([alphaSetlist, deltaSetlist]),
      saveSetlist: vi.fn().mockResolvedValue(bravoSetlist),
      deleteSetlist: vi.fn().mockResolvedValue(undefined),
    };
  }

  function createMetronomeStub() {
    return {
      activeSetlistId: vi.fn(() => null),
      startSetlist: vi.fn(),
    };
  }

  async function createComponent() {
    const storage = createStorageStub();
    const metronome = createMetronomeStub();

    await TestBed.configureTestingModule({
      imports: [SetlistListComponent],
      providers: [
        provideRouter([]),
        {
          provide: LibraryStorageService,
          useValue: storage,
        },
        {
          provide: MetronomeService,
          useValue: metronome,
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SetlistListComponent);
    await fixture.whenStable();

    return {
      storage,
      router: TestBed.inject(Router),
      component: fixture.componentInstance as unknown as {
        setlists: { (): Setlist[] };
        createControl: { setValue(value: string): void; value: string };
        createSetlist(): Promise<void>;
        deleteSetlist(setlistId: string): Promise<void>;
      },
    };
  }

  it('adds a created setlist locally without reloading the full collection', async () => {
    const { component, router, storage } = await createComponent();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    component.createControl.setValue(bravoSetlist.name);

    await component.createSetlist();

    expect(storage.listSetlists).toHaveBeenCalledTimes(1);
    expect(component.setlists()).toEqual([alphaSetlist, bravoSetlist, deltaSetlist]);
    expect(component.createControl.value).toBe('');
    expect(navigate).toHaveBeenCalledWith(['/setlists', bravoSetlist.id]);
  });

  it('removes a deleted setlist locally without reloading the full collection', async () => {
    const { component, storage } = await createComponent();

    await component.deleteSetlist(deltaSetlist.id);

    expect(storage.listSetlists).toHaveBeenCalledTimes(1);
    expect(component.setlists()).toEqual([alphaSetlist]);
  });
});

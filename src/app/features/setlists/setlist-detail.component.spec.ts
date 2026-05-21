import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { MetronomeService } from '../../core/metronome/metronome.service';
import { type ResolvedSetlist } from '../../shared/models/setlist.model';
import { type Song } from '../../shared/models/song.model';
import { LibraryStorageService } from '../../shared/storage/library-storage.service';
import { SetlistDetailComponent } from './setlist-detail.component';

describe('SetlistDetailComponent', () => {
  const songs: Song[] = [
    {
      id: 'song-1',
      name: 'Intro Pulse',
      tempo: 120,
      beatsPerBar: 4,
      subdivision: 1,
      rhythm: 'straight',
      volume: 0.72,
      createdAt: '2026-05-21T10:00:00.000Z',
      updatedAt: '2026-05-21T10:00:00.000Z',
    },
    {
      id: 'song-2',
      name: 'Bridge Count',
      tempo: 132,
      beatsPerBar: 3,
      subdivision: 2,
      rhythm: 'swing',
      volume: 0.68,
      createdAt: '2026-05-21T10:01:00.000Z',
      updatedAt: '2026-05-21T10:01:00.000Z',
    },
    {
      id: 'song-3',
      name: 'Final Accent',
      tempo: 144,
      beatsPerBar: 5,
      subdivision: 1,
      rhythm: 'straight',
      volume: 0.74,
      createdAt: '2026-05-21T10:02:00.000Z',
      updatedAt: '2026-05-21T10:02:00.000Z',
    },
  ];

  const initialSetlist: ResolvedSetlist = {
    id: 'set-1',
    name: 'Warmup',
    songIds: ['song-1', 'song-2'],
    createdAt: '2026-05-21T10:05:00.000Z',
    updatedAt: '2026-05-21T10:05:00.000Z',
    missingSongIds: [],
    entries: [
      {
        id: 'set-1:0:song-1',
        songId: 'song-1',
        order: 0,
        song: songs[0],
      },
      {
        id: 'set-1:1:song-2',
        songId: 'song-2',
        order: 1,
        song: songs[1],
      },
    ],
  };

  const baseSetlist = {
    id: initialSetlist.id,
    name: initialSetlist.name,
    songIds: [...initialSetlist.songIds],
    createdAt: initialSetlist.createdAt,
    updatedAt: initialSetlist.updatedAt,
  };

  const renamedStoredSetlist = {
    ...baseSetlist,
    name: 'Warmup Revised',
    updatedAt: '2026-05-21T10:06:00.000Z',
  };

  const storedSetlistWithAddedSong = {
    ...baseSetlist,
    songIds: ['song-1', 'song-2', 'song-3'],
    updatedAt: '2026-05-21T10:06:30.000Z',
  };

  const storedSetlistWithoutFirstSong = {
    ...baseSetlist,
    songIds: ['song-2'],
    updatedAt: '2026-05-21T10:06:45.000Z',
  };

  const reorderedStoredSetlist = {
    ...baseSetlist,
    songIds: ['song-2', 'song-1'],
    updatedAt: '2026-05-21T10:06:00.000Z',
  };

  const reorderedSetlist: ResolvedSetlist = {
    ...initialSetlist,
    songIds: reorderedStoredSetlist.songIds,
    updatedAt: reorderedStoredSetlist.updatedAt,
    entries: [
      {
        id: 'set-1:0:song-2',
        songId: 'song-2',
        order: 0,
        song: songs[1],
      },
      {
        id: 'set-1:1:song-1',
        songId: 'song-1',
        order: 1,
        song: songs[0],
      },
    ],
  };

  const resolvedSetlistWithoutFirstSong: ResolvedSetlist = {
    ...initialSetlist,
    songIds: storedSetlistWithoutFirstSong.songIds,
    updatedAt: storedSetlistWithoutFirstSong.updatedAt,
    entries: [
      {
        id: 'set-1:0:song-2',
        songId: 'song-2',
        order: 0,
        song: songs[1],
      },
    ],
  };

  function createStorageStub() {
    return {
      getResolvedSetlist: vi.fn(),
      getSetlist: vi.fn().mockResolvedValue(baseSetlist),
      listSongs: vi.fn().mockResolvedValue(songs),
      loadPreferences: vi.fn(() => new Promise<never>(() => {})),
      saveSetlist: vi.fn().mockResolvedValue(renamedStoredSetlist),
      addSongToSetlist: vi.fn().mockResolvedValue(storedSetlistWithAddedSong),
      removeSongFromSetlist: vi.fn().mockResolvedValue(storedSetlistWithoutFirstSong),
      reorderSetlistSongs: vi.fn().mockResolvedValue(reorderedStoredSetlist),
      savePreferences: vi.fn(),
    };
  }

  async function createComponent(storage = createStorageStub()) {
    await TestBed.configureTestingModule({
      imports: [SetlistDetailComponent],
      providers: [
        MetronomeService,
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ id: initialSetlist.id }),
            },
          },
        },
        {
          provide: LibraryStorageService,
          useValue: storage,
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SetlistDetailComponent);
    await fixture.whenStable();

    return {
      fixture,
      component: fixture.componentInstance as unknown as {
        moveSong(previousIndex: number, currentIndex: number): Promise<void>;
        saveName(): Promise<void>;
        addSong(): Promise<void>;
        removeSong(index: number): Promise<void>;
        setlist: { set(value: ResolvedSetlist | null): void; (): ResolvedSetlist | null };
        nameControl: { setValue(value: string): void };
        addSongControl: { setValue(value: string): void; value: string };
      },
      storage,
    };
  }

  it('hydrates the view model from one setlist read and one song-library read', async () => {
    const { component, storage } = await createComponent();

    expect(storage.getSetlist).toHaveBeenCalledWith(initialSetlist.id);
    expect(storage.listSongs).toHaveBeenCalledTimes(1);
    expect(storage.getResolvedSetlist).not.toHaveBeenCalled();
    expect(component.setlist()).toEqual(initialSetlist);
  });

  it('updates the local setlist after rename without rereading storage', async () => {
    const { component, storage } = await createComponent();

    component.nameControl.setValue(renamedStoredSetlist.name);

    await component.saveName();

    expect(storage.saveSetlist).toHaveBeenCalledWith({
      ...initialSetlist,
      name: renamedStoredSetlist.name,
    });
    expect(storage.getSetlist).toHaveBeenCalledTimes(1);
    expect(storage.listSongs).toHaveBeenCalledTimes(1);
    expect(component.setlist()?.name).toBe(renamedStoredSetlist.name);
  });

  it('updates the local resolved setlist after adding a song without rereading storage', async () => {
    const { component, storage } = await createComponent();

    component.addSongControl.setValue('song-3');

    await component.addSong();

    expect(storage.addSongToSetlist).toHaveBeenCalledWith(initialSetlist.id, 'song-3');
    expect(storage.getSetlist).toHaveBeenCalledTimes(1);
    expect(storage.listSongs).toHaveBeenCalledTimes(1);
    expect(component.addSongControl.value).toBe('');
    expect(component.setlist()?.entries.map((entry) => entry.songId)).toEqual(['song-1', 'song-2', 'song-3']);
  });

  it('updates the local resolved setlist after removing a song without rereading storage', async () => {
    const { component, storage } = await createComponent();

    await component.removeSong(0);

    expect(storage.removeSongFromSetlist).toHaveBeenCalledWith(initialSetlist.id, 0);
    expect(storage.getSetlist).toHaveBeenCalledTimes(1);
    expect(storage.listSongs).toHaveBeenCalledTimes(1);
    expect(component.setlist()).toEqual(resolvedSetlistWithoutFirstSong);
  });

  it('persists reordered songs only once per move', async () => {
    const { component, storage } = await createComponent();

    component.setlist.set(initialSetlist);

    await component.moveSong(0, 1);

    expect(storage.reorderSetlistSongs).toHaveBeenCalledTimes(1);
    expect(storage.reorderSetlistSongs).toHaveBeenCalledWith(initialSetlist.id, ['song-2', 'song-1']);
    expect(storage.getSetlist).toHaveBeenCalledTimes(1);
    expect(storage.listSongs).toHaveBeenCalledTimes(1);
    expect(component.setlist()).toEqual(reorderedSetlist);
  });
});

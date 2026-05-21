import { TestBed } from '@angular/core/testing';

import { type Setlist } from '../models/setlist.model';
import { type Song } from '../models/song.model';
import { LibraryStorageService } from './library-storage.service';
import { LibraryStoreService } from './library-store.service';

describe('LibraryStoreService', () => {
  const songOne: Song = {
    id: 'song-1',
    name: 'Intro Pulse',
    tempo: 120,
    beatsPerBar: 4,
    subdivision: 1,
    rhythm: 'straight',
    volume: 0.72,
    createdAt: '2026-05-21T11:00:00.000Z',
    updatedAt: '2026-05-21T11:00:00.000Z',
  };

  const songTwo: Song = {
    id: 'song-2',
    name: 'Bridge Count',
    tempo: 132,
    beatsPerBar: 3,
    subdivision: 2,
    rhythm: 'swing',
    volume: 0.68,
    createdAt: '2026-05-21T11:01:00.000Z',
    updatedAt: '2026-05-21T11:01:00.000Z',
  };

  const alphaSetlist: Setlist = {
    id: 'set-1',
    name: 'Alpha Flow',
    songIds: [songOne.id, songTwo.id],
    createdAt: '2026-05-21T11:05:00.000Z',
    updatedAt: '2026-05-21T11:05:00.000Z',
  };

  const bravoSetlist: Setlist = {
    id: 'set-2',
    name: 'Bravo Pocket',
    songIds: [songTwo.id],
    createdAt: '2026-05-21T11:06:00.000Z',
    updatedAt: '2026-05-21T11:06:00.000Z',
  };

  const alphaWithoutSongOne: Setlist = {
    ...alphaSetlist,
    songIds: [songTwo.id],
    updatedAt: '2026-05-21T11:07:00.000Z',
  };

  function createStorageStub() {
    return {
      getSetlist: vi.fn().mockResolvedValue(alphaSetlist),
      listSetlists: vi.fn().mockResolvedValue([alphaSetlist, bravoSetlist]),
      listSongs: vi.fn().mockResolvedValue([songOne, songTwo]),
      deleteSong: vi.fn().mockResolvedValue([alphaWithoutSongOne]),
      saveSetlist: vi.fn(),
      addSongToSetlist: vi.fn(),
      removeSongFromSetlist: vi.fn(),
      reorderSetlistSongs: vi.fn(),
      duplicateSong: vi.fn(),
      saveSong: vi.fn(),
      deleteSetlist: vi.fn(),
    };
  }

  function createService(storage = createStorageStub()): {
    storage: ReturnType<typeof createStorageStub>;
    store: LibraryStoreService;
  } {
    TestBed.configureTestingModule({
      providers: [
        LibraryStoreService,
        {
          provide: LibraryStorageService,
          useValue: storage,
        },
      ],
    });

    return {
      storage,
      store: TestBed.inject(LibraryStoreService),
    };
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('still loads the full setlist collection after caching one setlist by id', async () => {
    const { storage, store } = createService();

    expect(await store.getSetlist(alphaSetlist.id)).toEqual(alphaSetlist);

    await store.ensureSetlistsLoaded();

    expect(storage.getSetlist).toHaveBeenCalledWith(alphaSetlist.id);
    expect(storage.listSetlists).toHaveBeenCalledTimes(1);
    expect(store.setlists()).toEqual([alphaSetlist, bravoSetlist]);
  });

  it('reconciles cached setlists after deleting a song', async () => {
    const { storage, store } = createService();

    await store.ensureSongsLoaded();
    await store.ensureSetlistsLoaded();
    await store.deleteSong(songOne.id);

    expect(storage.deleteSong).toHaveBeenCalledWith(songOne.id);
    expect(storage.listSongs).toHaveBeenCalledTimes(1);
    expect(storage.listSetlists).toHaveBeenCalledTimes(1);
    expect(store.songs()).toEqual([songTwo]);
    expect(store.setlists()).toEqual([alphaWithoutSongOne, bravoSetlist]);
  });
});

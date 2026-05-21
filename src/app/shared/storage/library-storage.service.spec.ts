import { TestBed } from '@angular/core/testing';

import { DEFAULT_APP_PREFERENCES, type Setlist } from '../models/setlist.model';
import { type Song } from '../models/song.model';
import { LibraryStorageService } from './library-storage.service';

describe('LibraryStorageService', () => {
  const indexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const songsKey = 'metronome-pwa:songs';
  const setlistsKey = 'metronome-pwa:setlists';
  const preferencesKey = 'metronome-pwa:preferences';

  const songOne: Song = {
    id: 'song-1',
    name: 'Intro Pulse',
    tempo: 120,
    beatsPerBar: 4,
    subdivision: 1,
    rhythm: 'straight',
    volume: 0.72,
    createdAt: '2026-05-21T11:20:00.000Z',
    updatedAt: '2026-05-21T11:20:00.000Z',
  };

  const songTwo: Song = {
    id: 'song-2',
    name: 'Bridge Count',
    tempo: 132,
    beatsPerBar: 3,
    subdivision: 2,
    rhythm: 'swing',
    volume: 0.68,
    createdAt: '2026-05-21T11:21:00.000Z',
    updatedAt: '2026-05-21T11:21:00.000Z',
  };

  const alphaSetlist: Setlist = {
    id: 'set-1',
    name: 'Alpha Flow',
    songIds: [songOne.id, songTwo.id],
    createdAt: '2026-05-21T11:25:00.000Z',
    updatedAt: '2026-05-21T11:25:00.000Z',
  };

  const bravoSetlist: Setlist = {
    id: 'set-2',
    name: 'Bravo Pocket',
    songIds: [songTwo.id],
    createdAt: '2026-05-21T11:26:00.000Z',
    updatedAt: '2026-05-21T11:26:00.000Z',
  };

  const alphaWithoutSongOne: Setlist = {
    ...alphaSetlist,
    songIds: [songTwo.id],
  };

  function createOpenRequest(): {
    result: IDBDatabase | null;
    onupgradeneeded: ((this: IDBOpenDBRequest, event: IDBVersionChangeEvent) => unknown) | null;
    onsuccess: ((this: IDBOpenDBRequest, event: Event) => unknown) | null;
    onerror: ((this: IDBOpenDBRequest, event: Event) => unknown) | null;
    onblocked: ((this: IDBOpenDBRequest, event: Event) => unknown) | null;
  } {
    return {
      result: null,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      onblocked: null,
    };
  }

  function createSuccessRequest<T>(result: T): {
    result: T;
    onsuccess: ((this: IDBRequest<T>, event: Event) => unknown) | null;
    onerror: ((this: IDBRequest<T>, event: Event) => unknown) | null;
  } {
    return {
      result,
      onsuccess: null,
      onerror: null,
    };
  }

  function setIndexedDb(value: IDBFactory | undefined): void {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value,
    });
  }

  function restoreIndexedDb(): void {
    if (indexedDbDescriptor) {
      Object.defineProperty(globalThis, 'indexedDB', indexedDbDescriptor);
      return;
    }

    Reflect.deleteProperty(globalThis, 'indexedDB');
  }

  function createService(): LibraryStorageService {
    TestBed.configureTestingModule({
      providers: [LibraryStorageService],
    });

    return TestBed.inject(LibraryStorageService);
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    restoreIndexedDb();
    localStorage.removeItem(songsKey);
    localStorage.removeItem(setlistsKey);
    localStorage.removeItem(preferencesKey);
  });

  it('ignores malformed localStorage song collections instead of throwing', async () => {
    setIndexedDb(undefined);
    localStorage.setItem(songsKey, JSON.stringify({ id: songOne.id }));

    const service = createService();

    await expect(service.listSongs()).resolves.toEqual([]);
  });

  it('treats an IndexedDB record miss as not found without falling back to localStorage', async () => {
    localStorage.setItem(songsKey, JSON.stringify([songOne]));

    const openRequest = createOpenRequest();
    const songRequest = createSuccessRequest<Song | undefined>(undefined);
    const database = {
      objectStoreNames: {
        contains: vi.fn().mockReturnValue(true),
      },
      transaction: vi.fn().mockReturnValue({
        objectStore: vi.fn().mockReturnValue({
          get: vi.fn().mockImplementation(() => {
            queueMicrotask(() => {
              songRequest.onsuccess?.call(songRequest as unknown as IDBRequest<Song | undefined>, new Event('success'));
            });
            return songRequest;
          }),
        }),
      }),
    };
    const indexedDbFactory = {
      open: vi.fn().mockImplementation(() => {
        openRequest.result = database as unknown as IDBDatabase;
        queueMicrotask(() => {
          openRequest.onsuccess?.call(openRequest as unknown as IDBOpenDBRequest, new Event('success'));
        });
        return openRequest;
      }),
    };

    setIndexedDb(indexedDbFactory as unknown as IDBFactory);

    const service = createService();

    await expect(service.getSong(songOne.id)).resolves.toBeNull();
    expect(indexedDbFactory.open).toHaveBeenCalledTimes(1);
  });

  it('falls back to default preferences when localStorage preferences are not stored as a record collection', async () => {
    setIndexedDb(undefined);
    localStorage.setItem(preferencesKey, JSON.stringify({ id: 'app-preferences', lastSongId: songOne.id }));

    const service = createService();

    await expect(service.loadPreferences()).resolves.toEqual({ ...DEFAULT_APP_PREFERENCES });
  });

  it('clamps malformed activeSetlistIndex values in stored preferences back to zero', async () => {
    setIndexedDb(undefined);
    localStorage.setItem(preferencesKey, JSON.stringify([
      {
        id: 'app-preferences',
        lastTransport: {
          tempo: 188,
          beatsPerBar: 7,
          subdivision: 4,
          rhythm: 'straight',
          volume: 0.64,
        },
        activeSetlistIndex: 'oops',
      },
    ]));

    const service = createService();
    const preferences = await service.loadPreferences();

    expect(preferences.lastTransport.tempo).toBe(188);
    expect(preferences.activeSetlistIndex).toBe(0);
  });

  it('cascades song deletion through localStorage-backed setlists', async () => {
    setIndexedDb(undefined);
    localStorage.setItem(songsKey, JSON.stringify([songOne, songTwo]));
    localStorage.setItem(setlistsKey, JSON.stringify([alphaSetlist, bravoSetlist]));

    const service = createService();
    const updatedSetlists = await service.deleteSong(songOne.id);

    expect(updatedSetlists).toHaveLength(1);
    expect(updatedSetlists[0]).toMatchObject({
      id: alphaWithoutSongOne.id,
      name: alphaWithoutSongOne.name,
      songIds: alphaWithoutSongOne.songIds,
      createdAt: alphaWithoutSongOne.createdAt,
    });
    expect(updatedSetlists[0]?.updatedAt).not.toBe(alphaSetlist.updatedAt);

    const songs = await service.listSongs();

    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({
      id: songTwo.id,
      name: songTwo.name,
      tempo: songTwo.tempo,
      beatsPerBar: songTwo.beatsPerBar,
      subdivision: songTwo.subdivision,
      rhythm: songTwo.rhythm,
      volume: songTwo.volume,
      createdAt: songTwo.createdAt,
    });
    expect(songs[0]?.updatedAt).not.toBe(songTwo.updatedAt);

    const setlists = await service.listSetlists();

    expect(setlists).toHaveLength(2);
    expect(setlists[0]).toMatchObject({
      id: alphaWithoutSongOne.id,
      name: alphaWithoutSongOne.name,
      songIds: alphaWithoutSongOne.songIds,
      createdAt: alphaWithoutSongOne.createdAt,
    });
    expect(setlists[0]?.updatedAt).not.toBe(alphaSetlist.updatedAt);
    expect(setlists[1]).toEqual(bravoSetlist);
  });

  it('retries song writes when an IndexedDB write transaction aborts asynchronously', async () => {
    const firstOpenRequest = createOpenRequest();
    const secondOpenRequest = createOpenRequest();
    const firstAttemptPut = vi.fn();
    const secondAttemptPut = vi.fn();
    const abortingDatabase = {
      objectStoreNames: {
        contains: vi.fn().mockReturnValue(true),
      },
      transaction: vi.fn().mockImplementation(() => {
        const transaction = {
          oncomplete: null as (() => unknown) | null,
          onerror: null as (() => unknown) | null,
          onabort: null as (() => unknown) | null,
          objectStore: vi.fn().mockReturnValue({
            put: vi.fn().mockImplementation((record: Song) => {
              firstAttemptPut(record);
              queueMicrotask(() => {
                transaction.onabort?.();
              });
            }),
          }),
        };

        return transaction;
      }),
    };
    const recoveredDatabase = {
      objectStoreNames: {
        contains: vi.fn().mockReturnValue(true),
      },
      transaction: vi.fn().mockImplementation(() => {
        const transaction = {
          oncomplete: null as (() => unknown) | null,
          onerror: null as (() => unknown) | null,
          onabort: null as (() => unknown) | null,
          objectStore: vi.fn().mockReturnValue({
            put: vi.fn().mockImplementation((record: Song) => {
              secondAttemptPut(record);
              queueMicrotask(() => {
                transaction.oncomplete?.();
              });
            }),
          }),
        };

        return transaction;
      }),
    };
    const indexedDbFactory = {
      open: vi
        .fn()
        .mockImplementationOnce(() => {
          firstOpenRequest.result = abortingDatabase as unknown as IDBDatabase;
          queueMicrotask(() => {
            firstOpenRequest.onsuccess?.call(firstOpenRequest as unknown as IDBOpenDBRequest, new Event('success'));
          });
          return firstOpenRequest;
        })
        .mockImplementationOnce(() => {
          secondOpenRequest.result = recoveredDatabase as unknown as IDBDatabase;
          queueMicrotask(() => {
            secondOpenRequest.onsuccess?.call(secondOpenRequest as unknown as IDBOpenDBRequest, new Event('success'));
          });
          return secondOpenRequest;
        }),
    };

    setIndexedDb(indexedDbFactory as unknown as IDBFactory);

    const service = createService();
    const savedSong = await service.saveSong({
      name: 'Recovered Song',
      tempo: 118,
      beatsPerBar: 4,
      subdivision: 1,
      rhythm: 'straight',
      volume: 0.7,
    });

    expect(savedSong.name).toBe('Recovered Song');
    expect(firstAttemptPut).toHaveBeenCalledTimes(1);
    expect(secondAttemptPut).toHaveBeenCalledTimes(1);
    expect(indexedDbFactory.open).toHaveBeenCalledTimes(2);
  });

  it('retries setlist deletes when an IndexedDB write transaction errors asynchronously', async () => {
    const firstOpenRequest = createOpenRequest();
    const secondOpenRequest = createOpenRequest();
    const firstAttemptDelete = vi.fn();
    const secondAttemptDelete = vi.fn();
    const failingDatabase = {
      objectStoreNames: {
        contains: vi.fn().mockReturnValue(true),
      },
      transaction: vi.fn().mockImplementation(() => {
        const transaction = {
          oncomplete: null as (() => unknown) | null,
          onerror: null as (() => unknown) | null,
          onabort: null as (() => unknown) | null,
          objectStore: vi.fn().mockReturnValue({
            delete: vi.fn().mockImplementation((recordId: string) => {
              firstAttemptDelete(recordId);
              queueMicrotask(() => {
                transaction.onerror?.();
              });
            }),
          }),
        };

        return transaction;
      }),
    };
    const recoveredDatabase = {
      objectStoreNames: {
        contains: vi.fn().mockReturnValue(true),
      },
      transaction: vi.fn().mockImplementation(() => {
        const transaction = {
          oncomplete: null as (() => unknown) | null,
          onerror: null as (() => unknown) | null,
          onabort: null as (() => unknown) | null,
          objectStore: vi.fn().mockReturnValue({
            delete: vi.fn().mockImplementation((recordId: string) => {
              secondAttemptDelete(recordId);
              queueMicrotask(() => {
                transaction.oncomplete?.();
              });
            }),
          }),
        };

        return transaction;
      }),
    };
    const indexedDbFactory = {
      open: vi
        .fn()
        .mockImplementationOnce(() => {
          firstOpenRequest.result = failingDatabase as unknown as IDBDatabase;
          queueMicrotask(() => {
            firstOpenRequest.onsuccess?.call(firstOpenRequest as unknown as IDBOpenDBRequest, new Event('success'));
          });
          return firstOpenRequest;
        })
        .mockImplementationOnce(() => {
          secondOpenRequest.result = recoveredDatabase as unknown as IDBDatabase;
          queueMicrotask(() => {
            secondOpenRequest.onsuccess?.call(secondOpenRequest as unknown as IDBOpenDBRequest, new Event('success'));
          });
          return secondOpenRequest;
        }),
    };

    setIndexedDb(indexedDbFactory as unknown as IDBFactory);

    const service = createService();
    await service.deleteSetlist('set-1');

    expect(firstAttemptDelete).toHaveBeenCalledWith('set-1');
    expect(secondAttemptDelete).toHaveBeenCalledWith('set-1');
    expect(indexedDbFactory.open).toHaveBeenCalledTimes(2);
  });

  it('retries IndexedDB opens after a transient open failure instead of caching the fallback forever', async () => {
    localStorage.setItem(songsKey, JSON.stringify([songOne]));

    const firstOpenRequest = createOpenRequest();
    const secondOpenRequest = createOpenRequest();
    const songsRequest = createSuccessRequest([songTwo]);
    const database = {
      objectStoreNames: {
        contains: vi.fn().mockReturnValue(true),
      },
      transaction: vi.fn().mockReturnValue({
        objectStore: vi.fn().mockReturnValue({
          getAll: vi.fn().mockImplementation(() => {
            queueMicrotask(() => {
              songsRequest.onsuccess?.call(songsRequest as unknown as IDBRequest<Song[]>, new Event('success'));
            });
            return songsRequest;
          }),
        }),
      }),
    };
    const indexedDbFactory = {
      open: vi
        .fn()
        .mockImplementationOnce(() => {
          queueMicrotask(() => {
            firstOpenRequest.onerror?.call(firstOpenRequest as unknown as IDBOpenDBRequest, new Event('error'));
          });
          return firstOpenRequest;
        })
        .mockImplementationOnce(() => {
          secondOpenRequest.result = database as unknown as IDBDatabase;
          queueMicrotask(() => {
            secondOpenRequest.onsuccess?.call(secondOpenRequest as unknown as IDBOpenDBRequest, new Event('success'));
          });
          return secondOpenRequest;
        }),
    };

    setIndexedDb(indexedDbFactory as unknown as IDBFactory);

    const service = createService();

    expect((await service.listSongs()).map((song) => song.id)).toEqual([songOne.id]);
    expect((await service.listSongs()).map((song) => song.id)).toEqual([songTwo.id]);
    expect(indexedDbFactory.open).toHaveBeenCalledTimes(2);
  });

  it('recovers when a cached IndexedDB handle starts throwing on transaction creation', async () => {
    localStorage.setItem(songsKey, JSON.stringify([songOne]));

    const firstOpenRequest = createOpenRequest();
    const secondOpenRequest = createOpenRequest();
    const songsRequest = createSuccessRequest([songTwo]);
    const brokenDatabase = {
      objectStoreNames: {
        contains: vi.fn().mockReturnValue(true),
      },
      transaction: vi.fn().mockImplementation(() => {
        throw new DOMException('The database connection is closing.', 'InvalidStateError');
      }),
    };
    const recoveredDatabase = {
      objectStoreNames: {
        contains: vi.fn().mockReturnValue(true),
      },
      transaction: vi.fn().mockReturnValue({
        objectStore: vi.fn().mockReturnValue({
          getAll: vi.fn().mockImplementation(() => {
            queueMicrotask(() => {
              songsRequest.onsuccess?.call(songsRequest as unknown as IDBRequest<Song[]>, new Event('success'));
            });
            return songsRequest;
          }),
        }),
      }),
    };
    const indexedDbFactory = {
      open: vi
        .fn()
        .mockImplementationOnce(() => {
          firstOpenRequest.result = brokenDatabase as unknown as IDBDatabase;
          queueMicrotask(() => {
            firstOpenRequest.onsuccess?.call(firstOpenRequest as unknown as IDBOpenDBRequest, new Event('success'));
          });
          return firstOpenRequest;
        })
        .mockImplementationOnce(() => {
          secondOpenRequest.result = recoveredDatabase as unknown as IDBDatabase;
          queueMicrotask(() => {
            secondOpenRequest.onsuccess?.call(secondOpenRequest as unknown as IDBOpenDBRequest, new Event('success'));
          });
          return secondOpenRequest;
        }),
    };

    setIndexedDb(indexedDbFactory as unknown as IDBFactory);

    const service = createService();

    expect((await service.listSongs()).map((song) => song.id)).toEqual([songTwo.id]);
    expect((await service.listSongs()).map((song) => song.id)).toEqual([songTwo.id]);
    expect(indexedDbFactory.open).toHaveBeenCalledTimes(2);
  });

  it('retries song writes when a cached IndexedDB handle throws during write transaction creation', async () => {
    const firstOpenRequest = createOpenRequest();
    const secondOpenRequest = createOpenRequest();
    const putRecord = vi.fn();
    const brokenDatabase = {
      objectStoreNames: {
        contains: vi.fn().mockReturnValue(true),
      },
      transaction: vi.fn().mockImplementation(() => {
        throw new DOMException('The database connection is closing.', 'InvalidStateError');
      }),
    };
    const recoveredDatabase = {
      objectStoreNames: {
        contains: vi.fn().mockReturnValue(true),
      },
      transaction: vi.fn().mockImplementation(() => {
        const transaction = {
          oncomplete: null as (() => unknown) | null,
          onerror: null as (() => unknown) | null,
          onabort: null as (() => unknown) | null,
          objectStore: vi.fn().mockReturnValue({
            put: vi.fn().mockImplementation((record: Song) => {
              putRecord(record);
              queueMicrotask(() => {
                transaction.oncomplete?.();
              });
            }),
          }),
        };

        return transaction;
      }),
    };
    const indexedDbFactory = {
      open: vi
        .fn()
        .mockImplementationOnce(() => {
          firstOpenRequest.result = brokenDatabase as unknown as IDBDatabase;
          queueMicrotask(() => {
            firstOpenRequest.onsuccess?.call(firstOpenRequest as unknown as IDBOpenDBRequest, new Event('success'));
          });
          return firstOpenRequest;
        })
        .mockImplementationOnce(() => {
          secondOpenRequest.result = recoveredDatabase as unknown as IDBDatabase;
          queueMicrotask(() => {
            secondOpenRequest.onsuccess?.call(secondOpenRequest as unknown as IDBOpenDBRequest, new Event('success'));
          });
          return secondOpenRequest;
        }),
    };

    setIndexedDb(indexedDbFactory as unknown as IDBFactory);

    const service = createService();
    const savedSong = await service.saveSong({
      name: 'Recovered Song',
      tempo: 118,
      beatsPerBar: 4,
      subdivision: 1,
      rhythm: 'straight',
      volume: 0.7,
    });

    expect(savedSong.name).toBe('Recovered Song');
    expect(putRecord).toHaveBeenCalledTimes(1);
    expect(indexedDbFactory.open).toHaveBeenCalledTimes(2);
  });

  it('retries setlist deletes when a cached IndexedDB handle throws during write transaction creation', async () => {
    const firstOpenRequest = createOpenRequest();
    const secondOpenRequest = createOpenRequest();
    const deleteRecord = vi.fn();
    const brokenDatabase = {
      objectStoreNames: {
        contains: vi.fn().mockReturnValue(true),
      },
      transaction: vi.fn().mockImplementation(() => {
        throw new DOMException('The database connection is closing.', 'InvalidStateError');
      }),
    };
    const recoveredDatabase = {
      objectStoreNames: {
        contains: vi.fn().mockReturnValue(true),
      },
      transaction: vi.fn().mockImplementation(() => {
        const transaction = {
          oncomplete: null as (() => unknown) | null,
          onerror: null as (() => unknown) | null,
          onabort: null as (() => unknown) | null,
          objectStore: vi.fn().mockReturnValue({
            delete: vi.fn().mockImplementation((recordId: string) => {
              deleteRecord(recordId);
              queueMicrotask(() => {
                transaction.oncomplete?.();
              });
            }),
          }),
        };

        return transaction;
      }),
    };
    const indexedDbFactory = {
      open: vi
        .fn()
        .mockImplementationOnce(() => {
          firstOpenRequest.result = brokenDatabase as unknown as IDBDatabase;
          queueMicrotask(() => {
            firstOpenRequest.onsuccess?.call(firstOpenRequest as unknown as IDBOpenDBRequest, new Event('success'));
          });
          return firstOpenRequest;
        })
        .mockImplementationOnce(() => {
          secondOpenRequest.result = recoveredDatabase as unknown as IDBDatabase;
          queueMicrotask(() => {
            secondOpenRequest.onsuccess?.call(secondOpenRequest as unknown as IDBOpenDBRequest, new Event('success'));
          });
          return secondOpenRequest;
        }),
    };

    setIndexedDb(indexedDbFactory as unknown as IDBFactory);

    const service = createService();
    await service.deleteSetlist('set-1');

    expect(deleteRecord).toHaveBeenCalledWith('set-1');
    expect(indexedDbFactory.open).toHaveBeenCalledTimes(2);
  });
});

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { MetronomeService } from '../../core/metronome/metronome.service';
import { type Song, type SongDraft } from '../../shared/models/song.model';
import { LibraryStorageService } from '../../shared/storage/library-storage.service';
import { SongLibraryComponent } from './song-library.component';

describe('SongLibraryComponent', () => {
  const songOne: Song = {
    id: 'song-1',
    name: 'Warmup Grid',
    tempo: 120,
    beatsPerBar: 4,
    subdivision: 1,
    rhythm: 'straight',
    volume: 0.72,
    createdAt: '2026-05-21T09:00:00.000Z',
    updatedAt: '2026-05-21T09:00:00.000Z',
  };

  const songTwo: Song = {
    id: 'song-2',
    name: 'Swing Pocket',
    tempo: 132,
    beatsPerBar: 4,
    subdivision: 2,
    rhythm: 'swing',
    volume: 0.68,
    createdAt: '2026-05-21T09:10:00.000Z',
    updatedAt: '2026-05-21T09:10:00.000Z',
  };

  const savedSong: Song = {
    ...songOne,
    name: 'Warmup Grid Revised',
    updatedAt: '2026-05-21T09:30:00.000Z',
  };

  const duplicatedSong: Song = {
    ...songOne,
    id: 'song-3',
    name: 'Warmup Grid Copy',
    createdAt: '2026-05-21T09:40:00.000Z',
    updatedAt: '2026-05-21T09:40:00.000Z',
  };

  function createStorageStub() {
    return {
      listSongs: vi.fn().mockResolvedValue([songTwo, songOne]),
      saveSong: vi.fn().mockResolvedValue(savedSong),
      duplicateSong: vi.fn().mockResolvedValue(duplicatedSong),
      deleteSong: vi.fn().mockResolvedValue(undefined),
    };
  }

  function createMetronomeStub() {
    return {
      activeSongId: vi.fn(() => null),
      loadSong: vi.fn(),
    };
  }

  async function createComponent() {
    const storage = createStorageStub();
    const metronome = createMetronomeStub();

    await TestBed.configureTestingModule({
      imports: [SongLibraryComponent],
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

    const fixture = TestBed.createComponent(SongLibraryComponent);
    await fixture.whenStable();

    return {
      storage,
      component: fixture.componentInstance as unknown as {
        songs: { (): Song[]; set(value: Song[]): void };
        editingSong: { set(value: Song | null): void };
        editorOpen: { (): boolean };
        saveSong(draft: SongDraft): Promise<void>;
        duplicateSong(songId: string): Promise<void>;
        deleteSong(songId: string): Promise<void>;
      },
    };
  }

  it('updates the edited song locally without reloading the full library', async () => {
    const { component, storage } = await createComponent();

    component.editingSong.set(songOne);

    await component.saveSong({
      name: savedSong.name,
      tempo: savedSong.tempo,
      beatsPerBar: savedSong.beatsPerBar,
      subdivision: savedSong.subdivision,
      rhythm: savedSong.rhythm,
      volume: savedSong.volume,
    });

    expect(storage.listSongs).toHaveBeenCalledTimes(1);
    expect(component.songs()).toEqual([savedSong, songTwo]);
    expect(component.editorOpen()).toBe(false);
  });

  it('adds a duplicated song locally without reloading the full library', async () => {
    const { component, storage } = await createComponent();

    await component.duplicateSong(songOne.id);

    expect(storage.listSongs).toHaveBeenCalledTimes(1);
    expect(component.songs()).toEqual([duplicatedSong, songTwo, songOne]);
  });

  it('removes a deleted song locally without reloading the full library', async () => {
    const { component, storage } = await createComponent();

    await component.deleteSong(songOne.id);

    expect(storage.listSongs).toHaveBeenCalledTimes(1);
    expect(component.songs()).toEqual([songTwo]);
  });
});

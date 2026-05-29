import { TestBed } from '@angular/core/testing';

import { DEFAULT_APP_PREFERENCES } from '../../shared/models/setlist.model';
import { LibraryStorageService } from '../../shared/storage/library-storage.service';
import { type ScheduledTick } from './metronome.helpers';
import { MetronomeService } from './metronome.service';

interface NavigatorWithAudioSession extends Navigator {
  audioSession?: { type: string };
}

class FakeAudioParam {
  value = 0;

  cancelScheduledValues(): void {
    return;
  }

  setValueAtTime(value: number): void {
    this.value = value;
  }

  exponentialRampToValueAtTime(value: number): void {
    this.value = value;
  }
}

class FakeGainNode {
  readonly gain = new FakeAudioParam();

  connect(): void {
    return;
  }
}

class FakeOscillatorNode {
  readonly frequency = new FakeAudioParam();
  type: OscillatorType = 'sine';

  connect(): void {
    return;
  }

  start(): void {
    return;
  }

  stop(): void {
    return;
  }
}

class FakeAudioContext {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  readonly destination = {} as AudioDestinationNode;

  async resume(): Promise<void> {
    this.state = 'running';
  }

  createGain(): GainNode {
    return new FakeGainNode() as unknown as GainNode;
  }

  createOscillator(): OscillatorNode {
    return new FakeOscillatorNode() as unknown as OscillatorNode;
  }
}

class RejectingAudioContext extends FakeAudioContext {
  override async resume(): Promise<void> {
    throw new Error('resume blocked');
  }
}

describe('MetronomeService', () => {
  const audioContextDescriptor = Object.getOwnPropertyDescriptor(window, 'AudioContext');
  const userAgentDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent');
  const platformDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'platform');
  const maxTouchPointsDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'maxTouchPoints');
  const audioSessionDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'audioSession');

  function restoreProperty(target: object, property: string, descriptor?: PropertyDescriptor): void {
    if (descriptor) {
      Object.defineProperty(target, property, descriptor);
      return;
    }

    Reflect.deleteProperty(target, property);
  }

  function setAudioContext(value: typeof AudioContext | undefined): void {
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      writable: true,
      value,
    });
  }

  function setNavigatorState(options: {
    userAgent: string;
    platform: string;
    maxTouchPoints: number;
    audioSession?: { type: string };
  }): void {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: options.userAgent,
    });
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: options.platform,
    });
    Object.defineProperty(window.navigator, 'maxTouchPoints', {
      configurable: true,
      value: options.maxTouchPoints,
    });
    Object.defineProperty(window.navigator, 'audioSession', {
      configurable: true,
      writable: true,
      value: options.audioSession,
    });
  }

  function createStorageStub() {
    return {
      getResolvedSetlist: vi.fn(),
      getSetlist: vi.fn(),
      getSong: vi.fn(),
      loadPreferences: vi.fn(() => new Promise<never>(() => {})),
      reorderSetlistSongs: vi.fn(),
      savePreferences: vi.fn(),
      saveSong: vi.fn(),
    };
  }

  function createService(storage = createStorageStub()): MetronomeService {
    TestBed.configureTestingModule({
      providers: [
        MetronomeService,
        {
          provide: LibraryStorageService,
          useValue: storage,
        },
      ],
    });

    return TestBed.inject(MetronomeService);
  }

  async function ensureAudioContext(service: MetronomeService): Promise<AudioContext | null> {
    return await (service as unknown as { ensureAudioContext: () => Promise<AudioContext | null> }).ensureAudioContext();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    restoreProperty(window, 'AudioContext', audioContextDescriptor);
    restoreProperty(window.navigator, 'userAgent', userAgentDescriptor);
    restoreProperty(window.navigator, 'platform', platformDescriptor);
    restoreProperty(window.navigator, 'maxTouchPoints', maxTouchPointsDescriptor);
    restoreProperty(window.navigator, 'audioSession', audioSessionDescriptor);
    vi.restoreAllMocks();
  });

  it('activates a playback audio session on supported iPhone browsers', async () => {
    const audioSession = { type: 'auto' };

    setNavigatorState({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
      platform: 'iPhone',
      maxTouchPoints: 5,
      audioSession,
    });
    setAudioContext(FakeAudioContext as unknown as typeof AudioContext);

    const service = createService();
    const context = await ensureAudioContext(service);

    expect(context).toBeTruthy();
    expect(audioSession.type).toBe('playback');
    expect(service.silentModeSupportState()).toBe('active');
    expect(service.audioSupportMessage()).toBeNull();
  });

  it('surfaces a warning when silent-mode playback is unsupported on iPhone', async () => {
    setNavigatorState({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15',
      platform: 'iPhone',
      maxTouchPoints: 5,
      audioSession: undefined,
    });
    setAudioContext(FakeAudioContext as unknown as typeof AudioContext);

    const service = createService();
    const context = await ensureAudioContext(service);

    expect(context).toBeTruthy();
    expect(service.silentModeSupportState()).toBe('unsupported');
    expect(service.audioSupportMessage()).toContain('does not expose silent-mode playback controls');
  });

  it('reports a startup failure when the browser rejects audio activation', async () => {
    const audioSession = { type: 'auto' };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    setNavigatorState({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
      platform: 'iPhone',
      maxTouchPoints: 5,
      audioSession,
    });
    setAudioContext(RejectingAudioContext as unknown as typeof AudioContext);

    const service = createService();
    const context = await ensureAudioContext(service);

    expect(context).toBeNull();
    expect(audioSession.type).toBe('playback');
    expect(service.silentModeSupportState()).toBe('failed');
    expect(service.audioSupportMessage()).toContain('Audio playback could not start');
    expect(consoleError).toHaveBeenCalled();
  });

  it('syncs the active setlist order without persisting it again', async () => {
    const storage = createStorageStub();
    const service = createService(storage);

    service.activeSetlistId.set('set-1');
    service.activeSetlistIndex.set(1);
    service.activeSongId.set('song-2');

    await service.reorderSetlistSongs('set-1', ['song-2', 'song-1']);

    expect(storage.reorderSetlistSongs).not.toHaveBeenCalled();
    expect(service.activeSetlistIndex()).toBe(0);
    expect(service.moveActiveSetlistSong(0, 0)).toEqual(['song-2', 'song-1']);
  });

  it('persists the composed song and setlist session after starting a setlist', async () => {
    vi.useFakeTimers();

    const storage = createStorageStub();
    storage.getResolvedSetlist.mockResolvedValue({
      id: 'set-1',
      name: 'Warmup',
      songIds: ['song-1', 'song-2'],
      createdAt: '2026-05-21T12:00:00.000Z',
      updatedAt: '2026-05-21T12:00:00.000Z',
      missingSongIds: [],
      entries: [
        {
          id: 'entry-1',
          songId: 'song-1',
          order: 0,
          song: {
            id: 'song-1',
            name: 'Warmup Click',
            tempo: 144,
            beatsPerBar: 3,
            subdivision: 2,
            rhythm: 'swing',
            volume: 0.66,
            createdAt: '2026-05-21T12:00:00.000Z',
            updatedAt: '2026-05-21T12:00:00.000Z',
          },
        },
        {
          id: 'entry-2',
          songId: 'song-2',
          order: 1,
          song: {
            id: 'song-2',
            name: 'Bridge Count',
            tempo: 156,
            beatsPerBar: 5,
            subdivision: 1,
            rhythm: 'straight',
            volume: 0.61,
            createdAt: '2026-05-21T12:00:00.000Z',
            updatedAt: '2026-05-21T12:00:00.000Z',
          },
        },
      ],
    });

    const service = createService(storage);

    await service.startSetlist('set-1', 1);
    await vi.runAllTimersAsync();

    expect(storage.savePreferences).toHaveBeenCalledTimes(1);
    expect(storage.savePreferences).toHaveBeenCalledWith({
      lastTransport: {
        tempo: 156,
        beatsPerBar: 5,
        subdivision: 1,
        rhythm: 'straight',
        volume: 0.61,
      },
      lastSongId: 'song-2',
      lastSongName: 'Bridge Count',
      lastSetlistId: 'set-1',
      lastSetlistName: 'Warmup',
      activeSetlistIndex: 1,
    });
    expect(service.activeSongId()).toBe('song-2');
    expect(service.activeSetlistId()).toBe('set-1');
  });

  it('does nothing when moving to the previous song without an active setlist', async () => {
    const storage = createStorageStub();
    const service = createService(storage);

    await service.previousSong();

    expect(storage.getResolvedSetlist).not.toHaveBeenCalled();
  });

  it('does nothing when moving to the previous song at the first setlist entry', async () => {
    const storage = createStorageStub();
    const service = createService(storage);

    service.activeSetlistId.set('set-1');
    service.activeSetlistIndex.set(0);

    await service.previousSong();

    expect(service.canRetreatSetlist()).toBe(false);
    expect(storage.getResolvedSetlist).not.toHaveBeenCalled();
  });

  it('loads the previous song within the active setlist', async () => {
    vi.useFakeTimers();

    const storage = createStorageStub();
    storage.getResolvedSetlist.mockResolvedValue({
      id: 'set-1',
      name: 'Warmup',
      songIds: ['song-1', 'song-2'],
      createdAt: '2026-05-21T12:00:00.000Z',
      updatedAt: '2026-05-21T12:00:00.000Z',
      missingSongIds: [],
      entries: [
        {
          id: 'entry-1',
          songId: 'song-1',
          order: 0,
          song: {
            id: 'song-1',
            name: 'Warmup Click',
            tempo: 144,
            beatsPerBar: 3,
            subdivision: 2,
            rhythm: 'swing',
            volume: 0.66,
            createdAt: '2026-05-21T12:00:00.000Z',
            updatedAt: '2026-05-21T12:00:00.000Z',
          },
        },
        {
          id: 'entry-2',
          songId: 'song-2',
          order: 1,
          song: {
            id: 'song-2',
            name: 'Bridge Count',
            tempo: 156,
            beatsPerBar: 5,
            subdivision: 1,
            rhythm: 'straight',
            volume: 0.61,
            createdAt: '2026-05-21T12:00:00.000Z',
            updatedAt: '2026-05-21T12:00:00.000Z',
          },
        },
      ],
    });

    const service = createService(storage);

    await service.startSetlist('set-1', 1);
    await service.previousSong();
    await vi.runAllTimersAsync();

    expect(storage.getResolvedSetlist).toHaveBeenCalledTimes(2);
    expect(storage.savePreferences).toHaveBeenCalledTimes(1);
    expect(storage.savePreferences).toHaveBeenCalledWith({
      lastTransport: {
        tempo: 144,
        beatsPerBar: 3,
        subdivision: 2,
        rhythm: 'swing',
        volume: 0.66,
      },
      lastSongId: 'song-1',
      lastSongName: 'Warmup Click',
      lastSetlistId: 'set-1',
      lastSetlistName: 'Warmup',
      activeSetlistIndex: 0,
    });
    expect(service.activeSongId()).toBe('song-1');
    expect(service.activeSongName()).toBe('Warmup Click');
    expect(service.activeSetlistIndex()).toBe(0);
  });

  it('coalesces rapid preference updates into one save with the latest snapshot', async () => {
    vi.useFakeTimers();

    const storage = createStorageStub();
    const service = createService(storage);

    service.setTempo(132);
    service.setBeatsPerBar(5);
    await vi.runAllTimersAsync();

    expect(storage.savePreferences).toHaveBeenCalledTimes(1);
    expect(storage.savePreferences).toHaveBeenCalledWith({
      lastTransport: {
        tempo: 132,
        beatsPerBar: 5,
        subdivision: DEFAULT_APP_PREFERENCES.lastTransport.subdivision,
        rhythm: DEFAULT_APP_PREFERENCES.lastTransport.rhythm,
        volume: DEFAULT_APP_PREFERENCES.lastTransport.volume,
      },
      lastSongId: null,
      lastSongName: null,
      lastSetlistId: null,
      lastSetlistName: null,
      activeSetlistIndex: 0,
    });
  });

  it('tracks lookahead from the visual queue head', () => {
    const service = createService();
    const internals = service as unknown as {
      visualQueue: ScheduledTick[];
      visualQueueHead: number;
      syncNextBeatInBar(): void;
      dequeueDueVisualTick(currentTime: number): ScheduledTick | null;
    };

    internals.visualQueue = [
      { time: 1, beatInBar: 2, pulseInBeat: 1, pulsesPerBeat: 2, emphasis: 'beat' },
      { time: 2, beatInBar: 3, pulseInBeat: 1, pulsesPerBeat: 2, emphasis: 'beat' },
    ];
    internals.visualQueueHead = 0;
    internals.syncNextBeatInBar();

    expect(service.visualizerStructure().nextBeatInBar).toBe(2);
    expect(internals.dequeueDueVisualTick(1.001)?.beatInBar).toBe(2);
    expect(service.visualizerStructure().nextBeatInBar).toBe(3);
    expect(internals.dequeueDueVisualTick(2.001)?.beatInBar).toBe(3);
    expect(service.visualizerStructure().nextBeatInBar).toBeNull();
  });

  it('does not persist preferences again while restoring them on startup', async () => {
    vi.useFakeTimers();

    const storage = createStorageStub();
    storage.loadPreferences = vi.fn().mockResolvedValue({
      lastTransport: {
        tempo: 156,
        beatsPerBar: 5,
        subdivision: 2,
        rhythm: 'swing',
        volume: 0.61,
      },
      lastSongId: 'song-2',
      lastSongName: 'Bridge Count',
      lastSetlistId: null,
      lastSetlistName: null,
      activeSetlistIndex: 0,
    });

    createService(storage);
    await Promise.resolve();
    await vi.runAllTimersAsync();

    expect(storage.loadPreferences).toHaveBeenCalledTimes(1);
    expect(storage.savePreferences).not.toHaveBeenCalled();
  });

  it('restores active song session metadata from preferences on startup', async () => {
    const storage = createStorageStub();
    storage.loadPreferences = vi.fn().mockResolvedValue({
      lastTransport: DEFAULT_APP_PREFERENCES.lastTransport,
      lastSongId: 'song-2',
      lastSongName: 'Bridge Count',
      lastSetlistId: null,
      lastSetlistName: null,
      activeSetlistIndex: 0,
    });

    const service = createService(storage);

    await Promise.resolve();

    expect(service.activeSongId()).toBe('song-2');
    expect(service.activeSongName()).toBe('Bridge Count');
  });

  it('restores the full saved session from preferences on startup', async () => {
    const storage = createStorageStub();
    storage.loadPreferences = vi.fn().mockResolvedValue({
      lastTransport: {
        tempo: 156,
        beatsPerBar: 5,
        subdivision: 2,
        rhythm: 'swing',
        volume: 0.61,
      },
      lastSongId: 'song-2',
      lastSongName: 'Bridge Count',
      lastSetlistId: 'set-1',
      lastSetlistName: 'Warmup',
      activeSetlistIndex: 1,
    });
    storage.getSetlist.mockResolvedValue({
      id: 'set-1',
      name: 'Warmup',
      songIds: ['song-1', 'song-2'],
      createdAt: '2026-05-21T12:00:00.000Z',
      updatedAt: '2026-05-21T12:00:00.000Z',
    });

    const service = createService(storage);

    await Promise.resolve();
    await Promise.resolve();

    expect(service.currentSettings()).toEqual({
      tempo: 156,
      beatsPerBar: 5,
      subdivision: 2,
      rhythm: 'swing',
      volume: 0.61,
    });
    expect(service.activeSongId()).toBe('song-2');
    expect(service.activeSongName()).toBe('Bridge Count');
    expect(service.activeSetlistId()).toBe('set-1');
    expect(service.activeSetlistName()).toBe('Warmup');
    expect(service.activeSetlistIndex()).toBe(1);
  });

  it('restores current setlist metadata instead of stale preference setlist metadata on startup', async () => {
    const storage = createStorageStub();
    storage.loadPreferences = vi.fn().mockResolvedValue({
      lastTransport: DEFAULT_APP_PREFERENCES.lastTransport,
      lastSongId: null,
      lastSongName: null,
      lastSetlistId: 'set-1',
      lastSetlistName: 'Warmup Old Name',
      activeSetlistIndex: 0,
    });
    storage.getSetlist.mockResolvedValue({
      id: 'set-1',
      name: 'Warmup Revised',
      songIds: ['song-1', 'song-2'],
      createdAt: '2026-05-21T12:00:00.000Z',
      updatedAt: '2026-05-21T12:00:00.000Z',
    });

    const service = createService(storage);

    await Promise.resolve();
    await Promise.resolve();

    expect(service.activeSetlistId()).toBe('set-1');
    expect(service.activeSetlistName()).toBe('Warmup Revised');
    expect(service.activeSetlistIndex()).toBe(0);
  });

  it('clears stale setlist session state when restored preferences reference a missing setlist', async () => {
    const storage = createStorageStub();
    storage.loadPreferences = vi.fn().mockResolvedValue({
      lastTransport: DEFAULT_APP_PREFERENCES.lastTransport,
      lastSongId: null,
      lastSongName: null,
      lastSetlistId: 'set-missing',
      lastSetlistName: 'Deleted Set',
      activeSetlistIndex: 3,
    });
    storage.getSetlist.mockResolvedValue(null);

    const service = createService(storage);

    await Promise.resolve();
    await Promise.resolve();

    expect(storage.getSetlist).toHaveBeenCalledWith('set-missing');
    expect(service.activeSetlistId()).toBeNull();
    expect(service.activeSetlistName()).toBeNull();
    expect(service.activeSetlistIndex()).toBe(0);
  });

  it('clamps restored setlist index to the available setlist length', async () => {
    const storage = createStorageStub();
    storage.loadPreferences = vi.fn().mockResolvedValue({
      lastTransport: DEFAULT_APP_PREFERENCES.lastTransport,
      lastSongId: null,
      lastSongName: null,
      lastSetlistId: 'set-1',
      lastSetlistName: 'Warmup',
      activeSetlistIndex: 5,
    });
    storage.getSetlist.mockResolvedValue({
      id: 'set-1',
      name: 'Warmup',
      songIds: ['song-1', 'song-2'],
      createdAt: '2026-05-21T12:00:00.000Z',
      updatedAt: '2026-05-21T12:00:00.000Z',
    });

    const service = createService(storage);

    await Promise.resolve();
    await Promise.resolve();

    expect(service.activeSetlistId()).toBe('set-1');
    expect(service.activeSetlistName()).toBe('Warmup');
    expect(service.activeSetlistIndex()).toBe(1);
  });
});

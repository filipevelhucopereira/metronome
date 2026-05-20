import { TestBed } from '@angular/core/testing';

import { LibraryStorageService } from '../../shared/storage/library-storage.service';
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

  function createService(): MetronomeService {
    TestBed.configureTestingModule({
      providers: [
        MetronomeService,
        {
          provide: LibraryStorageService,
          useValue: createStorageStub(),
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
});

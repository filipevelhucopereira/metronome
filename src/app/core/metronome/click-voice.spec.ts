import { scheduleClickVoice } from './click-voice';

class FakeAudioParam {
  value = 0;
  readonly setCalls: Array<{ value: number; when: number }> = [];

  setValueAtTime(value: number, when: number): void {
    this.value = value;
    this.setCalls.push({ value, when });
  }

  exponentialRampToValueAtTime(value: number, when: number): void {
    this.value = value;
    this.setCalls.push({ value, when });
  }

  cancelScheduledValues(): void {
    return;
  }
}

class FakeAudioBuffer {
  readonly channelData: Float32Array;

  constructor(readonly length: number, readonly sampleRate: number) {
    this.channelData = new Float32Array(length);
  }

  getChannelData(): Float32Array {
    return this.channelData;
  }
}

class FakeGainNode {
  readonly gain = new FakeAudioParam();
  connectedTo: AudioNode | null = null;

  connect(node: AudioNode): void {
    this.connectedTo = node;
  }
}

class FakeBufferSourceNode {
  buffer: AudioBuffer | null = null;
  connectedTo: FakeGainNode | null = null;
  readonly startCalls: number[] = [];
  readonly stopCalls: number[] = [];

  connect(node: FakeGainNode): void {
    this.connectedTo = node;
  }

  start(when: number): void {
    this.startCalls.push(when);
  }

  stop(when: number): void {
    this.stopCalls.push(when);
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
  readonly sampleRate = 48_000;
  readonly createdBuffers: FakeAudioBuffer[] = [];
  readonly createdBufferSources: FakeBufferSourceNode[] = [];
  readonly createdGainNodes: FakeGainNode[] = [];
  readonly createdOscillators: FakeOscillatorNode[] = [];

  createBuffer(_channels: number, length: number, sampleRate: number): AudioBuffer {
    const buffer = new FakeAudioBuffer(length, sampleRate);
    this.createdBuffers.push(buffer);
    return buffer as unknown as AudioBuffer;
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeBufferSourceNode();
    this.createdBufferSources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }

  createGain(): GainNode {
    const gain = new FakeGainNode();
    this.createdGainNodes.push(gain);
    return gain as unknown as GainNode;
  }

  createOscillator(): OscillatorNode {
    const oscillator = new FakeOscillatorNode();
    this.createdOscillators.push(oscillator);
    return oscillator as unknown as OscillatorNode;
  }
}

describe('scheduleClickVoice', () => {
  it('reuses the same cached buffer for repeated emphasis on one context', () => {
    const context = new FakeAudioContext();
    const output = {} as AudioNode;

    scheduleClickVoice(context as unknown as BaseAudioContext, {
      output,
      when: 1,
      volume: 0.8,
      emphasis: 'bar',
    });
    scheduleClickVoice(context as unknown as BaseAudioContext, {
      output,
      when: 2,
      volume: 0.5,
      emphasis: 'bar',
    });

    expect(context.createdBufferSources).toHaveLength(2);
    expect(context.createdBuffers).toHaveLength(1);
    expect(context.createdBufferSources[0].buffer).toBe(context.createdBufferSources[1].buffer);
  });

  it('creates a distinct cached buffer per emphasis and schedules one source per call', () => {
    const context = new FakeAudioContext();
    const output = {} as AudioNode;

    scheduleClickVoice(context as unknown as BaseAudioContext, {
      output,
      when: 1.25,
      volume: 0.6,
      emphasis: 'beat',
    });
    scheduleClickVoice(context as unknown as BaseAudioContext, {
      output,
      when: 1.5,
      volume: 0.4,
      emphasis: 'subdivision',
    });

    expect(context.createdBufferSources).toHaveLength(2);
    expect(context.createdBuffers).toHaveLength(2);
    expect(context.createdOscillators).toHaveLength(0);
    expect(context.createdBufferSources[0].buffer).not.toBe(context.createdBufferSources[1].buffer);
    expect(context.createdBufferSources[0].startCalls).toEqual([1.25]);
    expect(context.createdBufferSources[1].startCalls).toEqual([1.5]);
  });
});

import type { ClickEmphasis } from './metronome.helpers';

export interface ClickVoiceOptions {
  output: AudioNode;
  when: number;
  volume: number;
  emphasis: ClickEmphasis;
}

const CLICK_PROFILE: Record<ClickEmphasis, { frequency: number; gain: number; decay: number; overtone: number; overtoneGain: number }> = {
  bar: { frequency: 1760, gain: 0.99, decay: 0.052, overtone: 1.85, overtoneGain: 0.34 },
  beat: { frequency: 1320, gain: 0.65, decay: 0.044, overtone: 1.6, overtoneGain: 0.24 },
  subdivision: { frequency: 980, gain: 0.5, decay: 0.034, overtone: 1.45, overtoneGain: 0.16 },
};

const BUFFER_PADDING_SECONDS = 0.02;
const MIN_GAIN = 0.0001;
const clickBuffers = new WeakMap<BaseAudioContext, Partial<Record<ClickEmphasis, AudioBuffer>>>();

function buildClickBuffer(context: BaseAudioContext, emphasis: ClickEmphasis): AudioBuffer {
  const profile = CLICK_PROFILE[emphasis];
  const length = Math.max(1, Math.ceil((profile.decay + BUFFER_PADDING_SECONDS) * context.sampleRate));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const channel = buffer.getChannelData(0);

  for (let index = 0; index < length; index += 1) {
    const time = index / context.sampleRate;
    const decayProgress = Math.min(1, time / profile.decay);
    const envelope = Math.exp(-decayProgress * 7.5);
    const body = Math.sin(time * Math.PI * 2 * profile.frequency);
    const overtone = Math.sin(time * Math.PI * 2 * profile.frequency * profile.overtone);

    channel[index] = (body + (overtone * profile.overtoneGain)) * envelope;
  }

  return buffer;
}

function getClickBuffer(context: BaseAudioContext, emphasis: ClickEmphasis): AudioBuffer {
  let cachedBuffers = clickBuffers.get(context);

  if (!cachedBuffers) {
    cachedBuffers = {};

    clickBuffers.set(context, cachedBuffers);
  }

  const cachedBuffer = cachedBuffers[emphasis];

  if (cachedBuffer) {
    return cachedBuffer;
  }

  const buffer = buildClickBuffer(context, emphasis);
  cachedBuffers[emphasis] = buffer;
  return buffer;
}

export function scheduleClickVoice(context: BaseAudioContext, options: ClickVoiceOptions): void {
  const profile = CLICK_PROFILE[options.emphasis];
  const source = context.createBufferSource();
  const gainNode = context.createGain();
  const peakGain = Math.max(MIN_GAIN, profile.gain * Math.max(0, options.volume));

  source.buffer = getClickBuffer(context, options.emphasis);
  gainNode.gain.setValueAtTime(peakGain, options.when);

  source.connect(gainNode);
  gainNode.connect(options.output);

  source.start(options.when);
  source.stop(options.when + source.buffer.duration);
}

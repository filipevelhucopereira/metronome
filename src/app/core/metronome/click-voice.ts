import type { ClickEmphasis } from './metronome.helpers';

export interface ClickVoiceOptions {
  output: AudioNode;
  when: number;
  volume: number;
  emphasis: ClickEmphasis;
}

const CLICK_PROFILE: Record<ClickEmphasis, { frequency: number; gain: number; decay: number; type: OscillatorType }> = {
  bar: { frequency: 1760, gain: 0.55, decay: 0.052, type: 'square' },
  beat: { frequency: 1320, gain: 0.38, decay: 0.044, type: 'triangle' },
  subdivision: { frequency: 980, gain: 0.28, decay: 0.034, type: 'triangle' },
};

export function scheduleClickVoice(context: BaseAudioContext, options: ClickVoiceOptions): void {
  const profile = CLICK_PROFILE[options.emphasis];
  const gainNode = context.createGain();
  const oscillator = context.createOscillator();
  const transientOscillator = context.createOscillator();
  const peakGain = Math.max(0.0001, profile.gain * Math.max(0, options.volume));

  oscillator.type = profile.type;
  oscillator.frequency.setValueAtTime(profile.frequency, options.when);
  oscillator.frequency.exponentialRampToValueAtTime(profile.frequency * 0.6, options.when + profile.decay);

  transientOscillator.type = 'sine';
  transientOscillator.frequency.setValueAtTime(profile.frequency * 1.85, options.when);
  transientOscillator.frequency.exponentialRampToValueAtTime(profile.frequency * 0.9, options.when + profile.decay * 0.5);

  gainNode.gain.setValueAtTime(0.0001, options.when);
  gainNode.gain.exponentialRampToValueAtTime(peakGain, options.when + 0.0025);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, options.when + profile.decay);

  oscillator.connect(gainNode);
  transientOscillator.connect(gainNode);
  gainNode.connect(options.output);

  oscillator.start(options.when);
  transientOscillator.start(options.when);
  oscillator.stop(options.when + profile.decay + 0.02);
  transientOscillator.stop(options.when + profile.decay * 0.6 + 0.02);
}

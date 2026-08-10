import type { FeedbackCue } from './feedback-policy';

interface Tone {
  offset: number;
  duration: number;
  frequency: number;
  type: OscillatorType;
  volume: number;
  endFrequency?: number;
}

export const FEEDBACK_VOLUME_LIFT = {
  musical: 2.1,
  event: 1.55,
  ui: 1.4,
} as const;

const CUE_TONES: Record<FeedbackCue, Tone[]> = {
  start: [
    { offset: 0, duration: 1.7, frequency: 164.81, type: 'sine', volume: 0.012, endFrequency: 166.5 },
    { offset: 0.18, duration: 1.55, frequency: 246.94, type: 'sine', volume: 0.011, endFrequency: 249 },
    { offset: 0.42, duration: 1.35, frequency: 329.63, type: 'triangle', volume: 0.012, endFrequency: 392 },
    { offset: 1.12, duration: 0.52, frequency: 493.88, type: 'triangle', volume: 0.015, endFrequency: 659.25 },
  ],
  goal: [
    { offset: 0, duration: 0.12, frequency: 520, type: 'triangle', volume: 0.026 },
    { offset: 0.08, duration: 0.14, frequency: 660, type: 'triangle', volume: 0.03 },
    { offset: 0.17, duration: 0.18, frequency: 880, type: 'triangle', volume: 0.026 },
  ],
  major_upset: [
    { offset: 0, duration: 0.12, frequency: 196, type: 'square', volume: 0.018 },
    { offset: 0.11, duration: 0.22, frequency: 392, type: 'triangle', volume: 0.03 },
  ],
  story_upgrade: [
    { offset: 0, duration: 0.15, frequency: 392, type: 'sine', volume: 0.022 },
    { offset: 0.12, duration: 0.2, frequency: 523.25, type: 'sine', volume: 0.028 },
  ],
  season_end: [
    { offset: 0, duration: 2.8, frequency: 130.81, type: 'sine', volume: 0.011, endFrequency: 132 },
    { offset: 0.1, duration: 2.65, frequency: 196, type: 'sine', volume: 0.011, endFrequency: 198 },
    { offset: 0.24, duration: 2.45, frequency: 261.63, type: 'triangle', volume: 0.012, endFrequency: 263 },
    { offset: 0.82, duration: 0.64, frequency: 392, type: 'triangle', volume: 0.016, endFrequency: 523.25 },
    { offset: 1.52, duration: 0.78, frequency: 523.25, type: 'triangle', volume: 0.016, endFrequency: 659.25 },
    { offset: 2.18, duration: 0.62, frequency: 659.25, type: 'triangle', volume: 0.014, endFrequency: 783.99 },
  ],
  advance: [
    { offset: 0, duration: 0.1, frequency: 104, type: 'sine', volume: 0.022, endFrequency: 72 },
    { offset: 0.055, duration: 0.12, frequency: 196, type: 'triangle', volume: 0.01, endFrequency: 246.94 },
  ],
  selection: [
    { offset: 0, duration: 0.055, frequency: 540, type: 'sine', volume: 0.008, endFrequency: 610 },
  ],
  confirm: [
    { offset: 0, duration: 0.09, frequency: 392, type: 'sine', volume: 0.012, endFrequency: 440 },
    { offset: 0.075, duration: 0.14, frequency: 587.33, type: 'triangle', volume: 0.016, endFrequency: 659.25 },
  ],
  toggle_on: [
    { offset: 0, duration: 0.065, frequency: 440, type: 'sine', volume: 0.01, endFrequency: 554.37 },
    { offset: 0.055, duration: 0.1, frequency: 659.25, type: 'triangle', volume: 0.012 },
  ],
  toggle_off: [
    { offset: 0, duration: 0.065, frequency: 523.25, type: 'sine', volume: 0.009, endFrequency: 392 },
  ],
  intervention: [
    { offset: 0, duration: 0.22, frequency: 110, type: 'sine', volume: 0.024, endFrequency: 65.41 },
    { offset: 0.1, duration: 0.28, frequency: 196, type: 'triangle', volume: 0.018, endFrequency: 293.66 },
    { offset: 0.24, duration: 0.22, frequency: 392, type: 'sine', volume: 0.014, endFrequency: 523.25 },
  ],
  reject: [
    { offset: 0, duration: 0.12, frequency: 174.61, type: 'triangle', volume: 0.012, endFrequency: 130.81 },
  ],
};

export function feedbackVolumeLiftForCue(cue: FeedbackCue): number {
  if (cue === 'start' || cue === 'season_end') return FEEDBACK_VOLUME_LIFT.musical;
  if (cue === 'advance' || cue === 'selection' || cue === 'confirm'
    || cue === 'toggle_on' || cue === 'toggle_off' || cue === 'intervention'
    || cue === 'reject') return FEEDBACK_VOLUME_LIFT.ui;
  return FEEDBACK_VOLUME_LIFT.event;
}

function scheduleTone(context: AudioContext, tone: Tone, volumeLift: number): void {
  const start = context.currentTime + tone.offset;
  const end = start + tone.duration;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = tone.type;
  oscillator.frequency.setValueAtTime(tone.frequency, start);
  if (tone.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(tone.endFrequency, end);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(tone.volume * volumeLift, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(end + 0.01);
  oscillator.addEventListener('ended', () => {
    oscillator.disconnect();
    gain.disconnect();
  }, { once: true });
}

export function scheduleFeedbackCue(context: AudioContext, cue: FeedbackCue, volumeScale = 1): void {
  const volumeLift = feedbackVolumeLiftForCue(cue) * Math.max(0, Math.min(1, volumeScale));
  CUE_TONES[cue].forEach(tone => scheduleTone(context, tone, volumeLift));
}

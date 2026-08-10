import type { GameFeedbackCue } from './feedback-policy';

interface Tone {
  offset: number;
  duration: number;
  frequency: number;
  type: OscillatorType;
  volume: number;
  endFrequency?: number;
}

const FEEDBACK_VOLUME_LIFT = 1.24;

const CUE_TONES: Record<GameFeedbackCue, Tone[]> = {
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
};

function scheduleTone(context: AudioContext, tone: Tone): void {
  const start = context.currentTime + tone.offset;
  const end = start + tone.duration;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = tone.type;
  oscillator.frequency.setValueAtTime(tone.frequency, start);
  if (tone.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(tone.endFrequency, end);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(tone.volume * FEEDBACK_VOLUME_LIFT, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(end + 0.01);
  oscillator.addEventListener('ended', () => {
    oscillator.disconnect();
    gain.disconnect();
  }, { once: true });
}

export function scheduleFeedbackCue(context: AudioContext, cue: GameFeedbackCue): void {
  CUE_TONES[cue].forEach(tone => scheduleTone(context, tone));
}

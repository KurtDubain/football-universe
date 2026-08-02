import type { GameFeedbackCue } from './feedback-policy';

interface Tone {
  offset: number;
  duration: number;
  frequency: number;
  type: OscillatorType;
  volume: number;
}

const CUE_TONES: Record<GameFeedbackCue, Tone[]> = {
  start: [
    { offset: 0, duration: 0.11, frequency: 330, type: 'sine', volume: 0.025 },
    { offset: 0.09, duration: 0.17, frequency: 495, type: 'sine', volume: 0.03 },
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
    { offset: 0, duration: 0.15, frequency: 261.63, type: 'triangle', volume: 0.024 },
    { offset: 0.12, duration: 0.18, frequency: 392, type: 'triangle', volume: 0.027 },
    { offset: 0.27, duration: 0.26, frequency: 523.25, type: 'triangle', volume: 0.03 },
  ],
};

function scheduleTone(context: AudioContext, tone: Tone): void {
  const start = context.currentTime + tone.offset;
  const end = start + tone.duration;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = tone.type;
  oscillator.frequency.setValueAtTime(tone.frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(tone.volume, start + 0.012);
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

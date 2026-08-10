import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SAMPLE_RATE = 32_000;
const CHANNELS = 2;
const outputDir = new URL('../src/assets/audio/', import.meta.url);
const tempDir = join(tmpdir(), 'football-universe-tournament-music');

interface Score {
  name: string;
  bpm: number;
  bars: number;
  progression: number[][];
  melody: Array<[bar: number, beat: number, duration: number, midi: number, velocity: number]>;
  intensity: number;
}

const SCORES: Score[] = [
  {
    name: 'world-cup-theme-v1',
    bpm: 104,
    bars: 16,
    progression: [
      [50, 57, 62, 65], [46, 53, 58, 62], [41, 48, 53, 57], [48, 55, 60, 64],
    ],
    melody: [
      [1, 0, 1.5, 62, 0.72], [1, 2, 0.75, 65, 0.78], [1, 3, 1, 69, 0.84],
      [2, 0.5, 1, 70, 0.76], [2, 2, 0.75, 69, 0.72], [2, 3, 1, 65, 0.7],
      [3, 0, 1, 65, 0.72], [3, 1.5, 0.75, 69, 0.8], [3, 2.5, 1.25, 72, 0.86],
      [4, 0, 0.75, 67, 0.72], [4, 1, 0.75, 65, 0.7], [4, 2, 2, 62, 0.82],
      [9, 0, 1, 69, 0.78], [9, 1.5, 0.5, 70, 0.75], [9, 2, 2, 74, 0.9],
      [10, 0, 0.75, 72, 0.78], [10, 1, 0.75, 70, 0.74], [10, 2, 2, 69, 0.84],
      [11, 0, 1, 65, 0.72], [11, 1.5, 0.5, 69, 0.78], [11, 2, 2, 72, 0.9],
      [12, 0, 0.75, 67, 0.74], [12, 1, 0.75, 65, 0.72], [12, 2, 2, 62, 0.88],
    ],
    intensity: 0.82,
  },
  {
    name: 'world-cup-final-v1',
    bpm: 98,
    bars: 10,
    progression: [
      [50, 57, 62, 65], [48, 55, 60, 64], [46, 53, 58, 62], [45, 52, 57, 61],
    ],
    melody: [
      [2, 0, 1, 62, 0.78], [2, 1.5, 0.5, 65, 0.82], [2, 2, 2, 69, 0.92],
      [3, 0, 1, 70, 0.82], [3, 1.5, 0.5, 69, 0.78], [3, 2, 2, 65, 0.86],
      [5, 0, 0.75, 65, 0.82], [5, 1, 0.75, 69, 0.86], [5, 2, 2, 74, 0.98],
      [6, 0, 1, 72, 0.86], [6, 1.5, 0.5, 70, 0.82], [6, 2, 2, 69, 0.92],
      [8, 0, 1, 67, 0.84], [8, 1.5, 0.5, 69, 0.86], [8, 2, 2, 74, 1],
    ],
    intensity: 1,
  },
  {
    name: 'world-cup-champion-v1',
    bpm: 108,
    bars: 6,
    progression: [
      [50, 57, 62, 65], [46, 53, 58, 62], [41, 48, 53, 57], [48, 55, 60, 64],
    ],
    melody: [
      [0, 2, 0.75, 62, 0.82], [0, 3, 1, 65, 0.86],
      [1, 0, 0.75, 69, 0.92], [1, 1, 0.75, 70, 0.88], [1, 2, 2, 74, 1],
      [3, 0, 0.75, 72, 0.9], [3, 1, 0.75, 74, 0.94], [3, 2, 2, 77, 1],
      [4, 0, 0.75, 74, 0.9], [4, 1, 0.75, 72, 0.88], [4, 2, 2, 69, 0.96],
      [5, 0, 4, 74, 1],
    ],
    intensity: 1,
  },
];

type CompetitionStyle = 'knockout' | 'ceremony' | 'mainland' | 'southern' | 'eastern';

interface CompetitionScore extends Score {
  style: CompetitionStyle;
}

const COMPETITION_SCORES: CompetitionScore[] = [
  {
    name: 'league-cup-theme-v1',
    bpm: 118,
    bars: 12,
    progression: [
      [50, 57, 62, 65], [46, 53, 58, 62], [48, 55, 60, 64], [45, 52, 57, 60],
    ],
    melody: [
      [0, 0.5, 0.5, 62, 0.76], [0, 1.25, 0.5, 65, 0.8], [0, 2, 1.5, 69, 0.88],
      [1, 0, 0.75, 70, 0.82], [1, 1, 0.5, 69, 0.76], [1, 2, 1.5, 65, 0.84],
      [2, 0.5, 0.5, 67, 0.78], [2, 1.25, 0.5, 69, 0.82], [2, 2, 1.5, 72, 0.92],
      [3, 0, 0.5, 69, 0.8], [3, 0.75, 0.5, 67, 0.76], [3, 1.5, 2, 62, 0.88],
      [8, 0, 0.5, 69, 0.84], [8, 0.75, 0.5, 72, 0.88], [8, 1.5, 2, 74, 0.98],
      [9, 0, 0.75, 72, 0.84], [9, 1, 0.5, 70, 0.8], [9, 2, 1.5, 69, 0.9],
      [10, 0.5, 0.5, 67, 0.82], [10, 1.25, 0.5, 69, 0.86], [10, 2, 1.5, 72, 0.96],
      [11, 0, 0.5, 69, 0.84], [11, 0.75, 0.5, 65, 0.82], [11, 1.5, 2, 62, 0.94],
    ],
    intensity: 0.94,
    style: 'knockout',
  },
  {
    name: 'super-cup-theme-v1',
    bpm: 100,
    bars: 12,
    progression: [
      [51, 58, 63, 67], [48, 55, 60, 63], [46, 53, 58, 62], [50, 57, 62, 65],
    ],
    melody: [
      [1, 0, 1, 63, 0.8], [1, 1.5, 0.5, 67, 0.84], [1, 2, 2, 70, 0.94],
      [2, 0, 0.75, 72, 0.86], [2, 1, 0.75, 70, 0.82], [2, 2, 2, 67, 0.9],
      [3, 0, 0.75, 65, 0.82], [3, 1, 0.75, 67, 0.86], [3, 2, 2, 70, 0.96],
      [5, 0, 0.75, 67, 0.86], [5, 1, 0.75, 70, 0.9], [5, 2, 2, 75, 1],
      [6, 0, 1, 74, 0.88], [6, 1.5, 0.5, 72, 0.84], [6, 2, 2, 70, 0.94],
      [9, 0, 0.75, 70, 0.88], [9, 1, 0.75, 74, 0.92], [9, 2, 2, 77, 1],
      [10, 0, 1, 75, 0.9], [10, 1.5, 0.5, 74, 0.86], [10, 2, 2, 70, 0.96],
    ],
    intensity: 0.9,
    style: 'ceremony',
  },
  {
    name: 'mainland-cup-theme-v1',
    bpm: 102,
    bars: 12,
    progression: [
      [50, 57, 62, 65], [48, 55, 60, 65], [46, 53, 58, 62], [48, 55, 60, 64],
    ],
    melody: [
      [0, 0, 0.75, 62, 0.82], [0, 1, 0.75, 65, 0.86], [0, 2, 2, 69, 0.94],
      [1, 0, 0.75, 67, 0.84], [1, 1, 0.75, 65, 0.8], [1, 2, 2, 62, 0.9],
      [2, 0, 0.75, 58, 0.78], [2, 1, 0.75, 62, 0.84], [2, 2, 2, 65, 0.92],
      [4, 0, 0.5, 62, 0.82], [4, 0.75, 0.5, 65, 0.86], [4, 1.5, 0.5, 67, 0.88], [4, 2.25, 1.5, 69, 0.98],
      [6, 0, 0.75, 69, 0.88], [6, 1, 0.75, 72, 0.92], [6, 2, 2, 74, 1],
      [8, 0, 0.75, 72, 0.9], [8, 1, 0.75, 69, 0.86], [8, 2, 2, 65, 0.94],
      [10, 0, 0.75, 67, 0.86], [10, 1, 0.75, 65, 0.84], [10, 2, 2, 62, 0.96],
    ],
    intensity: 0.92,
    style: 'mainland',
  },
  {
    name: 'southern-cup-theme-v1',
    bpm: 116,
    bars: 12,
    progression: [
      [45, 52, 57, 60], [48, 55, 60, 64], [43, 50, 55, 59], [41, 48, 53, 57],
    ],
    melody: [
      [0, 0.25, 0.5, 69, 0.8], [0, 1, 0.5, 72, 0.86], [0, 1.75, 0.75, 76, 0.92], [0, 3, 0.75, 72, 0.84],
      [1, 0.5, 0.5, 67, 0.78], [1, 1.25, 0.75, 72, 0.86], [1, 2.5, 1, 74, 0.94],
      [2, 0.25, 0.5, 67, 0.8], [2, 1, 0.5, 71, 0.86], [2, 1.75, 0.75, 74, 0.92], [2, 3, 0.75, 71, 0.84],
      [4, 0.25, 0.5, 72, 0.84], [4, 1, 0.5, 76, 0.9], [4, 1.75, 0.75, 79, 1], [4, 3, 0.75, 76, 0.9],
      [6, 0.5, 0.5, 74, 0.86], [6, 1.25, 0.75, 76, 0.9], [6, 2.5, 1, 81, 1],
      [8, 0.25, 0.5, 76, 0.88], [8, 1, 0.5, 74, 0.84], [8, 1.75, 0.75, 72, 0.9], [8, 3, 0.75, 69, 0.86],
      [10, 0.5, 0.5, 67, 0.82], [10, 1.25, 0.75, 69, 0.88], [10, 2.5, 1, 72, 0.96],
    ],
    intensity: 0.88,
    style: 'southern',
  },
  {
    name: 'eastern-cup-theme-v1',
    bpm: 108,
    bars: 12,
    progression: [
      [52, 59, 64, 67], [48, 55, 60, 64], [50, 57, 62, 66], [47, 54, 59, 62],
    ],
    melody: [
      [0, 0, 0.5, 64, 0.8], [0, 0.75, 0.5, 67, 0.84], [0, 1.5, 0.75, 71, 0.9], [0, 2.75, 1, 76, 0.96],
      [1, 0, 0.75, 74, 0.86], [1, 1.25, 0.5, 71, 0.82], [1, 2, 1.5, 67, 0.9],
      [2, 0, 0.5, 62, 0.78], [2, 0.75, 0.5, 66, 0.84], [2, 1.5, 0.75, 69, 0.88], [2, 2.75, 1, 74, 0.94],
      [4, 0, 0.5, 67, 0.84], [4, 0.75, 0.5, 71, 0.9], [4, 1.5, 0.75, 74, 0.94], [4, 2.75, 1, 79, 1],
      [6, 0, 0.75, 78, 0.9], [6, 1.25, 0.5, 74, 0.86], [6, 2, 1.5, 71, 0.94],
      [8, 0, 0.5, 76, 0.9], [8, 0.75, 0.5, 74, 0.86], [8, 1.5, 0.75, 71, 0.9], [8, 2.75, 1, 67, 0.92],
      [10, 0, 0.75, 66, 0.84], [10, 1.25, 0.5, 69, 0.88], [10, 2, 1.5, 74, 0.98],
    ],
    intensity: 0.86,
    style: 'eastern',
  },
];

function midiFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function envelope(time: number, duration: number, attack: number, release: number): number {
  if (time < 0 || time >= duration) return 0;
  const rise = Math.min(1, time / Math.max(0.001, attack));
  const fall = Math.min(1, (duration - time) / Math.max(0.001, release));
  return Math.sin(Math.min(rise, fall) * Math.PI * 0.5) ** 1.4;
}

function panGains(pan: number): [number, number] {
  const angle = (Math.max(-1, Math.min(1, pan)) + 1) * Math.PI / 4;
  return [Math.cos(angle), Math.sin(angle)];
}

type SynthVoice = 'pad' | 'brass' | 'bass' | 'bell' | 'pluck' | 'reed' | 'mallet' | 'strings';

function addVoice(
  channels: [Float64Array, Float64Array],
  start: number,
  duration: number,
  frequency: number,
  volume: number,
  pan: number,
  voice: SynthVoice,
): void {
  const startSample = Math.floor(start * SAMPLE_RATE);
  const endSample = Math.min(channels[0].length, Math.ceil((start + duration) * SAMPLE_RATE));
  const [leftGain, rightGain] = panGains(pan);
  for (let index = startSample; index < endSample; index++) {
    const time = index / SAMPLE_RATE - start;
    const phase = Math.PI * 2 * frequency * time;
    const vibrato = voice === 'brass' ? Math.sin(time * Math.PI * 2 * 5.1) * 0.012 : 0;
    let sample = 0;
    let shape = 0;
    if (voice === 'pad') {
      sample = Math.sin(phase) + 0.32 * Math.sin(phase * 2 + 0.2) + 0.12 * Math.sin(phase * 3);
      shape = envelope(time, duration, 0.55, 0.85);
    } else if (voice === 'brass') {
      const shifted = phase + vibrato;
      sample = Math.sin(shifted) + 0.42 * Math.sin(shifted * 2) + 0.22 * Math.sin(shifted * 3) + 0.1 * Math.sin(shifted * 4);
      shape = envelope(time, duration, 0.055, 0.24) * (0.78 + 0.22 * Math.exp(-time * 2.2));
    } else if (voice === 'bass') {
      sample = Math.sin(phase) + 0.28 * Math.sin(phase * 2);
      shape = envelope(time, duration, 0.025, 0.18) * Math.exp(-time * 0.5);
    } else if (voice === 'bell') {
      sample = Math.sin(phase) + 0.4 * Math.sin(phase * 2.01);
      shape = envelope(time, duration, 0.006, 0.55) * Math.exp(-time * 1.3);
    } else if (voice === 'pluck') {
      sample = Math.sin(phase) + 0.48 * Math.sin(phase * 2) + 0.2 * Math.sin(phase * 3.01)
        + 0.08 * Math.sin(phase * 5.03);
      shape = envelope(time, duration, 0.004, 0.24) * Math.exp(-time * 3.2);
    } else if (voice === 'reed') {
      const reedVibrato = Math.sin(time * Math.PI * 2 * 4.7) * 0.018 * Math.min(1, time * 3);
      const shifted = phase + reedVibrato;
      sample = Math.sin(shifted) + 0.3 * Math.sin(shifted * 2) + 0.16 * Math.sin(shifted * 3)
        + 0.07 * Math.sin(shifted * 5);
      shape = envelope(time, duration, 0.035, 0.3) * (0.82 + 0.18 * Math.exp(-time * 2));
    } else if (voice === 'mallet') {
      sample = Math.sin(phase) + 0.38 * Math.sin(phase * 2.76) + 0.16 * Math.sin(phase * 5.41);
      shape = envelope(time, duration, 0.003, 0.48) * Math.exp(-time * 2.15);
    } else {
      sample = Math.sin(phase) + 0.24 * Math.sin(phase * 2) + 0.13 * Math.sin(phase * 3)
        + 0.06 * Math.sin(phase * 4);
      shape = envelope(time, duration, 0.22, 0.52);
    }
    const value = sample * shape * volume;
    channels[0][index] += value * leftGain;
    channels[1][index] += value * rightGain;
  }
}

let noiseState = 0x6c8e9cf5;
function noise(): number {
  noiseState ^= noiseState << 13;
  noiseState ^= noiseState >>> 17;
  noiseState ^= noiseState << 5;
  return ((noiseState >>> 0) / 0xffffffff) * 2 - 1;
}

type DrumKind = 'kick' | 'snare' | 'clap' | 'tom' | 'frame' | 'rim' | 'shaker';

function addDrum(
  channels: [Float64Array, Float64Array],
  start: number,
  kind: DrumKind,
  volume: number,
): void {
  const duration = kind === 'kick' ? 0.34
    : kind === 'tom' || kind === 'frame' ? 0.28
    : kind === 'shaker' ? 0.11
    : 0.18;
  const startSample = Math.floor(start * SAMPLE_RATE);
  const endSample = Math.min(channels[0].length, Math.ceil((start + duration) * SAMPLE_RATE));
  for (let index = startSample; index < endSample; index++) {
    const time = index / SAMPLE_RATE - start;
    let sample: number;
    if (kind === 'kick') {
      sample = Math.sin(Math.PI * 2 * (76 - 38 * time) * time) * Math.exp(-time * 13);
    } else if (kind === 'tom') {
      sample = Math.sin(Math.PI * 2 * (128 - 42 * time) * time) * Math.exp(-time * 9);
    } else if (kind === 'frame') {
      sample = Math.sin(Math.PI * 2 * (112 - 28 * time) * time) * Math.exp(-time * 8)
        + noise() * Math.exp(-time * 18) * 0.18;
    } else if (kind === 'rim') {
      sample = Math.sin(time * Math.PI * 2 * 1_340) * Math.exp(-time * 34)
        + noise() * Math.exp(-time * 46) * 0.24;
    } else if (kind === 'shaker') {
      sample = noise() * Math.max(0, Math.sin(time * Math.PI * 2 * 38)) * Math.exp(-time * 27);
    } else {
      const burst = kind === 'clap'
        ? Math.max(0, Math.sin(time * Math.PI * 2 * 24)) * Math.exp(-time * 18)
        : Math.exp(-time * 16);
      sample = noise() * burst + (kind === 'snare' ? Math.sin(time * Math.PI * 2 * 185) * Math.exp(-time * 20) * 0.35 : 0);
    }
    const pan = kind === 'clap' ? 0.12 : kind === 'shaker' ? 0.22 : kind === 'rim' ? -0.18 : 0;
    const [leftGain, rightGain] = panGains(pan);
    channels[0][index] += sample * volume * leftGain;
    channels[1][index] += sample * volume * rightGain;
  }
}

function renderScore(score: Score): Buffer {
  noiseState = 0x6c8e9cf5;
  const beat = 60 / score.bpm;
  const duration = score.bars * beat * 4 + 1.2;
  const length = Math.ceil(duration * SAMPLE_RATE);
  const channels: [Float64Array, Float64Array] = [new Float64Array(length), new Float64Array(length)];

  for (let bar = 0; bar < score.bars; bar++) {
    const barStart = bar * beat * 4;
    const chord = score.progression[bar % score.progression.length];
    for (let note = 0; note < chord.length; note++) {
      addVoice(channels, barStart, beat * 4.4, midiFrequency(chord[note]), 0.026, note % 2 === 0 ? -0.42 : 0.42, 'pad');
    }
    addVoice(channels, barStart, beat * 3.7, midiFrequency(chord[0] - 12), 0.055 * score.intensity, -0.08, 'bass');
    addVoice(channels, barStart + beat * 2, beat * 1.65, midiFrequency(chord[0] - 12), 0.043 * score.intensity, 0.08, 'bass');

    for (let beatIndex = 0; beatIndex < 4; beatIndex++) {
      const at = barStart + beatIndex * beat;
      addDrum(channels, at, beatIndex === 0 || beatIndex === 2 ? 'kick' : 'clap', 0.09 * score.intensity);
      if (beatIndex === 1 || beatIndex === 3) addDrum(channels, at, 'snare', 0.045 * score.intensity);
      if (bar >= Math.floor(score.bars / 2)) addDrum(channels, at + beat * 0.5, 'clap', 0.024 * score.intensity);
    }
    if (bar % 4 === 3) {
      addDrum(channels, barStart + beat * 3, 'tom', 0.08 * score.intensity);
      addDrum(channels, barStart + beat * 3.5, 'tom', 0.075 * score.intensity);
    }
  }

  for (const [bar, beatOffset, beatDuration, midi, velocity] of score.melody) {
    const start = (bar * 4 + beatOffset) * beat;
    const noteDuration = beatDuration * beat;
    addVoice(channels, start, noteDuration, midiFrequency(midi), 0.07 * velocity, -0.15, 'brass');
    addVoice(channels, start + 0.012, noteDuration * 0.95, midiFrequency(midi + 12), 0.018 * velocity, 0.28, 'bell');
  }

  // Two short cross-channel reflections add stadium width without a long tail.
  for (const [delaySeconds, amount] of [[0.11, 0.12], [0.23, 0.075]] as const) {
    const delay = Math.round(delaySeconds * SAMPLE_RATE);
    for (let index = delay; index < length; index++) {
      channels[0][index] += channels[1][index - delay] * amount;
      channels[1][index] += channels[0][index - delay] * amount;
    }
  }

  let peak = 0;
  for (const channel of channels) {
    for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  }
  const scale = peak > 0 ? 0.9 / peak : 1;
  const fadeSamples = Math.round(Math.min(0.85, duration / 8) * SAMPLE_RATE);
  const pcm = Buffer.alloc(length * CHANNELS * 2);
  for (let index = 0; index < length; index++) {
    const fadeIn = Math.min(1, index / fadeSamples);
    const fadeOut = Math.min(1, (length - index - 1) / fadeSamples);
    const fade = Math.min(fadeIn, fadeOut);
    for (let channel = 0; channel < CHANNELS; channel++) {
      const softened = Math.tanh(channels[channel][index] * scale * 1.15) * fade;
      pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, softened)) * 32767), (index * CHANNELS + channel) * 2);
    }
  }
  return wavBuffer(pcm, SAMPLE_RATE, CHANNELS);
}

const STYLE_LEADS: Readonly<Record<CompetitionStyle, SynthVoice>> = {
  knockout: 'brass',
  ceremony: 'brass',
  mainland: 'reed',
  southern: 'reed',
  eastern: 'mallet',
};

function scoreNoiseSeed(name: string): number {
  let seed = 0x811c9dc5;
  for (const character of name) {
    seed ^= character.charCodeAt(0);
    seed = Math.imul(seed, 0x01000193);
  }
  return seed || 0x6c8e9cf5;
}

function addCompetitionPercussion(
  channels: [Float64Array, Float64Array],
  score: CompetitionScore,
  bar: number,
  barStart: number,
  beat: number,
): void {
  const volume = score.intensity;
  if (score.style === 'knockout') {
    addDrum(channels, barStart, 'kick', 0.1 * volume);
    addDrum(channels, barStart + beat * 1.5, 'snare', 0.055 * volume);
    addDrum(channels, barStart + beat * 2, 'kick', 0.085 * volume);
    addDrum(channels, barStart + beat * 3, 'clap', 0.052 * volume);
    for (let step = 1; step < 8; step += 2) addDrum(channels, barStart + beat * step / 2, 'shaker', 0.024 * volume);
  } else if (score.style === 'ceremony') {
    addDrum(channels, barStart, 'kick', 0.09 * volume);
    addDrum(channels, barStart + beat, 'snare', 0.045 * volume);
    addDrum(channels, barStart + beat * 2, 'kick', 0.078 * volume);
    addDrum(channels, barStart + beat * 3, 'snare', 0.05 * volume);
    if (bar % 2 === 1) addDrum(channels, barStart + beat * 3.5, 'tom', 0.055 * volume);
  } else if (score.style === 'mainland') {
    addDrum(channels, barStart, 'frame', 0.12 * volume);
    addDrum(channels, barStart + beat, 'rim', 0.044 * volume);
    addDrum(channels, barStart + beat * 2, 'tom', 0.095 * volume);
    addDrum(channels, barStart + beat * 3, 'rim', 0.04 * volume);
    if (bar % 4 === 3) addDrum(channels, barStart + beat * 3.5, 'frame', 0.08 * volume);
  } else if (score.style === 'southern') {
    addDrum(channels, barStart, 'kick', 0.085 * volume);
    addDrum(channels, barStart + beat * 1.5, 'clap', 0.055 * volume);
    addDrum(channels, barStart + beat * 2.5, 'kick', 0.072 * volume);
    addDrum(channels, barStart + beat * 3.25, 'rim', 0.045 * volume);
    for (let step = 1; step < 8; step++) addDrum(channels, barStart + beat * step / 2, 'shaker', 0.02 * volume);
  } else {
    addDrum(channels, barStart, 'frame', 0.1 * volume);
    addDrum(channels, barStart + beat * 1.5, 'rim', 0.05 * volume);
    addDrum(channels, barStart + beat * 2, 'frame', 0.075 * volume);
    addDrum(channels, barStart + beat * 3.25, 'rim', 0.04 * volume);
    if (bar % 4 === 3) addDrum(channels, barStart + beat * 3.5, 'tom', 0.065 * volume);
  }
}

function addCompetitionAccompaniment(
  channels: [Float64Array, Float64Array],
  score: CompetitionScore,
  chord: number[],
  barStart: number,
  beat: number,
): void {
  const root = chord[0];
  const intensity = score.intensity;
  for (let note = 0; note < chord.length; note++) {
    addVoice(
      channels,
      barStart,
      beat * 4.08,
      midiFrequency(chord[note]),
      0.018,
      note % 2 === 0 ? -0.46 : 0.46,
      'strings',
    );
  }

  if (score.style === 'knockout') {
    for (const beatOffset of [0, 1.5, 2, 3.25]) {
      addVoice(channels, barStart + beat * beatOffset, beat * 0.62, midiFrequency(root - 12), 0.052 * intensity, -0.08, 'bass');
    }
    for (const beatOffset of [0.5, 1.5, 2.5, 3.5]) {
      addVoice(channels, barStart + beat * beatOffset, beat * 0.42, midiFrequency(chord[2] + 12), 0.026 * intensity, 0.28, 'pluck');
    }
  } else if (score.style === 'ceremony') {
    addVoice(channels, barStart, beat * 3.7, midiFrequency(root - 12), 0.05 * intensity, -0.08, 'bass');
    addVoice(channels, barStart + beat * 2, beat * 1.6, midiFrequency(root - 12), 0.038 * intensity, 0.08, 'bass');
    for (const beatOffset of [0, 2]) {
      addVoice(channels, barStart + beat * beatOffset, beat * 1.15, midiFrequency(chord.at(-1)! + 12), 0.026 * intensity, 0.3, 'bell');
    }
  } else if (score.style === 'mainland') {
    for (const beatOffset of [0, 2]) {
      addVoice(channels, barStart + beat * beatOffset, beat * 1.7, midiFrequency(root - 12), 0.054 * intensity, -0.12, 'bass');
      addVoice(channels, barStart + beat * beatOffset, beat * 0.82, midiFrequency(chord[2] + 12), 0.03 * intensity, 0.24, 'mallet');
    }
  } else if (score.style === 'southern') {
    for (const beatOffset of [0, 1.5, 2.5]) {
      addVoice(channels, barStart + beat * beatOffset, beat * 0.78, midiFrequency(root - 12), 0.047 * intensity, -0.18, 'bass');
    }
    for (const [index, beatOffset] of [0.25, 1, 1.75, 2.5, 3.25].entries()) {
      addVoice(channels, barStart + beat * beatOffset, beat * 0.5, midiFrequency(chord[index % chord.length] + 12), 0.032 * intensity, 0.32, 'pluck');
    }
  } else {
    addVoice(channels, barStart, beat * 2.2, midiFrequency(root - 12), 0.048 * intensity, -0.12, 'bass');
    addVoice(channels, barStart + beat * 2.5, beat * 1.25, midiFrequency(root - 12), 0.04 * intensity, 0.08, 'bass');
    for (const [index, beatOffset] of [0, 1.5, 2.75].entries()) {
      addVoice(channels, barStart + beat * beatOffset, beat * 0.8, midiFrequency(chord[(index + 1) % chord.length] + 12), 0.028 * intensity, 0.3, 'mallet');
    }
  }
}

function renderCompetitionScore(score: CompetitionScore): Buffer {
  noiseState = scoreNoiseSeed(score.name);
  const beat = 60 / score.bpm;
  const duration = score.bars * beat * 4;
  const length = Math.ceil(duration * SAMPLE_RATE);
  const channels: [Float64Array, Float64Array] = [new Float64Array(length), new Float64Array(length)];

  for (let bar = 0; bar < score.bars; bar++) {
    const barStart = bar * beat * 4;
    const chord = score.progression[bar % score.progression.length];
    addCompetitionAccompaniment(channels, score, chord, barStart, beat);
    addCompetitionPercussion(channels, score, bar, barStart, beat);
  }

  const lead = STYLE_LEADS[score.style];
  for (const [bar, beatOffset, beatDuration, midi, velocity] of score.melody) {
    const start = (bar * 4 + beatOffset) * beat;
    const noteDuration = beatDuration * beat;
    const leadVolume = score.style === 'southern' ? 0.062 : score.style === 'eastern' ? 0.066 : 0.068;
    addVoice(channels, start, noteDuration, midiFrequency(midi), leadVolume * velocity, -0.14, lead);
    const supportVoice: SynthVoice = score.style === 'ceremony' ? 'bell'
      : score.style === 'mainland' || score.style === 'eastern' ? 'mallet'
      : 'pluck';
    addVoice(channels, start + 0.012, noteDuration * 0.88, midiFrequency(midi + 12), 0.014 * velocity, 0.3, supportVoice);
  }

  const reflections = score.style === 'southern'
    ? [[0.085, 0.09], [0.17, 0.055]] as const
    : score.style === 'mainland'
      ? [[0.13, 0.1], [0.27, 0.06]] as const
      : [[0.1, 0.1], [0.21, 0.06]] as const;
  for (const [delaySeconds, amount] of reflections) {
    const delay = Math.round(delaySeconds * SAMPLE_RATE);
    for (let index = delay; index < length; index++) {
      channels[0][index] += channels[1][index - delay] * amount;
      channels[1][index] += channels[0][index - delay] * amount;
    }
  }

  let peak = 0;
  for (const channel of channels) {
    for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  }
  const scale = peak > 0 ? 0.9 / peak : 1;
  const edgeFadeSamples = Math.round(0.08 * SAMPLE_RATE);
  const pcm = Buffer.alloc(length * CHANNELS * 2);
  for (let index = 0; index < length; index++) {
    const fadeIn = Math.min(1, index / edgeFadeSamples);
    const fadeOut = Math.min(1, (length - index - 1) / edgeFadeSamples);
    const fade = Math.min(fadeIn, fadeOut);
    for (let channel = 0; channel < CHANNELS; channel++) {
      const softened = Math.tanh(channels[channel][index] * scale * 1.18) * fade;
      pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, softened)) * 32767), (index * CHANNELS + channel) * 2);
    }
  }
  return wavBuffer(pcm, SAMPLE_RATE, CHANNELS);
}

function wavBuffer(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

mkdirSync(outputDir, { recursive: true });
mkdirSync(tempDir, { recursive: true });
function writeTrack(name: string, wave: Buffer, bitrate: number): void {
  const wavPath = join(tempDir, `${name}.wav`);
  const outputPath = new URL(`${name}.m4a`, outputDir);
  writeFileSync(wavPath, wave);
  execFileSync('/usr/bin/afconvert', [
    '-f', 'm4af',
    '-d', 'aac',
    '-b', String(bitrate),
    '-q', '127',
    wavPath,
    outputPath.pathname,
  ]);
  process.stdout.write(`${name}.m4a\n`);
}

for (const score of SCORES) writeTrack(score.name, renderScore(score), 112_000);
for (const score of COMPETITION_SCORES) writeTrack(score.name, renderCompetitionScore(score), 96_000);
rmSync(tempDir, { recursive: true, force: true });

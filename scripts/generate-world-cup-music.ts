import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SAMPLE_RATE = 32_000;
const CHANNELS = 2;
const outputDir = new URL('../src/assets/audio/', import.meta.url);
const tempDir = join(tmpdir(), 'football-universe-music');

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

function addVoice(
  channels: [Float64Array, Float64Array],
  start: number,
  duration: number,
  frequency: number,
  volume: number,
  pan: number,
  voice: 'pad' | 'brass' | 'bass' | 'bell',
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
    } else {
      sample = Math.sin(phase) + 0.4 * Math.sin(phase * 2.01);
      shape = envelope(time, duration, 0.006, 0.55) * Math.exp(-time * 1.3);
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

function addDrum(
  channels: [Float64Array, Float64Array],
  start: number,
  kind: 'kick' | 'snare' | 'clap' | 'tom',
  volume: number,
): void {
  const duration = kind === 'kick' ? 0.34 : kind === 'tom' ? 0.28 : 0.18;
  const startSample = Math.floor(start * SAMPLE_RATE);
  const endSample = Math.min(channels[0].length, Math.ceil((start + duration) * SAMPLE_RATE));
  for (let index = startSample; index < endSample; index++) {
    const time = index / SAMPLE_RATE - start;
    let sample: number;
    if (kind === 'kick') {
      sample = Math.sin(Math.PI * 2 * (76 - 38 * time) * time) * Math.exp(-time * 13);
    } else if (kind === 'tom') {
      sample = Math.sin(Math.PI * 2 * (128 - 42 * time) * time) * Math.exp(-time * 9);
    } else {
      const burst = kind === 'clap'
        ? Math.max(0, Math.sin(time * Math.PI * 2 * 24)) * Math.exp(-time * 18)
        : Math.exp(-time * 16);
      sample = noise() * burst + (kind === 'snare' ? Math.sin(time * Math.PI * 2 * 185) * Math.exp(-time * 20) * 0.35 : 0);
    }
    const pan = kind === 'clap' ? 0.12 : 0;
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
for (const score of SCORES) {
  const wavPath = join(tempDir, `${score.name}.wav`);
  const outputPath = new URL(`${score.name}.m4a`, outputDir);
  writeFileSync(wavPath, renderScore(score));
  execFileSync('/usr/bin/afconvert', [
    '-f', 'm4af',
    '-d', 'aac',
    '-b', '112000',
    '-q', '127',
    wavPath,
    outputPath.pathname,
  ]);
  process.stdout.write(`${score.name}.m4a\n`);
}
rmSync(tempDir, { recursive: true, force: true });

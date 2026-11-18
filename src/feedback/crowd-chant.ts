// The pulse under the crowd.
//
// Three layers of filtered noise give a stand its hiss, and hiss is what the
// soundscape had: a texture with no beat in it. A real ground is not hiss. It
// is a clap that goes round, a thump underneath it, and a wash of voices
// carrying both. That rhythm is the single most recognisable thing about
// being inside a stadium, and it was the one thing missing.
//
// Nothing here is a sample. Every layer is synthesised from the same seeded
// noise the rest of the soundscape uses, so it costs no bytes, downloads
// nothing, and consumes no simulation randomness.
//
// The layers arrive one at a time as the match gets louder. That is the whole
// design: a settled league game is sparse clapping, a final is a wall.

import type { SoundProfile } from './preferences';

export type ChantLayerKey = 'sparse' | 'dense' | 'thump' | 'voice';

export interface ChantLayerGains {
  /** Clapping on the beat. Present from the first minute, quiet. */
  sparse: number;
  /** Clapping on the off-beat too. Arrives when the match matters. */
  dense: number;
  /** The low hit under the clap. */
  thump: number;
  /** Distant voices, filtered down to their rhythm and nothing else. */
  voice: number;
}

/** Where each layer starts to arrive, as a share of crowd intensity. */
const ONSET = { dense: 0.42, thump: 0.56, voice: 0.64 };
/** How long each layer takes to reach full once it has started. */
const SPAN = { dense: 0.34, thump: 0.3, voice: 0.28 };

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * How loud each layer of the chant is right now.
 *
 * Sparse clapping never fully leaves — a ground is never silent — but it is
 * the only layer a quiet match gets. The other three fade in on their own
 * thresholds so the change from "a game" to "a final" is heard as layers
 * arriving rather than as one volume knob going up.
 */
export function chantLayerGains(intensity: number, paused: boolean): ChantLayerGains {
  if (paused) return { sparse: 0, dense: 0, thump: 0, voice: 0 };
  const level = clamp01(intensity);
  const ramp = (onset: number, span: number) => clamp01((level - onset) / span);
  return {
    sparse: 0.32 + level * 0.68,
    dense: ramp(ONSET.dense, SPAN.dense),
    thump: ramp(ONSET.thump, SPAN.thump) * 0.85,
    voice: ramp(ONSET.voice, SPAN.voice) * 0.75,
  };
}

/** Chant level per sound profile. `stadium` is the one that should feel full. */
export const CHANT_PROFILE_GAIN: Readonly<Record<SoundProfile, number>> = {
  quiet: 0.5,
  balanced: 1,
  stadium: 1.36,
};

/** A marching tempo: fast enough to clap to, slow enough not to feel frantic. */
export const CHANT_BPM = 112;
export const CHANT_BEAT_SECONDS = 60 / CHANT_BPM;
export const CHANT_SPARSE_BEATS = 16;
export const CHANT_DENSE_BEATS = 8;

export function seededChantNoise(seed: number): () => number {
  let value = seed || 1;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

/**
 * Which beats carry a clap.
 *
 * Downbeats always land — that is what makes a pulse a pulse — and the rest
 * thin out with density. Deterministic from the seed so the same fixture
 * always claps the same way, and so a loop point never falls on a gap.
 */
export function clapBeats(seed: number, beats: number, density: number): number[] {
  const random = seededChantNoise(seed);
  const out: number[] = [];
  for (let beat = 0; beat < beats; beat += 1) {
    const weight = beat % 4 === 0 ? 1 : clamp01(density);
    if (random() < weight) out.push(beat);
  }
  return out;
}

/** A two-pole bandpass, in place. Gives a clap its edge instead of its static. */
function bandpass(data: Float32Array, rate: number, frequency: number, q: number): void {
  const omega = (2 * Math.PI * frequency) / rate;
  const alpha = Math.sin(omega) / (2 * q);
  const cos = Math.cos(omega);
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let index = 0; index < data.length; index += 1) {
    const x0 = data[index];
    const y0 = (alpha * x0 - alpha * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    data[index] = y0;
  }
}

/** A two-pole lowpass, in place. What turns voices into a distant wash. */
function lowpass(data: Float32Array, rate: number, frequency: number, q: number): void {
  const omega = (2 * Math.PI * frequency) / rate;
  const alpha = Math.sin(omega) / (2 * q);
  const cos = Math.cos(omega);
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  const b0 = (1 - cos) / 2;
  const b1 = 1 - cos;
  const b2 = (1 - cos) / 2;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let index = 0; index < data.length; index += 1) {
    const x0 = data[index];
    const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    data[index] = y0;
  }
}

/**
 * Where each layer is allowed to peak.
 *
 * These layers used to be written at whatever level their synthesis happened
 * to land on, which put the voice track at 1.07 — over full scale before it
 * had been through a single gain — and left the balance between them an
 * accident of the filter maths rather than a decision. Normalizing each one
 * to a declared peak makes the balance something a test can check.
 */
export const CHANT_LAYER_PEAKS: Readonly<Record<ChantLayerKey, number>> = {
  sparse: 0.55,
  dense: 0.5,
  thump: 0.7,
  voice: 0.22,
};

/**
 * Trim on the chant bus.
 *
 * The loudest the bus can get is the weighted sum of `CHANT_LAYER_PEAKS` and
 * `chantLayerGains`, which is 1.81 before any gain. At the old profile gain of
 * 1.36 that peaked at 2.69 — 8.6 dB over full scale — and the bus compressor
 * spent the whole match pulling 20 dB out of a signal that was never meant to
 * be that loud. This puts the worst case just under full scale instead.
 */
export const CHANT_BUS_TRIM = 0.3;

/** Scale a buffer so its loudest sample sits exactly on `target`. */
export function normalizePeak(data: Float32Array, target: number): void {
  let peak = 0;
  for (let index = 0; index < data.length; index += 1) {
    const magnitude = Math.abs(data[index]);
    if (magnitude > peak) peak = magnitude;
  }
  if (peak <= 1e-6) return;
  const scale = target / peak;
  for (let index = 0; index < data.length; index += 1) data[index] *= scale;
}

function makeBuffer(context: AudioContext, seconds: number, rate: number): AudioBuffer {
  const length = Math.max(1, Math.floor(rate * seconds));
  const buffer = context.createBuffer(1, length, rate);
  return buffer;
}

/** Clapping, scattered the way a crowd is never quite together. */
export function fillClapTrack(
  data: Float32Array,
  rate: number,
  seed: number,
  beats: number,
  density: number,
): void {
  const random = seededChantNoise(seed);
  const hits = clapBeats(seed, beats, density);
  const clapLength = Math.floor(rate * 0.06);
  for (const beat of hits) {
    const start = Math.floor(beat * CHANT_BEAT_SECONDS * rate);
    // A crowd is never together: scatter each clap a few milliseconds.
    const scatter = Math.floor((random() - 0.5) * rate * 0.012);
    // Relative variation only; the absolute level comes from normalizePeak.
    const level = 0.7 + random() * 0.5;
    for (let index = 0; index < clapLength; index += 1) {
      const at = start + scatter + index;
      if (at < 0 || at >= data.length) continue;
      const t = index / clapLength;
      const envelope = Math.exp(-t * 9) * (1 - t);
      data[at] += (random() * 2 - 1) * envelope * level;
    }
  }
  bandpass(data, rate, 1750, 0.8);
}

/** The low hit under the clap. */
export function fillThumpTrack(data: Float32Array, rate: number, beats: number): void {
  const length = Math.floor(rate * 0.16);
  for (let beat = 0; beat < beats; beat += 2) {
    const start = Math.floor(beat * CHANT_BEAT_SECONDS * rate);
    for (let index = 0; index < length; index += 1) {
      const at = start + index;
      if (at >= data.length) continue;
      const t = index / length;
      const envelope = Math.exp(-t * 6) * (1 - t);
      // A dropped sine, the way a bass drum falls as it decays.
      const frequency = 62 - t * 22;
      data[at] += Math.sin((2 * Math.PI * frequency * index) / rate) * envelope * 0.9;
    }
  }
}

/** Distant voices, filtered down to their rhythm and nothing else. */
export function fillVoiceTrack(data: Float32Array, rate: number, seed: number): void {
  const random = seededChantNoise(seed);
  let smoothed = 0;
  for (let index = 0; index < data.length; index += 1) {
    const noise = random() * 2 - 1;
    smoothed = smoothed * 0.93 + noise * 0.07;
    // The 3.2 that used to sit here pushed this track to a peak of 1.07 —
    // over full scale before any gain — so the level is set by
    // `CHANT_LAYER_PEAKS` after the filters instead.
    data[index] = smoothed;
  }
  // Everything above a few hundred hertz is gone. What is left is the swell of
  // a crowd, not the words, which is the point: a synthesised voice that can
  // be heard as a voice sounds like a synthesiser.
  lowpass(data, rate, 380, 0.7);
  // Two slow swells a bar apart, so the wash breathes instead of sitting still.
  for (let index = 0; index < data.length; index += 1) {
    const seconds = index / rate;
    const swell = 0.55 + Math.sin(seconds * 1.9) * 0.28 + Math.sin(seconds * 0.61) * 0.17;
    data[index] *= swell;
  }
}

export interface ChantBuffers {
  sparse: AudioBuffer;
  dense: AudioBuffer;
  thump: AudioBuffer;
  voice: AudioBuffer;
}

const chantCache = new WeakMap<AudioContext, ChantBuffers>();

/** How long each layer's loop is, at the chant tempo. */
export function chantLayerSeconds(key: ChantLayerKey): number {
  const beats = key === 'sparse' || key === 'voice' ? CHANT_SPARSE_BEATS : CHANT_DENSE_BEATS;
  return beats * CHANT_BEAT_SECONDS;
}

/**
 * Fill one normalized chant layer. Pure, so a test can measure what it built
 * rather than trusting the synthesis to have landed somewhere sensible.
 */
export function buildChantLayer(
  key: ChantLayerKey,
  data: Float32Array,
  rate: number,
  seed: number,
): void {
  if (key === 'sparse') fillClapTrack(data, rate, seed ^ 0x2f1b, CHANT_SPARSE_BEATS, 0.34);
  else if (key === 'dense') fillClapTrack(data, rate, seed ^ 0x7a3d, CHANT_DENSE_BEATS, 0.82);
  else if (key === 'thump') fillThumpTrack(data, rate, CHANT_DENSE_BEATS);
  else fillVoiceTrack(data, rate, seed ^ 0x51c7);
  normalizePeak(data, CHANT_LAYER_PEAKS[key]);
}

/** One set of chant loops per audio context, built once and looped forever. */
export function getChantBuffers(context: AudioContext, seed: number): ChantBuffers {
  const cached = chantCache.get(context);
  if (cached) return cached;
  const rate = Math.min(22_050, context.sampleRate);
  const keys: ChantLayerKey[] = ['sparse', 'dense', 'thump', 'voice'];
  const buffers = {} as ChantBuffers;
  for (const key of keys) {
    const buffer = makeBuffer(context, chantLayerSeconds(key), rate);
    buildChantLayer(key, buffer.getChannelData(0), rate, seed);
    buffers[key] = buffer;
  }
  chantCache.set(context, buffers);
  return buffers;
}

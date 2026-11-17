import { describe, expect, it } from 'vitest';
import {
  CHANT_BEAT_SECONDS,
  CHANT_BPM,
  CHANT_DENSE_BEATS,
  CHANT_PROFILE_GAIN,
  CHANT_SPARSE_BEATS,
  chantLayerGains,
  clapBeats,
} from './crowd-chant';

describe('chantLayerGains', () => {
  it('goes silent when the match is paused', () => {
    expect(chantLayerGains(1, true)).toEqual({ sparse: 0, dense: 0, thump: 0, voice: 0 });
  });

  it('gives a quiet match clapping and nothing else', () => {
    const gains = chantLayerGains(0.2, false);
    expect(gains.sparse).toBeGreaterThan(0);
    expect(gains.dense).toBe(0);
    expect(gains.thump).toBe(0);
    expect(gains.voice).toBe(0);
  });

  it('brings every layer in by the end of a final', () => {
    const gains = chantLayerGains(1, false);
    expect(gains.sparse).toBeGreaterThan(0);
    expect(gains.dense).toBeGreaterThan(0);
    expect(gains.thump).toBeGreaterThan(0);
    expect(gains.voice).toBeGreaterThan(0);
  });

  it('arrives one layer at a time rather than all at once', () => {
    const quiet = chantLayerGains(0.2, false);
    const busy = chantLayerGains(0.5, false);
    const loud = chantLayerGains(0.8, false);
    expect(quiet.dense).toBe(0);
    expect(busy.dense).toBeGreaterThan(0);
    expect(busy.voice).toBe(0);
    expect(loud.voice).toBeGreaterThan(0);
  });

  it('never lets a layer fall as the match gets louder', () => {
    let previous = chantLayerGains(0, false);
    for (let step = 1; step <= 20; step += 1) {
      const next = chantLayerGains(step / 20, false);
      expect(next.sparse).toBeGreaterThanOrEqual(previous.sparse);
      expect(next.dense).toBeGreaterThanOrEqual(previous.dense);
      expect(next.thump).toBeGreaterThanOrEqual(previous.thump);
      expect(next.voice).toBeGreaterThanOrEqual(previous.voice);
      previous = next;
    }
  });

  it('clamps an out-of-range intensity', () => {
    expect(chantLayerGains(4, false)).toEqual(chantLayerGains(1, false));
    expect(chantLayerGains(-2, false)).toEqual(chantLayerGains(0, false));
  });
});

describe('clapBeats', () => {
  it('always lands the downbeat', () => {
    const beats = clapBeats(7, 16, 0);
    expect(beats).toEqual([0, 4, 8, 12]);
  });

  it('fills in as density rises', () => {
    const sparse = clapBeats(11, 16, 0.2).length;
    const dense = clapBeats(11, 16, 0.9).length;
    expect(dense).toBeGreaterThan(sparse);
  });

  it('is the same every time for the same seed', () => {
    expect(clapBeats(99, 16, 0.6)).toEqual(clapBeats(99, 16, 0.6));
  });

  it('stays inside the bar', () => {
    const beats = clapBeats(3, CHANT_SPARSE_BEATS, 1);
    expect(beats.every(beat => beat >= 0 && beat < CHANT_SPARSE_BEATS)).toBe(true);
    expect(beats.every(beat => Number.isInteger(beat))).toBe(true);
  });
});

describe('chant constants', () => {
  it('runs at a tempo a crowd could actually clap to', () => {
    expect(CHANT_BPM).toBeGreaterThanOrEqual(90);
    expect(CHANT_BPM).toBeLessThanOrEqual(140);
    expect(CHANT_BEAT_SECONDS).toBeCloseTo(60 / CHANT_BPM, 6);
  });

  it('loops on a whole number of bars', () => {
    expect(CHANT_SPARSE_BEATS % 4).toBe(0);
    expect(CHANT_DENSE_BEATS % 4).toBe(0);
  });

  it('gets fuller as the sound profile opens up', () => {
    expect(CHANT_PROFILE_GAIN.quiet).toBeLessThan(CHANT_PROFILE_GAIN.balanced);
    expect(CHANT_PROFILE_GAIN.stadium).toBeGreaterThan(CHANT_PROFILE_GAIN.balanced);
  });
});

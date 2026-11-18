import { describe, expect, it } from 'vitest';
import {
  buildChantLayer,
  chantLayerGains,
  chantLayerSeconds,
  CHANT_BUS_TRIM,
  CHANT_LAYER_PEAKS,
  CHANT_PROFILE_GAIN,
  type ChantLayerKey,
} from './crowd-chant';
import {
  ballTouchTone,
  chantBusGain,
  computeCrowdGainLevel,
  CROWD_BED_LAYERS,
  fillNoiseBuffer,
  MATCH_SOUND_PROFILE_MIX,
} from './match-soundscape';

const RATE = 22_050;
const BED_RATE = 12_000;
const SEED = 0x51f15e;
const KEYS: ChantLayerKey[] = ['sparse', 'dense', 'thump', 'voice'];

function peakOf(data: Float32Array): number {
  let peak = 0;
  for (let index = 0; index < data.length; index += 1) {
    const magnitude = Math.abs(data[index]);
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}

function countAbove(data: Float32Array, threshold: number): number {
  let count = 0;
  for (let index = 0; index < data.length; index += 1) {
    if (Math.abs(data[index]) >= threshold) count += 1;
  }
  return count;
}

function rmsOf(data: Float32Array): number {
  let sum = 0;
  for (let index = 0; index < data.length; index += 1) sum += data[index] * data[index];
  return Math.sqrt(sum / Math.max(1, data.length));
}

function chantLayer(key: ChantLayerKey): Float32Array {
  const data = new Float32Array(Math.floor(chantLayerSeconds(key) * RATE));
  buildChantLayer(key, data, RATE, SEED);
  return data;
}

function crowdBed(): Float32Array {
  const data = new Float32Array(Math.floor(BED_RATE * 1.8));
  fillNoiseBuffer(data, BED_RATE, SEED);
  return data;
}

/** Loudest the chant bus can get, at the loudest profile and full intensity. */
function chantBusPeak(): number {
  const gains = chantLayerGains(1, false);
  const weighted = KEYS.reduce(
    (sum, key) => sum + gains[key] * CHANT_LAYER_PEAKS[key],
    0,
  );
  return weighted
    * chantBusGain('stadium', 1)
    * MATCH_SOUND_PROFILE_MIX.stadium.master;
}

/** Loudest the stand bed can get, at the loudest profile and full intensity. */
function crowdBedPeak(): number {
  const layerSum = CROWD_BED_LAYERS.reduce((sum, layer) => sum + layer.volume, 0);
  return peakOf(crowdBed())
    * layerSum
    * computeCrowdGainLevel(1, 1, false)
    * MATCH_SOUND_PROFILE_MIX.stadium.crowd;
}

describe('ball touch', () => {
  it('makes a short touch duller and quieter than a long switch', () => {
    const short = ballTouchTone(11);
    const long = ballTouchTone(27);

    expect(short.brightness).toBeLessThan(long.brightness);
    expect(short.strength).toBeLessThan(long.strength);
    // Both have to stay under a shot, which is struck at 1.3.
    expect(long.strength).toBeLessThan(1.3);
    expect(short.strength).toBeGreaterThan(0.3);
  });

  it('clamps outside the range a pass can actually be struck at', () => {
    expect(ballTouchTone(0)).toEqual(ballTouchTone(8));
    expect(ballTouchTone(90)).toEqual(ballTouchTone(28));
  });
});

describe('crowd mix', () => {
  it('lands every chant layer on the peak it declares', () => {
    for (const key of KEYS) {
      const data = chantLayer(key);
      expect(peakOf(data)).toBeCloseTo(CHANT_LAYER_PEAKS[key], 5);
      // A layer has to have body, not one lone sample sitting at the top.
      // Claps are transient by nature, so they are checked by how much of the
      // loop is actually sounding; the sustained layers by their crest factor.
      const sounding = countAbove(data, CHANT_LAYER_PEAKS[key] * 0.2);
      expect(sounding).toBeGreaterThan(data.length * 0.002);
      if (key === 'thump' || key === 'voice') {
        expect(rmsOf(data) / peakOf(data)).toBeGreaterThan(0.05);
      }
    }
  });

  it('keeps the chant bus inside full scale at the loudest profile', () => {
    // The voice layer used to be written straight past 1.0 and the profile
    // gain multiplied that by 1.36, so the bus peaked at 2.69 and the
    // compressor spent the match pulling 20 dB out of it.
    expect(chantBusPeak()).toBeLessThan(1);
    expect(chantBusPeak()).toBeGreaterThan(0.35);
  });

  it('leaves the stand audible under the chant instead of burying it', () => {
    const gapDb = 20 * Math.log10(chantBusPeak() / crowdBedPeak());

    // A bed more than 18 dB down is not a mix, it is a missing layer; closer
    // than 8 dB and the rhythm stops being the thing you hear.
    expect(gapDb).toBeGreaterThan(8);
    expect(gapDb).toBeLessThan(18);
  });

  it('still has a stand to hear when the match is quiet', () => {
    const quietBed = peakOf(crowdBed())
      * CROWD_BED_LAYERS.reduce((sum, layer) => sum + layer.volume, 0)
      * computeCrowdGainLevel(0.16, 0, false)
      * MATCH_SOUND_PROFILE_MIX.stadium.crowd;

    expect(quietBed).toBeGreaterThan(0.02);
  });

  it('applies the bus trim on top of the profile gain, not instead of it', () => {
    expect(chantBusGain('stadium', 1)).toBeCloseTo(
      CHANT_PROFILE_GAIN.stadium * CHANT_BUS_TRIM,
      10,
    );
    expect(chantBusGain('quiet', 1)).toBeLessThan(chantBusGain('balanced', 1));
    expect(chantBusGain('stadium', 0.5)).toBeCloseTo(chantBusGain('stadium', 1) / 2, 10);
  });
});

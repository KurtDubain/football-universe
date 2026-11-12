import { describe, it, expect } from 'vitest';
import {
  computeInitialMarketValue,
  computePresentMarketValue,
  pricingRating,
  applyAnnualRevaluation,
  POTENTIAL_PRICED_UNTIL_AGE,
} from './market-value';
import { Player, PlayerSeasonStats } from '../../types/player';

function mkPlayer(overrides: Partial<Player> = {}): Player {
  return {
    uuid: 'p-1', teamId: 'A', name: 'X', number: 9, position: 'FW',
    rating: 80, peakRating: 80, peakAge: 27,
    goalScoring: 70, marketValue: 0, age: 27,
    ...overrides,
  };
}

describe('computeInitialMarketValue — peakRating-driven base', () => {
  it('a 19-year-old wonderkid destined for 90 has high MV (no double age penalty)', () => {
    // Pre-v10 bug: rating was age-scaled (so a 19yo wonderkid had rating ~63),
    // then computeInitialMarketValue applied ageMultiplier(19)=1.15 on top of
    // that already-discounted rating. Net: the wonderkid was undervalued.
    //
    // Post-v10: base derives from peakRating (90), so the wonderkid premium
    // (1.15× from age band <=19) lands on top of the elite-tier base — they
    // come out as the most expensive band.
    const wonderkid = mkPlayer({ rating: 63, peakRating: 90, age: 19 });
    const veteran = mkPlayer({ rating: 63, peakRating: 90, age: 27 }); // same current rating, same peak

    const wonderkidMV = computeInitialMarketValue(wonderkid);
    const veteranMV = computeInitialMarketValue(veteran);

    // Wonderkid premium (1.15) > peak band (1.0)
    expect(wonderkidMV).toBeGreaterThan(veteranMV);
    // Wonderkid should be in the elite-tier price range, not the journeyman
    // range that rating=63 alone would imply.
    expect(wonderkidMV).toBeGreaterThan(50); // would be ~5-10 if base was rating
  });

  it('falls back to player.rating when peakRating is missing (legacy save path)', () => {
    // Simulate a half-migrated player — peakRating undefined.
    const legacy: Player = {
      uuid: 'p-1', teamId: 'A', name: 'L', number: 10, position: 'MF',
      rating: 75, age: 26, goalScoring: 50, marketValue: 0,
      peakRating: undefined as unknown as number,
      peakAge: 27,
    };
    const mv = computeInitialMarketValue(legacy);
    // Just confirm it returned a positive number (no crash, no NaN).
    expect(mv).toBeGreaterThan(0);
    expect(Number.isFinite(mv)).toBe(true);
  });

  it('elite peakRating (95) commands a higher MV than mid peakRating (75) at the same age', () => {
    const elite = mkPlayer({ rating: 95, peakRating: 95, age: 27 });
    const mid = mkPlayer({ rating: 75, peakRating: 75, age: 27 });
    expect(computeInitialMarketValue(elite)).toBeGreaterThan(computeInitialMarketValue(mid));
  });

  it('old player past prime — high peakRating but low MV relative to peer-age', () => {
    // A 36-year-old whose peak was 90: the base tier reflects an elite player
    // (peakRating-keyed → big base), but the ageMultiplier=0.35 tax brings
    // their MV down to a fraction of what a same-peak player at 27 fetches.
    const oldStar = mkPlayer({ rating: 56, peakRating: 90, age: 36 });
    const peerInPeak = mkPlayer({ rating: 90, peakRating: 90, age: 27 });
    const oldStarMV = computeInitialMarketValue(oldStar);
    const peerInPeakMV = computeInitialMarketValue(peerInPeak);

    // Old star is heavily discounted by ageMultiplier(36+)=0.35 compared to
    // peakMultiplier(27)=1.0 — ratio should be roughly 0.35.
    expect(oldStarMV).toBeLessThan(peerInPeakMV * 0.4);
    // But still positive — they're an elite name, just past it.
    expect(oldStarMV).toBeGreaterThan(0);
  });
});

describe('applyAnnualRevaluation — rating recompute via curve', () => {
  function emptyStats(): Record<string, PlayerSeasonStats> {
    return {};
  }

  it('bumps age and recomputes rating from peakRating + new age + peakAge', () => {
    // Player at age 24, peakAge 27, peakRating 85. age 24 = peakAge-3 (rising).
    // After season-end: age 25 → peakAge-2 → start of plateau → rating 85.
    const players = [mkPlayer({ rating: 80, peakRating: 85, peakAge: 27, age: 24 })];
    const squads = { A: players };
    applyAnnualRevaluation(squads, emptyStats(), new Set(), null);

    expect(players[0].age).toBe(25);
    expect(players[0].rating).toBe(85); // climbed via curve
    // peakRating / peakAge are immutable
    expect(players[0].peakRating).toBe(85);
    expect(players[0].peakAge).toBe(27);
  });

  it('older player in decline gets rating bumped DOWN by curve', () => {
    // peakAge 27, peakRating 90, age 32 → next year age 33 (late career).
    // age 33: 0.925 - (33-32)*0.035 = 0.890 → 0.890 * 90 = 80.1 → 80
    const players = [mkPlayer({ rating: 79, peakRating: 90, peakAge: 27, age: 32 })];
    const squads = { A: players };
    applyAnnualRevaluation(squads, emptyStats(), new Set(), null);

    expect(players[0].age).toBe(33);
    expect(players[0].rating).toBe(80);
  });

  it('does not touch rating when peakRating / peakAge are missing (legacy path)', () => {
    // Half-migrated player — should still age but rating stays as-is.
    const legacy: Player = {
      uuid: 'p-l', teamId: 'A', name: 'L', number: 1, position: 'GK',
      rating: 70, goalScoring: 1, marketValue: 5, age: 27,
      peakRating: undefined as unknown as number,
      peakAge: undefined as unknown as number,
    };
    const squads = { A: [legacy] };
    applyAnnualRevaluation(squads, emptyStats(), new Set(), null);

    expect(legacy.age).toBe(28);
    expect(legacy.rating).toBe(70); // unchanged
  });

  it('lifts a promoted squad above an identical non-promoted one', () => {
    const promoted = mkPlayer({ marketValue: 30, peakRating: 75, peakAge: 27, age: 25 });
    const control = mkPlayer({ marketValue: 30, peakRating: 75, peakAge: 27, age: 25 });
    applyAnnualRevaluation({ A: [promoted] }, emptyStats(), new Set(['A']), null);
    applyAnnualRevaluation({ A: [control] }, emptyStats(), new Set(), null);

    // Promotion is still worth 1.30× — but now on a freshly-computed anchor
    // rather than on whatever the value happened to have compounded to.
    // Both aged 25 → 26 and were re-rated to peakRating 75 by the curve, so
    // the anchor is tierBase(75) × 1.2 × resale(26) = 16.5 × 1.2 = 19.8.
    expect(promoted.marketValue).toBeGreaterThan(control.marketValue);
    // Inertia: neither snaps onto its target, both ease down from 30.
    expect(promoted.marketValue).toBeLessThan(30);
    expect(control.marketValue).toBeLessThan(30);
    expect(control.marketValue).toBeGreaterThan(19.8);
  });
});

describe('present-value re-anchoring — the compounding fix', () => {
  function hotStats(uuid: string): Record<string, PlayerSeasonStats> {
    return { [uuid]: { goals: 30, assists: 20, appearances: 38 } as unknown as PlayerSeasonStats };
  }

  it('stops paying for potential at POTENTIAL_PRICED_UNTIL_AGE', () => {
    const prospect = mkPlayer({ rating: 70, peakRating: 95, peakAge: 27, age: 19 });
    const veteran = mkPlayer({ rating: 70, peakRating: 95, peakAge: 27, age: 30 });
    // The teenager is still partly priced on his ceiling...
    expect(pricingRating(prospect)).toBeGreaterThan(70);
    // ...the 30-year-old is priced on nothing but present ability, no matter
    // that he was once destined for 95.
    expect(pricingRating(veteran)).toBe(70);
    expect(pricingRating(mkPlayer({ rating: 70, peakRating: 95, age: POTENTIAL_PRICED_UNTIL_AGE }))).toBe(70);
  });

  it('prices a 34-year-old below a 27-year-old of the same current rating', () => {
    const veteran = mkPlayer({ rating: 75, peakRating: 75, peakAge: 27, age: 34 });
    const inPeak = mkPlayer({ rating: 75, peakRating: 75, peakAge: 27, age: 27 });
    expect(computePresentMarketValue(veteran)).toBeLessThan(computePresentMarketValue(inPeak));
  });

  it('value never rises with age at a fixed rating (the audit inversion)', () => {
    // The 50-season audit found the opposite in every rating band: 75-79 rated
    // players were worth €23M at 26-29 and €47M at 33-35. Lock the direction.
    const ages = [20, 24, 28, 31, 34, 37];
    const values = ages.map(age =>
      computePresentMarketValue(mkPlayer({ rating: 75, peakRating: 75, peakAge: 27, age })),
    );
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
    }
  });

  it('repeated great seasons converge instead of compounding to the cap', () => {
    const p = mkPlayer({ uuid: 'p-1', rating: 80, peakRating: 80, peakAge: 27, age: 26, marketValue: 20 });
    const squads = { A: [p] };
    const values: number[] = [];
    for (let i = 0; i < 8; i++) {
      applyAnnualRevaluation(squads, hotStats('p-1'), new Set(), null);
      values.push(p.marketValue);
    }
    // Old model: 20 × 1.40^8 ≈ 295, clipped to the €150M cap. New model: the
    // value settles near anchor × 1.40 and then follows the aging curve down.
    expect(Math.max(...values)).toBeLessThan(60);
    expect(p.marketValue).toBeLessThan(150);
  });

  it('an aged-out star is worth a fraction of his peak, not a fortune', () => {
    // The exact shape that produced €300M fire sales for 67-77 rated veterans.
    const oldStar = mkPlayer({ rating: 73, peakRating: 99, peakAge: 27, age: 32 });
    const value = computePresentMarketValue(oldStar);
    expect(value).toBeLessThan(30);
    expect(value * 2).toBeLessThan(60); // even at the 200% fire-sale premium
  });
});

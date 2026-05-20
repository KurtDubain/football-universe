import { describe, it, expect } from 'vitest';
import { computeInitialMarketValue, applyAnnualRevaluation } from './market-value';
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

  it('preserves the rest of the marketValue logic (promotion bonus etc.)', () => {
    const p = mkPlayer({ marketValue: 30, peakRating: 75, peakAge: 27, age: 25 });
    const squads = { A: [p] };
    applyAnnualRevaluation(squads, emptyStats(), new Set(['A']), null);

    // age 25 → 26, both inside plateau. MarketValue should have got the 1.30× bump.
    // Within bounds: 30 * 1.30 ≈ 39 (and age multiplier same: 1.05/1.05 = 1).
    expect(p.marketValue).toBeGreaterThan(35);
    expect(p.marketValue).toBeLessThan(45);
  });
});

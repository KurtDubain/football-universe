import { describe, it, expect } from 'vitest';
import {
  ballonDorTeamFactor,
  domesticCupMultiplier,
  goldenBootScore,
  placementOf,
  positionAwardScore,
  positionAwardTeamFactor,
  sampleGateMultiplier,
  tierNeutralScore,
} from './award-scoring';
import { BALLON_DOR_TEAM, POSITION_AWARD_TEAM, TIER_COEFFICIENT } from './award-weights';

describe('tierNeutralScore', () => {
  it('is an exact inversion of the 10% league-strength term', () => {
    // seasonScore = adjustedPQ x 0.70 + availability x 0.20 + leagueStrength x 0.10
    // Removing the tier term means substituting leagueStrength = 100.
    const tier3 = { score: 72, leagueStrength: 90 };
    expect(tierNeutralScore(tier3)).toBeCloseTo(73, 6);
  });

  it('leaves a top-flight score untouched', () => {
    expect(tierNeutralScore({ score: 72, leagueStrength: 100 })).toBeCloseTo(72, 6);
  });

  it('removes the gap between identical seasons played in different tiers', () => {
    // The same performance scores 1.0 lower in tier 3 purely from the 10% term.
    const top = tierNeutralScore({ score: 80, leagueStrength: 100 });
    const third = tierNeutralScore({ score: 79, leagueStrength: 90 });
    expect(top).toBeCloseTo(third, 6);
  });

  it('stays inside the 0-100 range', () => {
    expect(tierNeutralScore({ score: 100, leagueStrength: 90 })).toBe(100);
  });
});

describe('sampleGateMultiplier', () => {
  it('has no penalty at or above the full-sample threshold', () => {
    expect(sampleGateMultiplier(1800)).toBe(1);
    expect(sampleGateMultiplier(3000)).toBe(1);
  });

  it('applies a mild penalty for a partial season', () => {
    expect(sampleGateMultiplier(1500)).toBeCloseTo(0.95, 6);
  });

  it('applies a heavier penalty for a thin sample', () => {
    expect(sampleGateMultiplier(600)).toBeCloseTo(0.85, 6);
  });
});

describe('team factors', () => {
  const midTable = placementOf(8, 16, 1);

  it('gives the Ballon d\'Or a wide spread', () => {
    expect(ballonDorTeamFactor(placementOf(1, 16, 1))).toBe(BALLON_DOR_TEAM.champion);
    expect(ballonDorTeamFactor(placementOf(3, 16, 1))).toBe(BALLON_DOR_TEAM.topFour);
    expect(ballonDorTeamFactor(midTable)).toBe(BALLON_DOR_TEAM.midTable);
    expect(ballonDorTeamFactor(placementOf(14, 16, 1))).toBe(BALLON_DOR_TEAM.bottomFour);
  });

  it('keeps the position-award spread shallow', () => {
    expect(positionAwardTeamFactor(placementOf(1, 16, 1))).toBe(POSITION_AWARD_TEAM.champion);
    expect(positionAwardTeamFactor(placementOf(3, 16, 1))).toBe(POSITION_AWARD_TEAM.topFour);
    expect(positionAwardTeamFactor(midTable)).toBe(POSITION_AWARD_TEAM.midTable);
    expect(positionAwardTeamFactor(placementOf(14, 16, 1))).toBe(POSITION_AWARD_TEAM.bottomFour);
  });

  it('never stacks a relegation penalty on a team outside the top flight', () => {
    // position 0 means "not in the top flight": only the tier term applies.
    const outside = placementOf(0, 0, 2);
    expect(ballonDorTeamFactor(outside)).toBe(BALLON_DOR_TEAM.midTable);
    expect(positionAwardTeamFactor(outside)).toBe(POSITION_AWARD_TEAM.midTable);
  });

  it('makes the position factor strictly weaker than the Ballon d\'Or factor', () => {
    const champion = placementOf(1, 16, 1);
    const relegation = placementOf(15, 16, 1);
    const ballonSpread = ballonDorTeamFactor(champion) - ballonDorTeamFactor(relegation);
    const positionSpread = positionAwardTeamFactor(champion) - positionAwardTeamFactor(relegation);
    expect(positionSpread).toBeLessThan(ballonSpread);
    expect(positionSpread).toBeGreaterThan(0);
  });
});

describe('domesticCupMultiplier', () => {
  it('is neutral with no trophies', () => {
    expect(domesticCupMultiplier(0)).toBe(1);
  });

  it('credits a single domestic cup', () => {
    expect(domesticCupMultiplier(1)).toBeCloseTo(1.05, 6);
  });

  it('caps a double below a continental cup', () => {
    expect(domesticCupMultiplier(2)).toBeCloseTo(BALLON_DOR_TEAM.domesticCupCap, 6);
    expect(domesticCupMultiplier(2)).toBeLessThan(BALLON_DOR_TEAM.continentalCup);
  });

  it('never exceeds the cap for absurd counts', () => {
    expect(domesticCupMultiplier(9)).toBe(BALLON_DOR_TEAM.domesticCupCap);
  });
});

describe('goldenBootScore', () => {
  it('weights goals by tier coefficient', () => {
    expect(goldenBootScore(20, 1)).toBeCloseTo(20, 6);
    expect(goldenBootScore(20, 2)).toBeCloseTo(18, 6);
    expect(goldenBootScore(20, 3)).toBeCloseTo(16, 6);
  });

  it('lets a prolific lower-tier season outscore a top-flight one', () => {
    expect(goldenBootScore(24, 2)).toBeGreaterThan(goldenBootScore(20, 1));
  });

  it('still favours the top flight at similar counts', () => {
    expect(goldenBootScore(22, 2)).toBeLessThan(goldenBootScore(20, 1));
  });

  it('uses the shared tier table', () => {
    expect(goldenBootScore(10, 3)).toBeCloseTo(10 * TIER_COEFFICIENT[3], 6);
  });
});

describe('positionAwardScore', () => {
  const full = { positionQuality: 80, availabilityScore: 100 };

  it('leaves a fully available top-flight mid-table season untouched', () => {
    expect(positionAwardScore(full, placementOf(8, 16, 1), 2700)).toBeCloseTo(80, 6);
  });

  it('applies tier, team and sample weighting exactly once each', () => {
    const score = positionAwardScore(full, placementOf(1, 16, 2), 1500);
    expect(score).toBeCloseTo(
      80 * TIER_COEFFICIENT[2] * POSITION_AWARD_TEAM.champion * 0.95,
      6,
    );
  });

  it('discounts a barely-available player without erasing their output', () => {
    const absent = positionAwardScore(
      { positionQuality: 80, availabilityScore: 0 },
      placementOf(8, 16, 1),
      2700,
    );
    expect(absent).toBeCloseTo(80 * 0.85, 6);
    expect(absent).toBeGreaterThan(80 * 0.8);
  });

  it('cannot be won on team success alone', () => {
    // A champion's defender with clearly worse output still loses.
    const champion = positionAwardScore(
      { positionQuality: 70, availabilityScore: 100 },
      placementOf(1, 16, 1),
      2700,
    );
    const midTable = positionAwardScore(
      { positionQuality: 80, availabilityScore: 100 },
      placementOf(8, 16, 1),
      2700,
    );
    expect(midTable).toBeGreaterThan(champion);
  });
});

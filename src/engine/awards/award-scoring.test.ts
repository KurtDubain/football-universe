import { describe, it, expect } from 'vitest';
import {
  ballonDorTeamFactor,
  describeGoldenBoot,
  domesticCupMultiplier,
  goldenBootBreakdown,
  goldenBootScore,
  placementOf,
  positionAwardScore,
  positionAwardTeamFactor,
  sampleGateMultiplier,
  tierNeutralScore,
} from './award-scoring';
import {
  BALLON_DOR_TEAM,
  GOLDEN_BOOT_TIER_COEFFICIENT,
  POSITION_AWARD_TEAM,
  TIER_COEFFICIENT,
} from './award-weights';

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
  const REFERENCE_ROUNDS = 30;
  const LOWER_ROUNDS = 14;

  it('leaves a top-flight season untouched', () => {
    expect(goldenBootScore(30, 1)).toBeCloseTo(30, 6);
  });

  it('converts a shorter schedule to the 30-round basis before weighting', () => {
    const breakdown = goldenBootBreakdown(14, 2);
    expect(breakdown.scheduleAdjusted).toBeCloseTo(14 * (REFERENCE_ROUNDS / LOWER_ROUNDS), 6);
    expect(breakdown.score).toBeCloseTo(
      breakdown.scheduleAdjusted * GOLDEN_BOOT_TIER_COEFFICIENT[2],
      6,
    );
  });

  it('gives schedule length no weight of its own', () => {
    // The same scoring rate in two leagues must differ by exactly the
    // coefficient — never by the raw goal difference, which is what the
    // pre-normalisation formula measured.
    expect(goldenBootScore(30, 1)).toBeCloseTo(30, 6);
    expect(goldenBootScore(14, 2)).toBeCloseTo(30 * GOLDEN_BOOT_TIER_COEFFICIENT[2], 6);
  });

  it('lets a genuinely more prolific lower-tier season win', () => {
    // 24 in 14 rounds is 1.71 per round against 0.67 for 20 in 30.
    expect(goldenBootScore(24, 2)).toBeGreaterThan(goldenBootScore(20, 1));
  });

  it('still favours the stronger league at an equal scoring rate', () => {
    expect(goldenBootScore(14, 2)).toBeLessThan(goldenBootScore(30, 1));
    expect(goldenBootScore(14, 3)).toBeLessThan(goldenBootScore(14, 2));
  });

  it('keeps the coefficient below the tier-blind value', () => {
    // A 90-season audit measured 0.90 / 0.80 as tier-blind: at that setting the
    // lower tiers won 52% of Golden Boots, matching their share of clubs. A
    // coefficient at or above it would stop expressing any preference for the
    // stronger league, so this guards the finding rather than the number.
    expect(GOLDEN_BOOT_TIER_COEFFICIENT[2]).toBeLessThan(0.9);
    expect(GOLDEN_BOOT_TIER_COEFFICIENT[3]).toBeLessThan(GOLDEN_BOOT_TIER_COEFFICIENT[2]);
    expect(GOLDEN_BOOT_TIER_COEFFICIENT[1]).toBe(1);
  });

  it('exposes a reconstructable breakdown', () => {
    const breakdown = goldenBootBreakdown(20, 3);
    expect(breakdown.goals).toBe(20);
    expect(breakdown.rounds).toBe(LOWER_ROUNDS);
    expect(breakdown.referenceRounds).toBe(REFERENCE_ROUNDS);
    expect(breakdown.score).toBeCloseTo(
      breakdown.scheduleAdjusted * breakdown.coefficient,
      6,
    );
    expect(breakdown.isTopFlightBasis).toBe(false);
  });

  it('marks a top-flight season as needing no adjustment', () => {
    expect(goldenBootBreakdown(25, 1).isTopFlightBasis).toBe(true);
  });
});

describe('describeGoldenBoot', () => {
  it('stays short when no adjustment applies', () => {
    expect(describeGoldenBoot(goldenBootBreakdown(25, 1))).toBe('25球');
  });

  it('prints the whole derivation when one does', () => {
    const breakdown = goldenBootBreakdown(20, 2);
    const label = describeGoldenBoot(breakdown);
    expect(label).toContain('20球/14轮');
    expect(label).toContain('折算42.9球');
    expect(label).toContain('0.75');
    // The printed result must be the value the award actually ranked on.
    expect(label).toContain(breakdown.score.toFixed(1));
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

import { describe, it, expect } from 'vitest';
import {
  ballonDorTeamFactor,
  describeGoldenBoot,
  describeLeagueTopScorer,
  domesticCupMultiplier,
  goldenBootBreakdown,
  goldenBootScore,
  leagueTopScorerBreakdown,
  leagueTopScorerScore,
  placementOf,
  positionAwardScore,
  positionAwardTeamFactor,
  sampleGateMultiplier,
  tierNeutralScore,
} from './award-scoring';
import {
  BALLON_DOR_TEAM,
  POSITION_AWARD_TEAM,
  SCORING_TIER_COEFFICIENT,
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

describe('leagueTopScorerScore (射手王)', () => {
  const REFERENCE_ROUNDS = 30;
  const LOWER_ROUNDS = 14;

  it('leaves a top-flight season untouched', () => {
    expect(leagueTopScorerScore(30, 1)).toBeCloseTo(30, 6);
  });

  it('converts a shorter schedule to the 30-round basis before weighting', () => {
    const breakdown = leagueTopScorerBreakdown(14, 2);
    expect(breakdown.scheduleAdjusted).toBeCloseTo(14 * (REFERENCE_ROUNDS / LOWER_ROUNDS), 6);
    expect(breakdown.score).toBeCloseTo(
      breakdown.scheduleAdjusted * SCORING_TIER_COEFFICIENT[2],
      6,
    );
  });

  it('gives schedule length no weight of its own', () => {
    // The same scoring rate in two leagues must differ by exactly the
    // coefficient — never by the raw goal difference, which is what a plain
    // goal count would have measured.
    expect(leagueTopScorerScore(30, 1)).toBeCloseTo(30, 6);
    expect(leagueTopScorerScore(14, 2)).toBeCloseTo(30 * SCORING_TIER_COEFFICIENT[2], 6);
  });

  it('lets a genuinely more prolific lower-tier season win', () => {
    // 24 in 14 rounds is 1.71 per round against 0.67 for 20 in 30.
    expect(leagueTopScorerScore(24, 2)).toBeGreaterThan(leagueTopScorerScore(20, 1));
  });

  it('still favours the stronger league at an equal scoring rate', () => {
    expect(leagueTopScorerScore(14, 2)).toBeLessThan(leagueTopScorerScore(30, 1));
    expect(leagueTopScorerScore(14, 3)).toBeLessThan(leagueTopScorerScore(14, 2));
  });

  it('keeps the coefficient below the tier-blind value', () => {
    // A 90-season audit measured 0.90 / 0.80 as tier-blind on this basis: the
    // lower tiers won their proportional share. A coefficient at or above it
    // would stop expressing any preference for the stronger league, so this
    // guards the finding rather than the number.
    expect(SCORING_TIER_COEFFICIENT[2]).toBeLessThan(0.9);
    expect(SCORING_TIER_COEFFICIENT[3]).toBeLessThan(SCORING_TIER_COEFFICIENT[2]);
    expect(SCORING_TIER_COEFFICIENT[1]).toBe(1);
  });

  it('exposes a reconstructable breakdown', () => {
    const breakdown = leagueTopScorerBreakdown(20, 3);
    expect(breakdown.leagueGoals).toBe(20);
    expect(breakdown.rounds).toBe(LOWER_ROUNDS);
    expect(breakdown.referenceRounds).toBe(REFERENCE_ROUNDS);
    expect(breakdown.score).toBeCloseTo(breakdown.scheduleAdjusted * breakdown.coefficient, 6);
    expect(breakdown.isTopFlightBasis).toBe(false);
  });

  it('marks a top-flight season as needing no adjustment', () => {
    expect(leagueTopScorerBreakdown(25, 1).isTopFlightBasis).toBe(true);
  });
});

describe('describeLeagueTopScorer', () => {
  it('stays short when no adjustment applies', () => {
    expect(describeLeagueTopScorer(leagueTopScorerBreakdown(25, 1))).toBe('联赛 25球');
  });

  it('prints the whole derivation when one does', () => {
    const breakdown = leagueTopScorerBreakdown(20, 2);
    const label = describeLeagueTopScorer(breakdown);
    expect(label).toContain('联赛 20球/14轮');
    expect(label).toContain('折算42.9球');
    expect(label).toContain('0.75');
    // The printed result must be the value the honour actually ranked on.
    expect(label).toContain(breakdown.score.toFixed(1));
  });
});

describe('goldenBootScore (金靴奖)', () => {
  it('ranks all-competitions goals with no schedule adjustment', () => {
    // A cup run is earned rather than structural, so the Golden Boot does not
    // normalise for schedule. That is precisely why it is a separate honour
    // from the league top scorer: its numerator counts matches the league-round
    // denominator knows nothing about.
    expect(goldenBootScore(34, 1)).toBeCloseTo(34, 6);
    expect(goldenBootScore(20, 2)).toBeCloseTo(20 * SCORING_TIER_COEFFICIENT[2], 6);
  });

  it('never picks up a schedule factor', () => {
    // Identical totals in two tiers differ by exactly the coefficient. If this
    // ever gains a schedule term, the two honours have collapsed into one and
    // the numerator/denominator mismatch is back.
    expect(goldenBootScore(20, 2) / goldenBootScore(20, 1))
      .toBeCloseTo(SCORING_TIER_COEFFICIENT[2], 6);
  });

  it('exposes a reconstructable breakdown', () => {
    const breakdown = goldenBootBreakdown(20, 3);
    expect(breakdown.goals).toBe(20);
    expect(breakdown.score).toBeCloseTo(breakdown.goals * breakdown.coefficient, 6);
    expect(breakdown.isFullWeight).toBe(false);
    expect(goldenBootBreakdown(20, 1).isFullWeight).toBe(true);
  });
});

describe('describeGoldenBoot', () => {
  it('always says 全赛事, because the total spans every competition', () => {
    expect(describeGoldenBoot(goldenBootBreakdown(34, 1))).toBe('全赛事 34球');
  });

  it('prints the coefficient when one applies', () => {
    const breakdown = goldenBootBreakdown(20, 2);
    const label = describeGoldenBoot(breakdown);
    expect(label).toContain('全赛事 20球');
    expect(label).toContain('0.75');
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

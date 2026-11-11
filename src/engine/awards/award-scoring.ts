import type { PlayerPerformanceResult } from '../players/player-performance';
import { leagueConfigs } from '../../config/competitions';
import {
  BALLON_DOR_TEAM,
  BOTTOM_PLACES,
  FULL_SAMPLE_MINUTES,
  GOLDEN_BOOT_SCHEDULE_EXPONENT,
  GOLDEN_BOOT_TIER_COEFFICIENT,
  PARTIAL_SAMPLE_MINUTES,
  PARTIAL_SAMPLE_MULTIPLIER,
  POSITION_AWARD_AVAILABILITY_FLOOR,
  POSITION_AWARD_TEAM,
  THIN_SAMPLE_MULTIPLIER,
  TIER_COEFFICIENT,
  TOP_FOUR_CUTOFF,
  type LeagueTier,
} from './award-weights';

/**
 * Scoring primitives shared by every award.
 *
 * The rule this file exists to enforce: **each award applies its own explicit
 * tier and team weighting exactly once.** Before the redesign `seasonScore`
 * carried a 10% league-strength term while the Ballon d'Or also multiplied by
 * a tier factor (double discount), and the Golden Boot applied neither.
 */

/**
 * `seasonScore` folds league strength in at 10% weight. Award formulas apply
 * their own tier coefficient, so they must first remove that term.
 *
 * This is an exact inversion — it substitutes leagueStrength = 100 rather than
 * approximating — which means `seasonScore` itself is untouched and archived
 * `performanceSnapshot` values stay valid.
 */
export function tierNeutralScore(
  performance: Pick<PlayerPerformanceResult, 'score' | 'leagueStrength'>,
): number {
  const neutral = performance.score + (100 - performance.leagueStrength) * 0.10;
  return clamp(neutral, 0, 100);
}

export function sampleGateMultiplier(minutes: number): number {
  if (minutes >= FULL_SAMPLE_MINUTES) return 1.0;
  if (minutes >= PARTIAL_SAMPLE_MINUTES) return PARTIAL_SAMPLE_MULTIPLIER;
  return THIN_SAMPLE_MULTIPLIER;
}

export interface TeamPlacement {
  /** Final (or current) top-flight position, 1-indexed; 0 when not in it. */
  leaguePosition: number;
  /** Teams in the top flight; 0 when the team is not in it. */
  leagueSize: number;
  leagueLevel: LeagueTier;
}

export function placementOf(
  leaguePosition: number,
  leagueSize: number,
  leagueLevel: LeagueTier,
): TeamPlacement {
  return { leaguePosition, leagueSize, leagueLevel };
}

function isBottomFour(placement: TeamPlacement): boolean {
  return placement.leagueSize > 0
    && placement.leaguePosition > placement.leagueSize - BOTTOM_PLACES;
}

function isTopFour(placement: TeamPlacement): boolean {
  return placement.leaguePosition > 0 && placement.leaguePosition <= TOP_FOUR_CUTOFF;
}

/**
 * Team factor for the Ballon d'Or. A lower-tier team is described by
 * `leagueLevel` only — never by a fabricated table position, which would stack
 * the relegation penalty on top of the tier discount.
 */
export function ballonDorTeamFactor(placement: TeamPlacement): number {
  if (placement.leaguePosition === 1) return BALLON_DOR_TEAM.champion;
  if (isTopFour(placement)) return BALLON_DOR_TEAM.topFour;
  if (isBottomFour(placement)) return BALLON_DOR_TEAM.bottomFour;
  return BALLON_DOR_TEAM.midTable;
}

/** Deliberately shallow: a position award must not be won on team success. */
export function positionAwardTeamFactor(placement: TeamPlacement): number {
  if (placement.leaguePosition === 1) return POSITION_AWARD_TEAM.champion;
  if (isTopFour(placement)) return POSITION_AWARD_TEAM.topFour;
  if (isBottomFour(placement)) return POSITION_AWARD_TEAM.bottomFour;
  return POSITION_AWARD_TEAM.midTable;
}

/**
 * Domestic cups (league cup, super cup) contribute per trophy up to a cap, so a
 * domestic double never outranks a continental cup.
 */
export function domesticCupMultiplier(count: number): number {
  if (count <= 0) return 1.0;
  return Math.min(
    BALLON_DOR_TEAM.domesticCup ** count,
    BALLON_DOR_TEAM.domesticCupCap,
  );
}

/**
 * Position awards score from `positionQuality` (pure positional output, tier
 * neutral) rather than `seasonScore`, then apply availability, tier, team and
 * sample weighting exactly once each.
 */
export function positionAwardScore(
  performance: Pick<PlayerPerformanceResult, 'positionQuality' | 'availabilityScore'>,
  placement: TeamPlacement,
  minutes: number,
): number {
  const availabilityFactor = POSITION_AWARD_AVAILABILITY_FLOOR
    + (1 - POSITION_AWARD_AVAILABILITY_FLOOR) * (performance.availabilityScore / 100);
  return performance.positionQuality
    * availabilityFactor
    * TIER_COEFFICIENT[placement.leagueLevel]
    * positionAwardTeamFactor(placement)
    * sampleGateMultiplier(minutes);
}

/** Rounds a tier actually plays, read from config so a schedule change follows through. */
export function roundsForTier(leagueLevel: LeagueTier): number {
  return leagueConfigs.find(config => config.level === leagueLevel)?.rounds ?? 30;
}

/**
 * Full arithmetic behind a Golden Boot score.
 *
 * Exposed so the award label and the buzz card can print the whole derivation
 * rather than a bare weighted number. An award the player cannot reconstruct
 * from the displayed numbers is an award they cannot trust — and this one now
 * involves a schedule conversion, so showing the working matters more than
 * before, not less.
 */
export interface GoldenBootBreakdown {
  goals: number;
  /** Rounds the player's league plays. */
  rounds: number;
  /** The 30-round basis every league is converted to. */
  referenceRounds: number;
  /** goals converted to the reference schedule. */
  scheduleAdjusted: number;
  coefficient: number;
  /** Final ranking value. */
  score: number;
  /** True when no adjustment applies, so copy can stay short. */
  isTopFlightBasis: boolean;
}

export function goldenBootBreakdown(goals: number, leagueLevel: LeagueTier): GoldenBootBreakdown {
  const rounds = roundsForTier(leagueLevel);
  const referenceRounds = roundsForTier(1);
  const scheduleAdjusted = goals * (referenceRounds / rounds) ** GOLDEN_BOOT_SCHEDULE_EXPONENT;
  const coefficient = GOLDEN_BOOT_TIER_COEFFICIENT[leagueLevel];
  return {
    goals,
    rounds,
    referenceRounds,
    scheduleAdjusted,
    coefficient,
    score: scheduleAdjusted * coefficient,
    isTopFlightBasis: rounds === referenceRounds && coefficient === 1,
  };
}

/**
 * Golden Boot ranking value: goals converted to a common schedule, then
 * weighted by what a goal in that league is worth.
 *
 * The two factors answer different questions and must not be collapsed:
 * schedule length is a structural artefact carrying no quality signal, while
 * the coefficient is the actual judgement about opposition strength. See
 * GOLDEN_BOOT_SCHEDULE_EXPONENT and GOLDEN_BOOT_TIER_COEFFICIENT.
 */
export function goldenBootScore(goals: number, leagueLevel: LeagueTier): number {
  return goldenBootBreakdown(goals, leagueLevel).score;
}

/** Tier label used in award copy so a weighted result reads honestly. */
export const TIER_LABELS: Record<LeagueTier, string> = {
  1: '顶级',
  2: '甲级',
  3: '乙级',
};

/**
 * Copy for a Golden Boot result, showing the derivation whenever an adjustment
 * applies. Top-flight winners need no arithmetic — their goals already sit on
 * the reference schedule at full weight.
 */
export function describeGoldenBoot(breakdown: GoldenBootBreakdown): string {
  if (breakdown.isTopFlightBasis) return `${breakdown.goals}球`;
  return `${breakdown.goals}球/${breakdown.rounds}轮 → 折算`
    + `${breakdown.scheduleAdjusted.toFixed(1)}球 × ${breakdown.coefficient.toFixed(2)}`
    + ` = ${breakdown.score.toFixed(1)}`;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

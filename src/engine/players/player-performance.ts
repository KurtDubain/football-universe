import type { PlayerPosition, PlayerSeasonStats, PlayerTeamSeasonStats } from '../../types/player';
import { PLAYER_STAT_COUNTER_FIELDS } from './player-stat-fields';

/**
 * Minutes at which the soft confidence factor reaches 0.5.
 *
 * Lowered from 900 in score version 5. The old value meant a forward who
 * played 4,030 minutes — a full season — was still scored at 0.82 confidence
 * while a midfielder on 6,480 minutes reached 0.88, and that 0.06 gap is
 * applied to the whole distance from 50. Measured over 120 seasons it cost
 * forwards 8 points of the top-ten share on its own, before availability was
 * counted at all. Small samples still shrink: 180 minutes reads 0.23.
 */
export const PLAYER_CONFIDENCE_MINUTES = 600;
/**
 * Upper bound for position quality and season score.
 *
 * Deliberately above 100. Capping at 100 made the strongest seasons tie: 74
 * player-seasons reached exactly 100 under the v2 scale, 39 of them on fewer
 * than 20 appearances, and once several candidates tie the award falls through
 * to a uuid comparison — which is a coin flip dressed up as a ranking.
 */
export const PLAYER_SCORE_CEILING = 120;
/** Kept as a compatibility export; ranking no longer has a hard minute gate. */
export const PLAYER_RANKING_MINUTES = 0;
/**
 * Bumped whenever the cross-position calibration below changes, so archived
 * seasons keep a readable marker of the scale they were scored on.
 *
 * v2: defender scale narrowed 1.85 -> 1.60. The old value made defenders the
 * highest-variance position (P10 lowest, P90 level with everyone else) and
 * handed 40% of Ballon d'Or wins to centre-backs. See
 * docs/score-params-simulation-report.md for the 50-season comparison.
 *
 * v3: every anchor and every calibration constant resampled from a completed
 * 54-season world (seed 698104882, 11,255 top-flight season rows at 20+
 * appearances). The v2 anchors were sampled from an older simulator whose
 * scoring rates no longer hold: measured against live data the forward goal
 * anchor was 28% low, the goalkeeper routine-save anchor 22% low, and three
 * sparse anchors (defender blocks, midfielder extra passes, midfielder extra
 * chances) had a real median of ZERO while the anchor claimed 0.033-0.039 —
 * so more than half of all players scored a flat 40 on those terms.
 *
 * The v3 calibration puts every position's median on 50 and its P99 on 93,
 * which is what makes the four scales comparable at all. Goalkeeper P99 moves
 * 81.0 -> 93.0; under v2 no keeper could reach 90 in 54 seasons.
 *
 * v4: v3 sampled its anchors from the top flight only but applied them to all
 * three tiers, and the lower divisions generate far fewer shots. The median
 * second- and third-tier goalkeeper fell to 16.2 and 14.9 out of 120, because
 * the two terms carrying 55% of the goalkeeper weight were both far below their
 * p10; `scripts/audit-player-performance.ts` went from passing to failing on
 * cross-position median spread (0.9 -> 9.4). v4 makes anchors and calibration
 * per tier — 54 anchor groups instead of 18 — and resamples all of them from 288
 * completed seasons at 900+ minutes. Every one of the twelve position/tier
 * groups now has its median on 50 and its P99 on 93.
 *
 * v5: the two minute-driven terms are both cut back. Availability moves from
 * 0.20 to 0.15 and from a 0.60/0.40 minute/appearance split to 0.25/0.75, and
 * the confidence constant drops 900 -> 600. The simulator substitutes 54.7%
 * of starting forwards against 8-10% of defenders and midfielders, so a
 * season score that leaned on minutes was quietly a position tax: across 120
 * seasons not one forward finished top of the league, and the forward share
 * of the Ballon d'Or had fallen to 3%. Under v5 the forward share of the
 * season-score top ten goes 5% -> 11%, and the cross-position median spread
 * tightens from 2.2 to 0.5.
 */
export const PLAYER_SCORE_VERSION = 5;

export type PlayerScoreConfidence = 'none' | 'low' | 'medium' | 'high';

export interface PlayerPerformanceMetrics {
  minutes: number;
  appearances: number;
  starts: number;
  teamMatchesAllCompetitions: number;
  missedMatches: number;
  injuryAbsenceMatches: number;
  minuteAttendanceRate: number;
  appearanceRate: number;
  goalsPer90: number;
  assistsPer90: number;
  extraBigChancesPer90: number;
  extraKeyPassesPer90: number;
  attackContributionPer90: number;
  routineSavesPer90: number;
  keySavesPer90: number;
  savePercentage: number;
  cleanSheetContribution: number;
  goalsConcededPer90: number;
  interceptionsPer90: number;
  clearancesPer90: number;
  goalLineBlocksPer90: number;
}

export interface PlayerPerformanceResult {
  /** Cross-position, attendance-aware season score. */
  score: number;
  seasonScore: number;
  /** Position-specific output before sample and attendance adjustment. */
  positionQuality: number;
  adjustedPositionQuality: number;
  availabilityScore: number;
  leagueStrength: number;
  confidence: number;
  confidenceLabel: PlayerScoreConfidence;
  scoreVersion: number;
  grade: string;
  /** Any player with actual minutes is rankable; confidence remains visible. */
  eligible: boolean;
  metrics: PlayerPerformanceMetrics;
}

interface MetricAnchors {
  p10: number;
  p50: number;
  p90: number;
}

// Anchors sampled from 288 completed seasons across 24 independent seeds
// (20260808 + n*104729), taking every season row with 900+ minutes — the point
// where the confidence factor below reaches 0.5. They are never rebuilt from
// the live universe, so the same performance keeps the same score across saves.
//
// Anchors are per league tier. The simulator generates far fewer shots in the
// lower divisions and a keeper's rate metrics collapse with them: a top-flight
// keeper makes 3.76 routine saves per 90 and stops 76.8% of what he faces, a
// third-tier keeper makes 1.50 and stops 54.7%. Scoring every tier against
// top-flight anchors pinned the median lower-division keeper to 15 out of 120,
// because the two terms carrying 55% of the goalkeeper weight were both far
// below their p10. Per-tier anchors make positionQuality mean "how good,
// against the players you actually face"; which tier that was is carried by
// `leagueStrength` in the season score.
//
// Sparse terms (zero in more than 5% of rows, scored through `sparseMetric`)
// take their P10/P50 from the NON-ZERO rows only. Sampling those from the full
// population would put the anchor at zero and make `sparseMetric` jump from its
// flat 40 baseline straight to the 50-90 band on the first non-zero event; the
// non-zero basis holds that step to about 3 points.
type LeagueTier = 1 | 2 | 3;

interface PositionAnchorSet {
  [group: string]: MetricAnchors;
}

const ANCHORS: Record<PlayerPosition, Record<LeagueTier, PositionAnchorSet>> = {
  GK: {
    1: {
      savePercentage: { p10: 0.6571, p50: 0.7682, p90: 0.8495 },
      keySaves: { p10: 0.0288, p50: 0.0882, p90: 0.1786 },
      goalsConceded: { p10: 0.7241, p50: 1.1628, p90: 1.8387 },
      routineSaves: { p10: 3.3113, p50: 3.7568, p90: 4.1667 },
      cleanSheets: { p10: 0.1667, p50: 0.3514, p90: 0.5338 },
    },
    2: {
      savePercentage: { p10: 0.5517, p50: 0.6556, p90: 0.7544 },
      keySaves: { p10: 0.0435, p50: 0.0667, p90: 0.15 },
      goalsConceded: { p10: 0.913, p50: 1.3973, p90: 1.92 },
      routineSaves: { p10: 2.1333, p50: 2.5714, p90: 3 },
      cleanSheets: { p10: 0.1304, p50: 0.2727, p90: 0.4655 },
    },
    3: {
      savePercentage: { p10: 0.4167, p50: 0.5469, p90: 0.6757 },
      keySaves: { p10: 0.0526, p50: 0.0667, p90: 0.1429 },
      goalsConceded: { p10: 0.8333, p50: 1.2778, p90: 1.8 },
      routineSaves: { p10: 1.1333, p50: 1.5, p90: 1.8824 },
      cleanSheets: { p10: 0.1429, p50: 0.3125, p90: 0.4828 },
    },
  },
  DF: {
    1: {
      interceptions: { p10: 1.705, p50: 2.0998, p90: 2.4862 },
      clearances: { p10: 2.525, p50: 3.0653, p90: 3.5612 },
      blocks: { p10: 0.0234, p50: 0.0295, p90: 0.0667 },
      goalsConceded: { p10: 0.7105, p50: 1.1478, p90: 1.8414 },
      cleanSheets: { p10: 0.1668, p50: 0.3543, p90: 0.5366 },
      attack: { p10: 0.0263, p50: 0.0566, p90: 0.119 },
    },
    2: {
      interceptions: { p10: 1.5652, p50: 2.0225, p90: 2.5 },
      clearances: { p10: 2.1639, p50: 2.7541, p90: 3.36 },
      blocks: { p10: 0.0411, p50: 0.05, p90: 0.0789 },
      goalsConceded: { p10: 0.9, p50: 1.3889, p90: 1.9315 },
      cleanSheets: { p10: 0.1304, p50: 0.2712, p90: 0.4627 },
      attack: { p10: 0.0435, p50: 0.0637, p90: 0.1343 },
    },
    3: {
      interceptions: { p10: 1.3333, p50: 1.8, p90: 2.3093 },
      clearances: { p10: 1.6957, p50: 2.2632, p90: 2.8889 },
      blocks: { p10: 0.0526, p50: 0.0625, p90: 0.0771 },
      goalsConceded: { p10: 0.8276, p50: 1.2778, p90: 1.8 },
      cleanSheets: { p10: 0.1333, p50: 0.3077, p90: 0.4828 },
      attack: { p10: 0.0545, p50: 0.0667, p90: 0.1333 },
    },
  },
  MF: {
    1: {
      assists: { p10: 0.0321, p50: 0.1262, p90: 0.2419 },
      extraPasses: { p10: 0.0227, p50: 0.0294, p90: 0.0667 },
      goals: { p10: 0, p50: 0.0863, p90: 0.2177 },
      extraChances: { p10: 0.0226, p50: 0.0286, p90: 0.0654 },
    },
    2: {
      assists: { p10: 0, p50: 0.1053, p90: 0.2471 },
      extraPasses: { p10: 0.0417, p50: 0.0526, p90: 0.0769 },
      goals: { p10: 0, p50: 0.0645, p90: 0.1935 },
      extraChances: { p10: 0.0411, p50: 0.0526, p90: 0.0741 },
    },
    3: {
      assists: { p10: 0, p50: 0.1053, p90: 0.2449 },
      extraPasses: { p10: 0.0526, p50: 0.0625, p90: 0.0825 },
      goals: { p10: 0, p50: 0.0667, p90: 0.2 },
      extraChances: { p10: 0.0526, p50: 0.0625, p90: 0.0769 },
    },
  },
  FW: {
    1: {
      goals: { p10: 0.1755, p50: 0.4654, p90: 1.0227 },
      assists: { p10: 0, p50: 0.043, p90: 0.1237 },
      extraChances: { p10: 0.03, p50: 0.0723, p90: 0.1703 },
    },
    2: {
      goals: { p10: 0.1333, p50: 0.3661, p90: 0.7368 },
      assists: { p10: 0, p50: 0.0476, p90: 0.1364 },
      extraChances: { p10: 0.0448, p50: 0.0667, p90: 0.1304 },
    },
    3: {
      goals: { p10: 0.1333, p50: 0.3673, p90: 0.7347 },
      assists: { p10: 0, p50: 0, p90: 0.1333 },
      extraChances: { p10: 0.0545, p50: 0.0668, p90: 0.1333 },
    },
  },
};

// `median` is the raw-quality median of that position IN THAT TIER, so every
// group lands on 50 at its own median. `scale` amplifies the distance from that
// median and is chosen so the group's P99 lands on 93 — which is what makes twelve
// separately-shaped distributions comparable at all.
//
// The scale is additionally capped so the group's worst observed season stays
// above zero. With per-tier anchors that cap never binds: the lowest resulting
// P1 across the twelve groups is 6.2, so every scale here is the one its P99
// asks for. Every position still lands on 50 at its own tier median, and the
// spread between tiers is carried by leagueStrength instead of by the anchors.
const POSITION_QUALITY_CALIBRATION: Record<
  PlayerPosition,
  Record<LeagueTier, { median: number; scale: number }>
> = {
  GK: { 1: { median: 55.51, scale: 1.46 }, 2: { median: 52.9, scale: 1.39 }, 3: { median: 52.76, scale: 1.35 } },
  DF: { 1: { median: 53.28, scale: 2.1 }, 2: { median: 51.8, scale: 2.06 }, 3: { median: 51.37, scale: 1.88 } },
  MF: { 1: { median: 50.82, scale: 1.41 }, 2: { median: 47.51, scale: 1.54 }, 3: { median: 46.97, scale: 1.63 } },
  FW: { 1: { median: 52.19, scale: 1.19 }, 2: { median: 49.02, scale: 1.25 }, 3: { median: 48.96, scale: 1.28 } },
};

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function per90(value: number, minutes: number): number {
  return minutes > 0 ? value * 90 / minutes : 0;
}

function interpolate(value: number, from: number, to: number, low: number, high: number): number {
  if (to <= from) return high;
  return low + clamp((value - from) / (to - from), 0, 1) * (high - low);
}

/** P10→25, P50→50 and P90→85, with bounded tails. */
function anchoredMetric(value: number, anchors: MetricAnchors): number {
  if (value <= anchors.p10) {
    return anchors.p10 > 0 ? interpolate(value, 0, anchors.p10, 0, 25) : 25;
  }
  if (value <= anchors.p50) return interpolate(value, anchors.p10, anchors.p50, 25, 50);
  if (value <= anchors.p90) return interpolate(value, anchors.p50, anchors.p90, 50, 85);
  const upper = anchors.p90 + Math.max(anchors.p90 - anchors.p50, anchors.p90 * 0.25, 0.01);
  return interpolate(value, anchors.p90, upper, 85, 100);
}

/** Zero-heavy match events keep a below-average baseline instead of collapsing the scale. */
function sparseMetric(value: number, positiveAnchors: MetricAnchors): number {
  if (value <= 0) return 40;
  if (value <= positiveAnchors.p10) return interpolate(value, 0, positiveAnchors.p10, 40, 50);
  if (value <= positiveAnchors.p50) return interpolate(value, positiveAnchors.p10, positiveAnchors.p50, 50, 65);
  if (value <= positiveAnchors.p90) return interpolate(value, positiveAnchors.p50, positiveAnchors.p90, 65, 90);
  const upper = positiveAnchors.p90 + Math.max(positiveAnchors.p90 - positiveAnchors.p50, 0.01);
  return interpolate(value, positiveAnchors.p90, upper, 90, 100);
}

function inverseMetric(value: number, anchors: MetricAnchors): number {
  if (value <= anchors.p10) {
    const lower = Math.max(0, anchors.p10 - (anchors.p50 - anchors.p10));
    return interpolate(value, lower, anchors.p10, 100, 85);
  }
  if (value <= anchors.p50) return interpolate(value, anchors.p10, anchors.p50, 85, 50);
  if (value <= anchors.p90) return interpolate(value, anchors.p50, anchors.p90, 50, 25);
  const upper = anchors.p90 + Math.max(anchors.p90 - anchors.p50, 0.1);
  return interpolate(value, anchors.p90, upper, 25, 0);
}

function scoreToGrade(score: number, eligible: boolean): string {
  if (!eligible) return '—';
  if (score >= 85) return 'S';
  if (score >= 75) return 'A';
  if (score >= 65) return 'B';
  if (score >= 55) return 'C';
  return 'D';
}

function confidenceLabel(confidence: number, minutes: number): PlayerScoreConfidence {
  if (minutes <= 0) return 'none';
  if (confidence < 0.25) return 'low';
  if (confidence < 0.5) return 'medium';
  return 'high';
}

export function leagueStrengthScore(level?: 1 | 2 | 3): number {
  if (level === 2) return 95;
  if (level === 3) return 90;
  return 100;
}

export function getPlayerPerformanceMetrics(stats?: PlayerSeasonStats): PlayerPerformanceMetrics {
  const appearances = stats?.appearances ?? 0;
  const starts = stats?.starts ?? appearances;
  const minutes = stats?.minutesPlayed ?? appearances * 90;
  const teamMatches = Math.max(appearances, stats?.teamMatchesAllCompetitions ?? appearances);
  const goals = stats?.goals ?? 0;
  const assists = stats?.assists ?? 0;
  const routineSaves = stats?.routineSaves ?? 0;
  const keySaves = stats?.saves ?? 0;
  const goalsConceded = stats?.goalsConcededWhileOnPitch ?? 0;
  const shotsFaced = stats?.shotsOnTargetFaced ?? routineSaves + keySaves + goalsConceded;
  const cleanSheetMinutes = stats?.cleanSheetMinutes
    ?? Math.min(minutes, (stats?.cleanSheets ?? 0) * 60);

  return {
    minutes,
    appearances,
    starts,
    teamMatchesAllCompetitions: teamMatches,
    missedMatches: stats?.missedMatches ?? Math.max(0, teamMatches - appearances),
    injuryAbsenceMatches: stats?.injuryAbsenceMatches ?? 0,
    minuteAttendanceRate: teamMatches > 0 ? clamp(minutes / (teamMatches * 90), 0, 1) : 0,
    appearanceRate: teamMatches > 0 ? clamp(appearances / teamMatches, 0, 1) : 0,
    goalsPer90: per90(goals, minutes),
    assistsPer90: per90(assists, minutes),
    extraBigChancesPer90: per90(Math.max(0, (stats?.bigChances ?? goals) - goals), minutes),
    extraKeyPassesPer90: per90(Math.max(0, (stats?.keyPasses ?? assists) - assists), minutes),
    attackContributionPer90: per90(goals + assists, minutes),
    routineSavesPer90: per90(routineSaves, minutes),
    keySavesPer90: per90(keySaves, minutes),
    savePercentage: shotsFaced > 0 ? clamp((routineSaves + keySaves) / shotsFaced, 0, 1) : 0,
    cleanSheetContribution: minutes > 0 ? clamp(cleanSheetMinutes / minutes, 0, 1) : 0,
    goalsConcededPer90: per90(goalsConceded, minutes),
    interceptionsPer90: per90(stats?.interceptions ?? 0, minutes),
    clearancesPer90: per90(stats?.clearances ?? 0, minutes),
    goalLineBlocksPer90: per90(stats?.keyBlocks ?? 0, minutes),
  };
}

function computePositionQuality(
  position: PlayerPosition,
  metrics: PlayerPerformanceMetrics,
  tier: LeagueTier,
): number {
  const anchors = ANCHORS[position][tier];
  let quality: number;
  if (position === 'FW') {
    quality = anchoredMetric(metrics.goalsPer90, anchors.goals) * 0.45
      + anchoredMetric(metrics.assistsPer90, anchors.assists) * 0.25
      + sparseMetric(metrics.extraBigChancesPer90, anchors.extraChances) * 0.30;
  } else if (position === 'MF') {
    quality = anchoredMetric(metrics.assistsPer90, anchors.assists) * 0.35
      + sparseMetric(metrics.extraKeyPassesPer90, anchors.extraPasses) * 0.30
      + anchoredMetric(metrics.goalsPer90, anchors.goals) * 0.25
      + sparseMetric(metrics.extraBigChancesPer90, anchors.extraChances) * 0.10;
  } else if (position === 'DF') {
    // Interceptions and clearances are generated from the OPPONENT's shot and
    // possession totals, so they measure how much a defence was attacked rather
    // than how well it defended: measured across 4,012 top-flight defender
    // seasons, r(team goals conceded, interceptions/90) = +0.21 and
    // r(.., clearances/90) = +0.26. Under the old 0.30/0.25 weighting a
    // relegation-battling centre-back outscored a title winner, and the best
    // defender award went to a bottom-four club in 4 of 54 seasons.
    //
    // Weight moves from those two counts onto the two terms that actually
    // record an outcome — goals conceded while on the pitch and clean-sheet
    // share — which takes r(team goals conceded, defender quality) from -0.12
    // to -0.53 and drops the bottom-four wins to zero.
    quality = anchoredMetric(metrics.interceptionsPer90, anchors.interceptions) * 0.22
      + anchoredMetric(metrics.clearancesPer90, anchors.clearances) * 0.18
      + sparseMetric(metrics.goalLineBlocksPer90, anchors.blocks) * 0.12
      + inverseMetric(metrics.goalsConcededPer90, anchors.goalsConceded) * 0.22
      + anchoredMetric(metrics.cleanSheetContribution, anchors.cleanSheets) * 0.16
      + sparseMetric(metrics.attackContributionPer90, anchors.attack) * 0.10;
  } else {
    const saveRateScore = metrics.routineSavesPer90 + metrics.keySavesPer90 > 0
      ? anchoredMetric(metrics.savePercentage, anchors.savePercentage)
      : 50;
    quality = saveRateScore * 0.35
      + sparseMetric(metrics.keySavesPer90, anchors.keySaves) * 0.25
      + anchoredMetric(metrics.routineSavesPer90, anchors.routineSaves) * 0.20
      + inverseMetric(metrics.goalsConcededPer90, anchors.goalsConceded) * 0.15
      + anchoredMetric(metrics.cleanSheetContribution, anchors.cleanSheets) * 0.05;
  }
  const calibration = POSITION_QUALITY_CALIBRATION[position][tier];
  return round1(clamp(50 + (quality - calibration.median) * calibration.scale, 0, PLAYER_SCORE_CEILING));
}

function resultFromQuality(
  positionQuality: number,
  metrics: PlayerPerformanceMetrics,
  leagueStrength: number,
): PlayerPerformanceResult {
  const confidence = metrics.minutes > 0
    ? metrics.minutes / (metrics.minutes + PLAYER_CONFIDENCE_MINUTES)
    : 0;
  const adjustedPositionQuality = 50 + (positionQuality - 50) * confidence;
  // Availability answers "was this player there", not "did he play the full
  // ninety". A forward who starts and is replaced on the hour every week is
  // fully available; the old 0.60 weight on minute share read him as 60%
  // available and docked him for a coach's substitution, not for being
  // absent. The simulator hooks 54.7% of starting forwards — against 9.7% of
  // defenders and 8.4% of midfielders — because a 4-4-2 leaves 1.57 forwards
  // on a bench that supplies 67% of all substitutions. Weight moves to
  // appearance share, which sits between 0.92 and 0.97 at every position.
  const availabilityScore = 100 * (
    metrics.minuteAttendanceRate * 0.25
    + metrics.appearanceRate * 0.75
  );
  const eligible = metrics.minutes > 0;
  // Availability drops from 0.20 to 0.15: the confidence factor above already
  // prices in a thin sample, and the term here was a second penalty on the same
  // minutes. Position output carries 0.75 of the score.
  const score = eligible
    ? clamp(adjustedPositionQuality * 0.75 + availabilityScore * 0.15 + leagueStrength * 0.10, 0, PLAYER_SCORE_CEILING)
    : 0;
  const roundedScore = round1(score);
  return {
    score: roundedScore,
    seasonScore: roundedScore,
    positionQuality: round1(positionQuality),
    adjustedPositionQuality: round1(adjustedPositionQuality),
    availabilityScore: round1(availabilityScore),
    leagueStrength: round1(leagueStrength),
    confidence: Math.round(confidence * 1000) / 1000,
    confidenceLabel: confidenceLabel(confidence, metrics.minutes),
    scoreVersion: PLAYER_SCORE_VERSION,
    grade: scoreToGrade(roundedScore, eligible),
    eligible,
    metrics,
  };
}

export function computePlayerPerformance(
  position: PlayerPosition,
  stats: PlayerSeasonStats | undefined,
  leagueLevel?: 1 | 2 | 3,
): PlayerPerformanceResult {
  const metrics = getPlayerPerformanceMetrics(stats);
  return resultFromQuality(
    computePositionQuality(position, metrics, leagueLevel ?? 1),
    metrics,
    leagueStrengthScore(leagueLevel),
  );
}

function aggregateSegments(segments: PlayerTeamSeasonStats[]): PlayerSeasonStats | undefined {
  const first = segments[0];
  if (!first) return undefined;
  const total = { ...first };
  for (const field of PLAYER_STAT_COUNTER_FIELDS) (total[field] as number | undefined) = 0;
  for (const segment of segments) {
    for (const field of PLAYER_STAT_COUNTER_FIELDS) {
      (total[field] as number | undefined) = Number(total[field] ?? 0) + Number(segment[field] ?? 0);
    }
  }
  return total;
}

export function computeSegmentedPlayerPerformance(
  position: PlayerPosition,
  segments: PlayerTeamSeasonStats[],
  leagueLevels: Record<string, 1 | 2 | 3 | undefined>,
  seasonTotal?: PlayerSeasonStats,
): PlayerPerformanceResult {
  const activeSegments = segments.filter(segment =>
    (segment.minutesPlayed ?? 0) > 0 || (segment.teamMatchesAllCompetitions ?? 0) > 0,
  );
  if (activeSegments.length === 0) {
    return computePlayerPerformance(position, seasonTotal, seasonTotal ? leagueLevels[seasonTotal.teamId] : undefined);
  }
  const total = seasonTotal ?? aggregateSegments(activeSegments);
  const metrics = getPlayerPerformanceMetrics(total);
  const totalMinutes = activeSegments.reduce((sum, segment) => sum + (segment.minutesPlayed ?? 0), 0);
  const weighted = (read: (segment: PlayerTeamSeasonStats) => number) => {
    if (totalMinutes <= 0) return activeSegments.reduce((sum, segment) => sum + read(segment), 0) / activeSegments.length;
    return activeSegments.reduce(
      (sum, segment) => sum + read(segment) * (segment.minutesPlayed ?? 0),
      0,
    ) / totalMinutes;
  };
  const positionQuality = weighted(segment =>
    computePositionQuality(
      position,
      getPlayerPerformanceMetrics(segment),
      leagueLevels[segment.teamId] ?? 1,
    ),
  );
  const leagueStrength = weighted(segment => leagueStrengthScore(leagueLevels[segment.teamId]));
  return resultFromQuality(positionQuality, metrics, leagueStrength);
}

export const PLAYER_STAT_SCOPE_TOOLTIPS = {
  current: '当前赛季全赛事统计，点球大战不计入球员常规数据。',
  leagueContext: '综合评分由位置表现、全赛事出勤与轻量联赛强度共同构成。',
  career: '生涯统计来自保留的赛季档案与尚未归档的当前赛季。',
  legacy: '旧赛季缺少完整评分字段时标记为旧口径，不补造历史动作。',
} as const;

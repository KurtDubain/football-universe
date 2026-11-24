import type { PlayerPosition, PlayerSeasonStats, PlayerTeamSeasonStats } from '../../types/player';
import { PLAYER_STAT_COUNTER_FIELDS } from './player-stat-fields';

/** Minutes at which the soft confidence factor reaches 0.5. */
export const PLAYER_CONFIDENCE_MINUTES = 900;
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
 */
export const PLAYER_SCORE_VERSION = 3;

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

// Anchors sampled from a completed 54-season world (seed 698104882): every
// top-flight season row with 20+ appearances, 11,255 rows in total. They are
// never rebuilt from the live universe, so the same performance keeps the same
// score across saves.
//
// Sparse terms (zero in more than 5% of rows, scored through `sparseMetric`)
// take their P10/P50 from the NON-ZERO rows only. Sampling those from the full
// population would put the anchor at zero and make `sparseMetric` jump from its
// flat 40 baseline straight to the 50-90 band on the first non-zero event; the
// non-zero basis holds that step to about 3 points.
const ANCHORS = {
  FW: {
    goals: { p10: 0.1741, p50: 0.4054, p90: 0.8531 },
    assists: { p10: 0, p50: 0.0401, p90: 0.1212 },
    extraChances: { p10: 0.0270, p50: 0.0681, p90: 0.1339 },
  },
  MF: {
    assists: { p10: 0.0321, p50: 0.1176, p90: 0.2292 },
    extraPasses: { p10: 0.0231, p50: 0.0298, p90: 0.0476 },
    goals: { p10: 0, p50: 0.0763, p90: 0.1848 },
    extraChances: { p10: 0.0225, p50: 0.0283, p90: 0.0323 },
  },
  DF: {
    interceptions: { p10: 1.6410, p50: 2.0642, p90: 2.4571 },
    clearances: { p10: 2.3636, p50: 2.9416, p90: 3.4528 },
    blocks: { p10: 0.0235, p50: 0.0288, p90: 0.0437 },
    goalsConceded: { p10: 0.7373, p50: 1.0840, p90: 1.6118 },
    cleanSheets: { p10: 0.2059, p50: 0.3527, p90: 0.5055 },
    attack: { p10: 0.0256, p50: 0.0526, p90: 0.1000 },
  },
  GK: {
    savePercentage: { p10: 0.6802, p50: 0.7721, p90: 0.8415 },
    keySaves: { p10: 0.0261, p50: 0.0769, p90: 0.1654 },
    goalsConceded: { p10: 0.7358, p50: 1.0827, p90: 1.6200 },
    routineSaves: { p10: 3.2409, p50: 3.5882, p90: 3.9767 },
    cleanSheets: { p10: 0.2069, p50: 0.3514, p90: 0.5037 },
  },
} as const;

// `median` is the position's own raw-quality median, so every position lands
// on 50 at its median. `scale` amplifies the distance from that median and is
// chosen so each position's P99 lands on 93 — which is what makes four
// separately-shaped distributions comparable at all.
//
// The scale is additionally capped so the position's WORST observed season
// stays above zero. A scale that only targets the top would push the long left
// tail of the forward and goalkeeper distributions negative and flatten it onto
// the clamp. Defender scale is 1.64 rather than the 1.73 its P99 asks for, and
// its P99 lands on 89.5 instead of 93, for exactly that reason.
const POSITION_QUALITY_CALIBRATION: Record<PlayerPosition, { median: number; scale: number }> = {
  GK: { median: 55.5, scale: 1.42 },
  DF: { median: 53.0, scale: 1.64 },
  MF: { median: 51.4, scale: 1.37 },
  FW: { median: 52.0, scale: 1.18 },
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

function computePositionQuality(position: PlayerPosition, metrics: PlayerPerformanceMetrics): number {
  let quality: number;
  if (position === 'FW') {
    quality = anchoredMetric(metrics.goalsPer90, ANCHORS.FW.goals) * 0.45
      + anchoredMetric(metrics.assistsPer90, ANCHORS.FW.assists) * 0.25
      + sparseMetric(metrics.extraBigChancesPer90, ANCHORS.FW.extraChances) * 0.30;
  } else if (position === 'MF') {
    quality = anchoredMetric(metrics.assistsPer90, ANCHORS.MF.assists) * 0.35
      + sparseMetric(metrics.extraKeyPassesPer90, ANCHORS.MF.extraPasses) * 0.30
      + anchoredMetric(metrics.goalsPer90, ANCHORS.MF.goals) * 0.25
      + sparseMetric(metrics.extraBigChancesPer90, ANCHORS.MF.extraChances) * 0.10;
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
    quality = anchoredMetric(metrics.interceptionsPer90, ANCHORS.DF.interceptions) * 0.22
      + anchoredMetric(metrics.clearancesPer90, ANCHORS.DF.clearances) * 0.18
      + sparseMetric(metrics.goalLineBlocksPer90, ANCHORS.DF.blocks) * 0.12
      + inverseMetric(metrics.goalsConcededPer90, ANCHORS.DF.goalsConceded) * 0.22
      + anchoredMetric(metrics.cleanSheetContribution, ANCHORS.DF.cleanSheets) * 0.16
      + sparseMetric(metrics.attackContributionPer90, ANCHORS.DF.attack) * 0.10;
  } else {
    const saveRateScore = metrics.routineSavesPer90 + metrics.keySavesPer90 > 0
      ? anchoredMetric(metrics.savePercentage, ANCHORS.GK.savePercentage)
      : 50;
    quality = saveRateScore * 0.35
      + sparseMetric(metrics.keySavesPer90, ANCHORS.GK.keySaves) * 0.25
      + anchoredMetric(metrics.routineSavesPer90, ANCHORS.GK.routineSaves) * 0.20
      + inverseMetric(metrics.goalsConcededPer90, ANCHORS.GK.goalsConceded) * 0.15
      + anchoredMetric(metrics.cleanSheetContribution, ANCHORS.GK.cleanSheets) * 0.05;
  }
  const calibration = POSITION_QUALITY_CALIBRATION[position];
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
  const availabilityScore = 100 * (
    metrics.minuteAttendanceRate * 0.60
    + metrics.appearanceRate * 0.40
  );
  const eligible = metrics.minutes > 0;
  const score = eligible
    ? clamp(adjustedPositionQuality * 0.70 + availabilityScore * 0.20 + leagueStrength * 0.10, 0, PLAYER_SCORE_CEILING)
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
  return resultFromQuality(computePositionQuality(position, metrics), metrics, leagueStrengthScore(leagueLevel));
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
    computePositionQuality(position, getPlayerPerformanceMetrics(segment)),
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

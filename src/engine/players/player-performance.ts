import type { PlayerPosition, PlayerSeasonStats, PlayerTeamSeasonStats } from '../../types/player';
import { PLAYER_STAT_COUNTER_FIELDS } from './player-stat-fields';

/** Minutes at which the soft confidence factor reaches 0.5. */
export const PLAYER_CONFIDENCE_MINUTES = 900;
/** Kept as a compatibility export; ranking no longer has a hard minute gate. */
export const PLAYER_RANKING_MINUTES = 0;
export const PLAYER_SCORE_VERSION = 1;

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

// Fixed anchors sampled from 50 completed simulator seasons. They are never
// rebuilt from the live universe, so the same performance keeps the same score.
const ANCHORS = {
  FW: {
    goals: { p10: 0.133, p50: 0.316, p90: 0.541 },
    assists: { p10: 0, p50: 0.056, p90: 0.135 },
    extraChances: { p10: 0.026, p50: 0.053, p90: 0.099 },
  },
  MF: {
    assists: { p10: 0, p50: 0.128, p90: 0.260 },
    extraPasses: { p10: 0.025, p50: 0.039, p90: 0.075 },
    goals: { p10: 0, p50: 0.058, p90: 0.151 },
    extraChances: { p10: 0.025, p50: 0.033, p90: 0.068 },
  },
  DF: {
    interceptions: { p10: 1.667, p50: 2.063, p90: 2.433 },
    clearances: { p10: 2.250, p50: 2.818, p90: 3.307 },
    blocks: { p10: 0.025, p50: 0.034, p90: 0.070 },
    goalsConceded: { p10: 0.788, p50: 1.176, p90: 1.792 },
    cleanSheets: { p10: 0.167, p50: 0.327, p90: 0.482 },
    attack: { p10: 0.030, p50: 0.065, p90: 0.150 },
  },
  GK: {
    savePercentage: { p10: 0.513, p50: 0.698, p90: 0.810 },
    keySaves: { p10: 0.036, p50: 0.075, p90: 0.154 },
    goalsConceded: { p10: 0.800, p50: 1.188, p90: 1.800 },
    routineSaves: { p10: 1.469, p50: 2.933, p90: 3.618 },
    cleanSheets: { p10: 0.167, p50: 0.325, p90: 0.478 },
  },
} as const;

const POSITION_QUALITY_CALIBRATION: Record<PlayerPosition, { median: number; scale: number }> = {
  GK: { median: 52.7, scale: 0.83 },
  DF: { median: 52.1, scale: 1.85 },
  MF: { median: 48.5, scale: 1.42 },
  FW: { median: 50.9, scale: 1.14 },
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
    quality = anchoredMetric(metrics.interceptionsPer90, ANCHORS.DF.interceptions) * 0.30
      + anchoredMetric(metrics.clearancesPer90, ANCHORS.DF.clearances) * 0.25
      + sparseMetric(metrics.goalLineBlocksPer90, ANCHORS.DF.blocks) * 0.15
      + inverseMetric(metrics.goalsConcededPer90, ANCHORS.DF.goalsConceded) * 0.12
      + anchoredMetric(metrics.cleanSheetContribution, ANCHORS.DF.cleanSheets) * 0.08
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
  return round1(clamp(50 + (quality - calibration.median) * calibration.scale, 0, 100));
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
    ? clamp(adjustedPositionQuality * 0.70 + availabilityScore * 0.20 + leagueStrength * 0.10, 0, 100)
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

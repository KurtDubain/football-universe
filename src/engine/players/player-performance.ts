import type { PlayerPosition, PlayerSeasonStats } from '../../types/player';

export const PLAYER_RANKING_MINUTES = 600;

export interface PlayerPerformanceMetrics {
  minutes: number;
  goalsPer90: number;
  assistsPer90: number;
  extraBigChancesPer90: number;
  extraKeyPassesPer90: number;
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
  score: number;
  grade: string;
  eligible: boolean;
  metrics: PlayerPerformanceMetrics;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function per90(value: number, minutes: number): number {
  return minutes > 0 ? value * 90 / minutes : 0;
}

function normalized(value: number, low: number, high: number): number {
  if (high <= low) return 0;
  return clamp01((value - low) / (high - low));
}

function inverseNormalized(value: number, best: number, worst: number): number {
  return 1 - normalized(value, best, worst);
}

function scoreToGrade(score: number, eligible: boolean): string {
  if (!eligible) return '样本不足';
  if (score >= 85) return 'S';
  if (score >= 70) return 'A';
  if (score >= 55) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

export function getPlayerPerformanceMetrics(stats?: PlayerSeasonStats): PlayerPerformanceMetrics {
  const appearances = stats?.appearances ?? 0;
  const minutes = stats?.minutesPlayed ?? appearances * 90;
  const goals = stats?.goals ?? 0;
  const assists = stats?.assists ?? 0;
  const routineSaves = stats?.routineSaves ?? 0;
  const keySaves = stats?.saves ?? 0;
  const goalsConceded = stats?.goalsConcededWhileOnPitch ?? 0;
  const shotsFaced = stats?.shotsOnTargetFaced
    ?? routineSaves + keySaves + goalsConceded;
  const cleanSheetMinutes = stats?.cleanSheetMinutes
    ?? Math.min(minutes, (stats?.cleanSheets ?? 0) * 60);

  return {
    minutes,
    goalsPer90: per90(goals, minutes),
    assistsPer90: per90(assists, minutes),
    extraBigChancesPer90: per90(Math.max(0, (stats?.bigChances ?? goals) - goals), minutes),
    extraKeyPassesPer90: per90(Math.max(0, (stats?.keyPasses ?? assists) - assists), minutes),
    routineSavesPer90: per90(routineSaves, minutes),
    keySavesPer90: per90(keySaves, minutes),
    savePercentage: shotsFaced > 0 ? (routineSaves + keySaves) / shotsFaced : 0,
    cleanSheetContribution: minutes > 0 ? cleanSheetMinutes / minutes : 0,
    goalsConcededPer90: per90(goalsConceded, minutes),
    interceptionsPer90: per90(stats?.interceptions ?? 0, minutes),
    clearancesPer90: per90(stats?.clearances ?? 0, minutes),
    goalLineBlocksPer90: per90(stats?.keyBlocks ?? 0, minutes),
  };
}

export function computePlayerPerformance(
  position: PlayerPosition,
  stats: PlayerSeasonStats | undefined,
  leagueLevel?: 1 | 2 | 3,
): PlayerPerformanceResult {
  const metrics = getPlayerPerformanceMetrics(stats);
  const eligible = metrics.minutes >= PLAYER_RANKING_MINUTES;
  let rawScore = 0;

  if (position === 'FW') {
    rawScore = normalized(metrics.goalsPer90, 0, 0.9) * 55
      + normalized(metrics.assistsPer90, 0, 0.5) * 25
      + normalized(metrics.extraBigChancesPer90, 0, 0.45) * 20;
  } else if (position === 'MF') {
    rawScore = normalized(metrics.goalsPer90, 0, 0.45) * 25
      + normalized(metrics.assistsPer90, 0, 0.65) * 35
      + normalized(metrics.extraKeyPassesPer90, 0, 0.7) * 40;
  } else if (position === 'GK') {
    rawScore = normalized(metrics.savePercentage, 0.45, 0.88) * 35
      + normalized(metrics.routineSavesPer90, 0, 4.5) * 20
      + normalized(metrics.keySavesPer90, 0, 0.25) * 20
      + inverseNormalized(metrics.goalsConcededPer90, 0.4, 2.4) * 15
      + normalized(metrics.cleanSheetContribution, 0, 0.6) * 10;
  } else {
    rawScore = normalized(metrics.interceptionsPer90, 0, 4) * 30
      + normalized(metrics.clearancesPer90, 0, 6) * 25
      + normalized(metrics.goalLineBlocksPer90, 0, 0.18) * 20
      + inverseNormalized(metrics.goalsConcededPer90, 0.4, 2.2) * 15
      + normalized(metrics.cleanSheetContribution, 0, 0.6) * 10;
  }

  const competitionFactor = leagueLevel === 2 ? 0.96 : leagueLevel === 3 ? 0.92 : 1;
  const score = Math.round(Math.max(0, Math.min(100, rawScore * competitionFactor)) * 10) / 10;
  return { score, grade: scoreToGrade(score, eligible), eligible, metrics };
}

export const PLAYER_STAT_SCOPE_TOOLTIPS = {
  current: '当前赛季全赛事统计，点球大战不计入球员常规数据。',
  leagueContext: '球员数据为当前赛季全赛事；联赛级别仅用于榜单强度修正。',
  career: '生涯统计来自保留的赛季档案与尚未归档的当前赛季。',
  legacy: '旧赛季缺少新增防守字段时按旧统计口径展示，不补造历史动作。',
} as const;

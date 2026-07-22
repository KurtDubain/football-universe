import type { MatchEvent, MatchResult } from '../../types/match';

export type MatchOutcome = 'home' | 'draw' | 'away';
export type DestinyDeviationTier = 'normal' | 'minor' | 'upset' | 'major_upset';

export interface DestinyDeviation {
  outcome: MatchOutcome;
  tier: DestinyDeviationTier;
  /** 0-100: larger means the result occupied less of the pre-match distribution. */
  score: number;
  actualProbability: number;
  label: string;
  summary: string;
  isUpset: boolean;
}

export type MatchTurningPointType =
  | 'red_card'
  | 'comeback'
  | 'late_equalizer'
  | 'late_winner'
  | 'extra_time'
  | 'shootout';

export interface MatchTurningPoint {
  type: MatchTurningPointType;
  minute?: number;
  teamId?: string;
  title: string;
  detail: string;
}

export function resolveMatchOutcome(result: MatchResult): MatchOutcome {
  const home = result.homeGoals + (result.etHomeGoals ?? 0);
  const away = result.awayGoals + (result.etAwayGoals ?? 0);
  if (home > away) return 'home';
  if (away > home) return 'away';
  if (result.penalties && result.penaltyHome != null && result.penaltyAway != null) {
    return result.penaltyHome > result.penaltyAway ? 'home' : 'away';
  }
  return 'draw';
}

function actualOutcomeProbability(result: MatchResult, outcome: MatchOutcome): number | null {
  const prediction = result.prediction;
  if (!prediction) return null;
  if (outcome === 'draw') return prediction.drawPct;

  const outright = outcome === 'home' ? prediction.homeWinPct : prediction.awayWinPct;
  // In knockout matches, the forecast's draw branch proceeds to ET/penalties.
  // Split that branch evenly instead of treating a shootout win like a 90-minute win.
  return result.extraTime ? outright + prediction.drawPct / 2 : outright;
}

export function analyzeDestinyDeviation(result: MatchResult): DestinyDeviation {
  const outcome = resolveMatchOutcome(result);
  const probability = actualOutcomeProbability(result, outcome);
  if (probability == null) {
    return {
      outcome, tier: 'normal', score: 0, actualProbability: 100,
      label: '未评级', summary: '该场没有冻结的赛前分布，无法可靠评估意外程度。', isUpset: false,
    };
  }

  const actualProbability = Math.max(0, Math.min(100, Math.round(probability)));
  const score = 100 - actualProbability;
  const tier: DestinyDeviationTier = actualProbability >= 40
    ? 'normal'
    : actualProbability >= 25
      ? 'minor'
      : actualProbability >= 15
        ? 'upset'
        : 'major_upset';
  const label = {
    normal: '正常轨道',
    minor: '轻微意外',
    upset: '明显爆冷',
    major_upset: '重大爆冷',
  }[tier];
  const summary = {
    normal: '实际结果落在赛前分布中较常见的区间。',
    minor: '实际结果并非主流预期，但仍属于经常会出现的偏离。',
    upset: '实际结果落在赛前分布的低概率一侧，构成明确冷门。',
    major_upset: '实际结果远离赛前主流预期，是这段历史中的重大偏离。',
  }[tier];
  const winnerWasUnderdog = outcome === 'home'
    ? result.prediction!.homeWinPct < result.prediction!.awayWinPct
    : outcome === 'away' && result.prediction!.awayWinPct < result.prediction!.homeWinPct;

  return {
    outcome,
    tier,
    score,
    actualProbability,
    label,
    summary,
    isUpset: outcome !== 'draw' && winnerWasUnderdog && (tier === 'upset' || tier === 'major_upset'),
  };
}

export function isUpsetResult(result: MatchResult): boolean {
  return analyzeDestinyDeviation(result).isUpset;
}

function scoringTeamId(event: MatchEvent, result: MatchResult): string | null {
  if (event.type === 'goal') return event.teamId;
  if (event.type !== 'own_goal') return null;
  return event.teamId === result.homeTeamId ? result.awayTeamId : result.homeTeamId;
}

function teamLabel(teamId: string, result: MatchResult): string {
  return teamId === result.homeTeamId ? '主队' : '客队';
}

export function extractMatchTurningPoints(result: MatchResult): MatchTurningPoint[] {
  if (result.detailsArchived) return [];
  const candidates: Array<MatchTurningPoint & { rank: number }> = [];
  const outcome = resolveMatchOutcome(result);
  const winnerId = outcome === 'home'
    ? result.homeTeamId
    : outcome === 'away'
      ? result.awayTeamId
      : null;
  const scoringEvents = result.events
    .filter(event => event.type === 'goal' || event.type === 'own_goal')
    .sort((a, b) => a.minute - b.minute);
  let home = 0;
  let away = 0;
  let winnerTrailed = false;

  for (const event of scoringEvents) {
    if (winnerId) {
      const trailingBefore = winnerId === result.homeTeamId ? home < away : away < home;
      winnerTrailed ||= trailingBefore;
    }
    const scorerId = scoringTeamId(event, result);
    if (scorerId === result.homeTeamId) home++;
    if (scorerId === result.awayTeamId) away++;
    const isLate = event.minute >= (event.minute > 90 ? 115 : 88);
    if (!isLate || !scorerId) continue;

    if (winnerId === scorerId) {
      const tookLead = winnerId === result.homeTeamId ? home > away : away > home;
      if (tookLead) {
        const detail = event.type === 'own_goal'
          ? `${event.playerName ?? teamLabel(event.teamId, result)}的乌龙球在比赛末段改变了领先方。`
          : `${event.playerName ?? teamLabel(scorerId, result)}在比赛末段打入决定性进球。`;
        candidates.push({
          type: 'late_winner', minute: event.minute, teamId: scorerId, rank: 92,
          title: `${event.minute}' 绝杀`,
          detail,
        });
      }
    } else if (outcome === 'draw' && home === away) {
      const detail = event.type === 'own_goal'
        ? `${event.playerName ?? teamLabel(event.teamId, result)}的乌龙球在比赛末段扳平了比分。`
        : `${event.playerName ?? teamLabel(scorerId, result)}在比赛末段扳平比分。`;
      candidates.push({
        type: 'late_equalizer', minute: event.minute, teamId: scorerId, rank: 88,
        title: `${event.minute}' 绝平`,
        detail,
      });
    }
  }

  if (winnerId && winnerTrailed) {
    candidates.push({
      type: 'comeback', teamId: winnerId, rank: 86,
      title: '逆转取胜', detail: `${teamLabel(winnerId, result)}曾经落后，最终完成反超。`,
    });
  }

  for (const event of result.events.filter(item => item.type === 'red_card')) {
    candidates.push({
      type: 'red_card', minute: event.minute, teamId: event.teamId, rank: 82,
      title: `${event.minute}' 红牌`,
      detail: `${event.playerName ?? teamLabel(event.teamId, result)}被罚下，场上人数随之改变。`,
    });
  }

  if (result.penalties) {
    candidates.push({
      type: 'shootout', rank: 78, title: '点球决胜',
      detail: `双方战至平局，点球大战以${result.penaltyHome ?? 0}:${result.penaltyAway ?? 0}决定晋级者。`,
    });
  } else if (result.extraTime) {
    candidates.push({
      type: 'extra_time', rank: 65, title: '进入加时',
      detail: `常规时间未分胜负，加时阶段比分为${result.etHomeGoals ?? 0}:${result.etAwayGoals ?? 0}。`,
    });
  }

  return candidates
    .sort((a, b) => b.rank - a.rank || (b.minute ?? -1) - (a.minute ?? -1))
    .filter((candidate, index, all) => all.findIndex(item => item.type === candidate.type) === index)
    .slice(0, 2)
    .map(point => ({
      type: point.type,
      ...(point.minute != null ? { minute: point.minute } : {}),
      ...(point.teamId ? { teamId: point.teamId } : {}),
      title: point.title,
      detail: point.detail,
    }));
}

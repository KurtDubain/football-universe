import type { CompetitionType, MatchEvent, MatchResult } from '../../types/match';

export type LiveMomentKind =
  | 'goal'
  | 'equalizer'
  | 'turnaround'
  | 'late_winner'
  | 'red_card'
  | 'shootout'
  | 'fulltime'
  | 'advance'
  | 'champion';

export interface LiveMomentEmphasis {
  kind: LiveMomentKind;
  label: string;
  detail?: string;
  playerName?: string;
}

function scoresForEvents(events: readonly MatchEvent[], homeTeamId: string): [number, number] {
  let home = 0;
  let away = 0;
  for (const event of events) {
    if (event.type !== 'goal' && event.type !== 'own_goal') continue;
    if (event.teamId === homeTeamId) home++;
    else away++;
  }
  return [home, away];
}

function isKnockoutCompetition(type: CompetitionType, roundLabel: string): boolean {
  if (type === 'league' || type === 'world_cup_group' || type === 'super_cup_group') return false;
  return !/group|小组/i.test(roundLabel);
}

function winningTeamId(result: MatchResult): string | null {
  const home = result.homeGoals + (result.etHomeGoals ?? 0);
  const away = result.awayGoals + (result.etAwayGoals ?? 0);
  if (home !== away) return home > away ? result.homeTeamId : result.awayTeamId;
  if (result.penalties && result.penaltyHome !== result.penaltyAway) {
    return (result.penaltyHome ?? 0) > (result.penaltyAway ?? 0)
      ? result.homeTeamId
      : result.awayTeamId;
  }
  return null;
}

export function describeLiveEventMoment(
  result: MatchResult,
  shownEvents: readonly MatchEvent[],
  event: MatchEvent | null,
): LiveMomentEmphasis | null {
  if (!event) return null;
  if (event.type === 'red_card') {
    return { kind: 'red_card', label: '红牌', detail: '比赛局势发生改变', playerName: event.playerName };
  }
  if (event.type === 'penalty_goal' || event.type === 'penalty_miss') {
    const outcome = event.type === 'penalty_goal' ? '命中' : '未进';
    return {
      kind: 'shootout',
      label: event.shootout?.suddenDeath ? `突然死亡轮 · ${outcome}` : `点球大战 · ${outcome}`,
      playerName: event.playerName,
    };
  }
  if (event.type !== 'goal' && event.type !== 'own_goal') return null;

  const eventIndex = shownEvents.lastIndexOf(event);
  const priorEvents = eventIndex >= 0 ? shownEvents.slice(0, eventIndex) : shownEvents.slice(0, -1);
  const [beforeHome, beforeAway] = scoresForEvents(priorEvents, result.homeTeamId);
  const [afterHome, afterAway] = scoresForEvents(shownEvents, result.homeTeamId);
  const scoringHome = event.teamId === result.homeTeamId;
  const beforeScoring = scoringHome ? beforeHome : beforeAway;
  const beforeOpponent = scoringHome ? beforeAway : beforeHome;
  const afterScoring = scoringHome ? afterHome : afterAway;
  const afterOpponent = scoringHome ? afterAway : afterHome;
  const resultEventIndex = result.events.indexOf(event);
  const laterEvents = resultEventIndex >= 0
    ? result.events.slice(resultEventIndex + 1)
    : result.events.filter(candidate => candidate.minute > event.minute);
  const laterScoreEvent = laterEvents.some(candidate => (
    candidate.type === 'goal' || candidate.type === 'own_goal'
  ));
  const finalWinner = winningTeamId(result);

  if (event.minute >= 85 && !laterScoreEvent && finalWinner === event.teamId && beforeScoring === beforeOpponent) {
    return { kind: 'late_winner', label: '绝杀', detail: `${event.minute}' 改写比赛`, playerName: event.playerName };
  }
  if (afterScoring === afterOpponent) {
    return { kind: 'equalizer', label: '扳平比分', detail: `${afterHome} - ${afterAway}`, playerName: event.playerName };
  }
  const scoringTeamHadTrailed = priorEvents.some((_, index) => {
    const [home, away] = scoresForEvents(priorEvents.slice(0, index + 1), result.homeTeamId);
    return scoringHome ? home < away : away < home;
  });
  if (afterScoring > afterOpponent && scoringTeamHadTrailed) {
    return { kind: 'turnaround', label: '反超', detail: `${afterHome} - ${afterAway}`, playerName: event.playerName };
  }
  return { kind: 'goal', label: '进球', detail: `${afterHome} - ${afterAway}`, playerName: event.playerName };
}

export function describeFinalMoment(result: MatchResult): LiveMomentEmphasis {
  const final = result.roundLabel === 'Final' || result.roundLabel === '决赛';
  const winner = winningTeamId(result);
  if (final && winner) return { kind: 'champion', label: '冠军诞生', detail: '终场结果已归档' };
  if (winner && isKnockoutCompetition(result.competitionType, result.roundLabel)) {
    return { kind: 'advance', label: '晋级', detail: '淘汰赛结果已归档' };
  }
  return { kind: 'fulltime', label: '比赛归档完成', detail: '赛后战报已生成' };
}

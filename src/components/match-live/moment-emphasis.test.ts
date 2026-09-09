import { describe, expect, it } from 'vitest';
import type { MatchEvent, MatchResult } from '../../types/match';
import { describeFinalMoment, describeLiveEventMoment } from './moment-emphasis';

function result(events: MatchEvent[], overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    fixtureId: 'f1', homeTeamId: 'home', awayTeamId: 'away', homeGoals: 1, awayGoals: 0,
    extraTime: false, penalties: false, events,
    stats: { possession: [50, 50], shots: [1, 1], shotsOnTarget: [1, 0], corners: [0, 0], fouls: [0, 0], yellowCards: [0, 0], redCards: [0, 0] },
    competitionType: 'league', competitionName: '顶级联赛', roundLabel: '第1轮', ...overrides,
  };
}

function goal(minute: number, teamId: string, playerName = '球员'): MatchEvent {
  return { minute, teamId, playerName, type: 'goal', description: '进球' };
}

describe('live moment emphasis', () => {
  it('separates ordinary goals, equalizers, turnarounds and genuine late winners', () => {
    const events = [goal(10, 'away'), goal(30, 'home'), goal(60, 'home')];
    const match = result(events, { homeGoals: 2, awayGoals: 1 });
    expect(describeLiveEventMoment(match, events.slice(0, 1), events[0])?.kind).toBe('goal');
    expect(describeLiveEventMoment(match, events.slice(0, 2), events[1])?.kind).toBe('equalizer');
    expect(describeLiveEventMoment(match, events, events[2])?.kind).toBe('turnaround');

    const late = goal(89, 'home', '焦点前锋');
    const lateMatch = result([late]);
    expect(describeLiveEventMoment(lateMatch, [late], late)).toMatchObject({ kind: 'late_winner', playerName: '焦点前锋' });

    const sameMinuteReply = goal(89, 'away');
    const sameMinuteMatch = result([late, sameMinuteReply], { homeGoals: 1, awayGoals: 1 });
    expect(describeLiveEventMoment(sameMinuteMatch, [late], late)?.kind).toBe('goal');
  });

  it('separates red cards, shootouts, advancement and champions', () => {
    const red: MatchEvent = { minute: 52, teamId: 'away', type: 'red_card', description: '红牌' };
    expect(describeLiveEventMoment(result([red]), [red], red)?.kind).toBe('red_card');
    const penalty: MatchEvent = { minute: 123, teamId: 'home', type: 'penalty_goal', description: '命中' };
    expect(describeLiveEventMoment(result([penalty]), [penalty], penalty)?.kind).toBe('shootout');
    expect(describeFinalMoment(result([], { competitionType: 'league_cup', roundLabel: 'SF' })).kind).toBe('advance');
    expect(describeFinalMoment(result([], { competitionType: 'league_cup', roundLabel: 'Final' })).kind).toBe('champion');
  });
});

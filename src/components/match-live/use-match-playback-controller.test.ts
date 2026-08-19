import { describe, expect, it } from 'vitest';
import type { MatchEvent, MatchResult } from '../../types/match';
import { buildPlaybackTimeline, getPlaybackStageLabel } from './use-match-playback-controller';

function result(events: MatchEvent[], overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    fixtureId: 'timeline',
    homeTeamId: 'home',
    awayTeamId: 'away',
    homeGoals: 0,
    awayGoals: 0,
    extraTime: false,
    penalties: false,
    events,
    stats: {
      possession: [50, 50],
      shots: [0, 0],
      shotsOnTarget: [0, 0],
      corners: [0, 0],
      fouls: [0, 0],
      yellowCards: [0, 0],
      redCards: [0, 0],
    },
    competitionType: 'league',
    competitionName: '测试联赛',
    roundLabel: 'R1',
    ...overrides,
  };
}

describe('match playback controller contract', () => {
  it('keeps same-minute source order without mutating legacy shootout events', () => {
    const events: MatchEvent[] = [
      { minute: 121, type: 'penalty_goal', teamId: 'home', description: '第一罚' },
      { minute: 121, type: 'penalty_miss', teamId: 'away', description: '第二罚' },
    ];
    const timeline = buildPlaybackTimeline(result(events, { extraTime: true, penalties: true }));

    expect(timeline.timelineMax).toBe(121);
    expect(timeline.events.map(event => event.description)).toEqual(['第一罚', '第二罚']);
    expect(timeline.events.map(event => event.shootout?.kickNumber)).toEqual([1, 2]);
    expect(events.every(event => event.shootout === undefined)).toBe(true);
  });

  it('keeps regulation events bounded and exposes stable stage labels', () => {
    const events: MatchEvent[] = [
      { minute: 90, type: 'goal', teamId: 'home', description: '有效' },
      { minute: 121, type: 'penalty_goal', teamId: 'home', description: '无大战时忽略' },
    ];
    expect(buildPlaybackTimeline(result(events)).events).toHaveLength(1);
    expect(getPlaybackStageLabel({ minute: 46, phase: 'playing' }, false)).toBe('下半场');
    expect(getPlaybackStageLabel({ minute: 121, phase: 'playing' }, true)).toBe('点球大战');
    expect(getPlaybackStageLabel({ minute: 90, phase: 'finished' }, false)).toBe('全场');
  });
});

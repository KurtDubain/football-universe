import { describe, it, expect } from 'vitest';
import {
  createInitialPlayerStatSegments,
  createInitialPlayerStats,
  getTopScorerByTeamFromSegments,
  playerTeamStatKey,
  updatePlayerStatSegmentsFromResults,
  updatePlayerStatsFromResults,
} from './stats';
import type { MatchResult, MatchEvent } from '../../types/match';
import type { Player } from '../../types/player';

function mkPlayer(uuid: string, teamId: string): Player {
  return {
    uuid, teamId, name: '测试', number: 9, position: 'FW',
    rating: 80, goalScoring: 70, marketValue: 10, age: 25,
    // Test fixtures pin peak == rating + age 27 so curve-aware code paths
    // get a sensible default without needing per-test setup.
    peakRating: 80, peakAge: 27,
  };
}

function mkResult(events: MatchEvent[]): MatchResult {
  return {
    fixtureId: 'f1',
    homeTeamId: 'A', awayTeamId: 'B',
    homeGoals: 1, awayGoals: 1,
    extraTime: false,
    penalties: true, penaltyHome: 4, penaltyAway: 2,
    events,
    stats: {
      possession: [50, 50], shots: [10, 10], shotsOnTarget: [5, 5],
      corners: [4, 4], fouls: [10, 10], yellowCards: [1, 1], redCards: [0, 0],
    },
    competitionType: 'league_cup',
    competitionName: '联赛杯', roundLabel: 'Final',
  };
}

function mkLeagueResult(
  homeTeamId: string,
  awayTeamId: string,
  homeGoals: number,
  awayGoals: number,
  events: MatchEvent[],
): MatchResult {
  return {
    fixtureId: `${homeTeamId}-${awayTeamId}`,
    homeTeamId,
    awayTeamId,
    homeGoals,
    awayGoals,
    extraTime: false,
    penalties: false,
    events,
    stats: {
      possession: [50, 50],
      shots: [10, 10],
      shotsOnTarget: [5, 5],
      corners: [4, 4],
      fouls: [10, 10],
      yellowCards: [0, 0],
      redCards: [0, 0],
    },
    competitionType: 'league',
    competitionName: '测试联赛',
    roundLabel: 'R1',
  };
}

describe('updatePlayerStatsFromResults — shootout exclusion', () => {
  it('counts only regulation goals, not shootout penalty_goal kicks', () => {
    const p = mkPlayer('p-1', 'A');
    const squads = { A: [p], B: [] };
    const stats = createInitialPlayerStats(squads);
    const events: MatchEvent[] = [
      // 1 regulation goal
      { minute: 45, type: 'goal', teamId: 'A', playerId: 'p-1', playerName: '测试', description: '中场进球' },
      // 3 shootout kicks at minute 121+ (should NOT count as season goals)
      { minute: 121, type: 'penalty_goal', teamId: 'A', playerId: 'p-1', playerName: '测试', description: '点球 1' },
      { minute: 122, type: 'penalty_goal', teamId: 'A', playerId: 'p-1', playerName: '测试', description: '点球 2' },
      { minute: 123, type: 'penalty_goal', teamId: 'A', playerId: 'p-1', playerName: '测试', description: '点球 3' },
    ];
    const updated = updatePlayerStatsFromResults(stats, [mkResult(events)], squads);
    expect(updated['p-1'].goals).toBe(1);
    expect(updated['p-1'].appearances).toBe(1);
  });

  it('belt-and-suspender: a hypothetical penalty_goal at minute 119 is still excluded', () => {
    // Defensive: if a future code path emitted penalty_goal during ET, we
    // still shouldn't count it (the rule is type === penalty_goal OR minute > 120).
    const p = mkPlayer('p-1', 'A');
    const squads = { A: [p], B: [] };
    const stats = createInitialPlayerStats(squads);
    const events: MatchEvent[] = [
      { minute: 119, type: 'penalty_goal', teamId: 'A', playerId: 'p-1', playerName: '测试', description: '某种点球' },
    ];
    const updated = updatePlayerStatsFromResults(stats, [mkResult(events)], squads);
    expect(updated['p-1'].goals).toBe(0);
  });

  it('regulation penalties (type=goal, minute<=120) ARE counted normally', () => {
    const p = mkPlayer('p-1', 'A');
    const squads = { A: [p], B: [] };
    const stats = createInitialPlayerStats(squads);
    const events: MatchEvent[] = [
      // Regulation penalty: type 'goal' (event generator uses 'goal' for in-play penalties)
      { minute: 70, type: 'goal', teamId: 'A', playerId: 'p-1', playerName: '测试', description: '点球破门' },
    ];
    const updated = updatePlayerStatsFromResults(stats, [mkResult(events)], squads);
    expect(updated['p-1'].goals).toBe(1);
  });

  it('shootout assists / cards at minute > 120 also do not corrupt stats', () => {
    // Shouldn't happen in current generator but be defensive
    const p = mkPlayer('p-1', 'A');
    const squads = { A: [p], B: [] };
    const stats = createInitialPlayerStats(squads);
    const events: MatchEvent[] = [
      { minute: 125, type: 'yellow_card', teamId: 'A', playerId: 'p-1', playerName: '测试', description: '?' },
      { minute: 130, type: 'assist', teamId: 'A', playerId: 'p-1', playerName: '测试', description: '?' },
    ];
    const updated = updatePlayerStatsFromResults(stats, [mkResult(events)], squads);
    expect(updated['p-1'].yellowCards).toBe(0);
    expect(updated['p-1'].assists).toBe(0);
  });
});

describe('player stat segments', () => {
  it('keeps old-club and new-club contribution split after a transfer', () => {
    const playerAtA = mkPlayer('p-1', 'A');
    const initialSquads = { A: [playerAtA], B: [] };
    let totals = createInitialPlayerStats(initialSquads);
    let segments = createInitialPlayerStatSegments(initialSquads);

    const firstGoal: MatchEvent = {
      minute: 23,
      type: 'goal',
      teamId: 'A',
      playerId: 'p-1',
      playerName: '测试',
      description: 'A队进球',
    };
    const first = mkLeagueResult('A', 'B', 1, 0, [firstGoal]);
    totals = updatePlayerStatsFromResults(totals, [first], initialSquads);
    segments = updatePlayerStatSegmentsFromResults(segments, [first], initialSquads);

    const playerAtB = { ...playerAtA, teamId: 'B', number: 10 };
    const transferredSquads = { A: [], B: [playerAtB] };
    totals = {
      ...totals,
      'p-1': {
        ...totals['p-1'],
        teamId: 'B',
      },
    };

    const secondGoal: MatchEvent = {
      minute: 51,
      type: 'goal',
      teamId: 'B',
      playerId: 'p-1',
      playerName: '测试',
      description: 'B队进球',
    };
    const second = mkLeagueResult('B', 'A', 1, 0, [secondGoal]);
    totals = updatePlayerStatsFromResults(totals, [second], transferredSquads);
    segments = updatePlayerStatSegmentsFromResults(segments, [second], transferredSquads);

    expect(totals['p-1'].teamId).toBe('B');
    expect(totals['p-1'].goals).toBe(2);
    expect(totals['p-1'].appearances).toBe(2);

    expect(segments[playerTeamStatKey('p-1', 'A')]).toMatchObject({
      playerId: 'p-1',
      teamId: 'A',
      goals: 1,
      appearances: 1,
    });
    expect(segments[playerTeamStatKey('p-1', 'B')]).toMatchObject({
      playerId: 'p-1',
      teamId: 'B',
      goals: 1,
      appearances: 1,
    });

    const topByTeam = getTopScorerByTeamFromSegments(segments, totals);
    expect(topByTeam.A?.playerId).toBe('p-1');
    expect(topByTeam.A?.goals).toBe(1);
    expect(topByTeam.B?.playerId).toBe('p-1');
    expect(topByTeam.B?.goals).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import type { MatchResult } from '../../types/match';
import type { CalendarWindow } from '../../types/season';
import {
  appendObserverSeasonTrajectory,
  buildObserverSeasonTrajectory,
  OBSERVER_SEASON_TRAJECTORY_LIMIT,
  type ObserverSeasonTrajectory,
} from './season-trajectory';

function result(
  fixtureId: string,
  homeTeamId: string,
  awayTeamId: string,
  homeGoals: number,
  awayGoals: number,
): MatchResult {
  return {
    fixtureId,
    homeTeamId,
    awayTeamId,
    homeGoals,
    awayGoals,
    extraTime: false,
    penalties: false,
    events: [],
    stats: {
      possession: [50, 50],
      shots: [8, 8],
      shotsOnTarget: [3, 3],
      corners: [4, 4],
      fouls: [10, 10],
      yellowCards: [1, 1],
      redCards: [0, 0],
    },
    competitionType: 'league',
    competitionName: '测试联赛',
    roundLabel: fixtureId,
  };
}

function window(id: number, results: MatchResult[]): CalendarWindow {
  return {
    id,
    type: 'league',
    label: `第${id + 1}轮`,
    description: '',
    fixtures: [],
    completed: true,
    results,
  };
}

describe('observer season trajectory', () => {
  it('replays authoritative league results into four stable checkpoints', () => {
    const trajectory = buildObserverSeasonTrajectory({
      seasonState: {
        seasonNumber: 7,
        currentWindowIndex: 4,
        completed: false,
        isWorldCupYear: false,
        worldCupPhase: false,
        calendar: [
          window(0, [result('r1', 'alpha', 'beta', 0, 2), result('r2', 'gamma', 'delta', 1, 0)]),
          window(1, [result('r3', 'alpha', 'gamma', 1, 1), result('r4', 'beta', 'delta', 1, 0)]),
          window(2, [result('r5', 'delta', 'alpha', 0, 2), result('r6', 'beta', 'gamma', 0, 0)]),
          window(3, [result('r7', 'alpha', 'beta', 3, 0), result('r8', 'delta', 'gamma', 1, 2)]),
        ],
      },
      seasonStartLevels: { alpha: 1, beta: 1, gamma: 1, delta: 1 },
      observationRecord: {
        total: 9,
        correct: 6,
        currentStreak: 2,
        bestStreak: 3,
        recent: [],
        seasonNumber: 7,
        seasonTotal: 4,
        seasonCorrect: 3,
        seasonCurrentStreak: 2,
        seasonBestStreak: 2,
      },
    }, 'alpha', { type: 'player_growth', playerId: 'player-alpha' });

    expect(trajectory).not.toBeNull();
    expect(trajectory?.checkpoints.map(entry => entry.played)).toEqual([1, 2, 3, 4]);
    expect(trajectory?.checkpoints.map(entry => entry.phase)).toEqual([
      'opening',
      'midseason',
      'run_in',
      'final',
    ]);
    expect(trajectory?.checkpoints.at(-1)).toMatchObject({
      position: 2,
      points: 7,
      goalDifference: 3,
    });
    expect(trajectory?.judgment).toEqual({ total: 4, correct: 3, bestStreak: 2 });
    expect(trajectory?.theme).toEqual({
      type: 'player_growth',
      playerId: 'player-alpha',
    });
  });

  it('ignores cup results and teams without a recorded starting league', () => {
    const cupResult = { ...result('cup', 'alpha', 'beta', 8, 0), competitionType: 'league_cup' as const };
    const world = {
      seasonState: {
        seasonNumber: 2,
        currentWindowIndex: 2,
        completed: false,
        isWorldCupYear: false,
        worldCupPhase: false,
        calendar: [
          window(0, [result('league', 'alpha', 'beta', 1, 0)]),
          window(1, [cupResult]),
        ],
      },
      seasonStartLevels: { alpha: 2 as const, beta: 2 as const },
      observationRecord: undefined,
    };

    expect(buildObserverSeasonTrajectory(world, 'alpha')?.checkpoints.at(-1)).toMatchObject({
      played: 1,
      points: 3,
      goalDifference: 1,
    });
    expect(buildObserverSeasonTrajectory(world, 'missing')).toBeNull();
  });

  it('omits the theme reference when observation themes are disabled', () => {
    const world = {
      seasonState: {
        seasonNumber: 2,
        currentWindowIndex: 1,
        completed: false,
        isWorldCupYear: false,
        worldCupPhase: false,
        calendar: [window(0, [result('league', 'alpha', 'beta', 1, 0)])],
      },
      seasonStartLevels: { alpha: 1 as const, beta: 1 as const },
      observationRecord: undefined,
    };

    expect(buildObserverSeasonTrajectory(world, 'alpha', null)?.theme).toBeUndefined();
  });

  it('replaces the same season and caps archived focus seasons', () => {
    const trajectory = (seasonNumber: number, teamId = 'alpha'): ObserverSeasonTrajectory => ({
      seasonNumber,
      teamId,
      leagueLevel: 1,
      checkpoints: [],
    });
    const existing = Array.from(
      { length: OBSERVER_SEASON_TRAJECTORY_LIMIT },
      (_, index) => trajectory(index + 1),
    );
    const world = { observerSeasonTrajectories: existing } as never;

    const replaced = appendObserverSeasonTrajectory(world, trajectory(40, 'beta'));
    expect(replaced.observerSeasonTrajectories).toHaveLength(OBSERVER_SEASON_TRAJECTORY_LIMIT);
    expect(replaced.observerSeasonTrajectories?.at(-1)).toMatchObject({ seasonNumber: 40, teamId: 'beta' });

    const appended = appendObserverSeasonTrajectory(replaced, trajectory(41));
    expect(appended.observerSeasonTrajectories?.[0].seasonNumber).toBe(2);
    expect(appended.observerSeasonTrajectories?.at(-1)?.seasonNumber).toBe(41);
  });
});

import { describe, expect, it } from 'vitest';
import type { SeasonRecord } from '../../types/team';
import { initializeGameWorld } from '../season/season-manager';
import {
  describeObservationThemeResult,
  type ObservationThemeResult,
} from './observation-theme-result';
import type { ObserverSeasonTrajectory } from './season-trajectory';

function record(overrides: Partial<SeasonRecord> = {}): SeasonRecord {
  return {
    seasonNumber: 1,
    leagueLevel: 1,
    leaguePosition: 5,
    leaguePlayed: 30,
    leagueWon: 15,
    leagueDrawn: 8,
    leagueLost: 7,
    leagueGF: 48,
    leagueGA: 31,
    leaguePoints: 53,
    coachId: 'coach',
    promoted: false,
    relegated: false,
    ...overrides,
  };
}

function trajectory(
  teamId: string,
  type: NonNullable<ObserverSeasonTrajectory['theme']>['type'],
  playerId?: string,
): ObserverSeasonTrajectory {
  return {
    seasonNumber: 1,
    teamId,
    leagueLevel: 1,
    checkpoints: [],
    theme: { type, ...(playerId ? { playerId } : {}) },
  };
}

describe('completed observation theme results', () => {
  it('derives giant and dark-horse verdicts from the final season record', () => {
    const world = initializeGameWorld(20260718);
    const elite = Object.values(world.teamBases).find(team => team.tier === 'elite')!;
    const challenger = Object.values(world.teamBases).find(team => team.expectation === 3)!;

    const giant = describeObservationThemeResult(
      world,
      trajectory(elite.id, 'giant_defense'),
      record({ leaguePosition: 1, leaguePoints: 72 }),
    );
    const darkHorse = describeObservationThemeResult(
      world,
      trajectory(challenger.id, 'dark_horse_challenge'),
      record({ leaguePosition: 2, leaguePoints: 65 }),
    );

    expect(giant).toMatchObject({ verdict: '联赛夺冠', tone: 'positive' });
    expect(giant?.evidence).toContain('最终第1名');
    expect(darkHorse?.tone).toBe('positive');
    expect(darkHorse?.summary).toContain('赛前');
  });

  it.each([
    [{ promoted: true, relegated: false, leagueLevel: 2, leaguePosition: 1 }, '成功升级', 'positive'],
    [{ promoted: false, relegated: true, leagueLevel: 1, leaguePosition: 16 }, '遗憾降级', 'caution'],
    [{ promoted: false, relegated: false, leagueLevel: 1, leaguePosition: 10 }, '完成保级', 'positive'],
  ] as const)('uses canonical promotion flags for %s', (overrides, verdict, tone) => {
    const world = initializeGameWorld(20260718);
    const teamId = Object.keys(world.teamBases)[0];
    const archived = trajectory(teamId, 'promotion_survival');
    archived.leagueLevel = overrides.leagueLevel;
    const result = describeObservationThemeResult(world, archived, record(overrides));

    expect(result).toMatchObject({ verdict, tone });
  });

  it('reads player contribution from the existing season stat source', () => {
    const world = initializeGameWorld(20260718);
    const teamId = Object.keys(world.squads)[0];
    const player = world.squads[teamId].find(candidate => candidate.position === 'FW')!;
    world.playerStats[player.uuid] = {
      ...world.playerStats[player.uuid],
      appearances: 18,
      starts: 14,
      minutesPlayed: 1320,
      goals: 7,
      assists: 4,
    };

    const result = describeObservationThemeResult(
      world,
      trajectory(teamId, 'player_growth', player.uuid),
      record(),
    );

    expect(result).toMatchObject({
      verdict: '成为轮换核心',
      playerId: player.uuid,
    });
    expect(result?.evidence).toEqual(expect.arrayContaining(['18次出场', '7球 · 4助攻']));
  });

  it('keeps pure observation neutral and returns nothing for older trajectories without a theme', () => {
    const world = initializeGameWorld(20260718);
    const teamId = Object.keys(world.teamBases)[0];
    const pure = describeObservationThemeResult(
      world,
      trajectory(teamId, 'pure_observation'),
      record(),
    );
    const oldTrajectory = trajectory(teamId, 'pure_observation');
    delete oldTrajectory.theme;

    expect(pure).toMatchObject({ verdict: '世界继续演化', tone: 'neutral' });
    expect(describeObservationThemeResult(world, oldTrajectory, record())).toBeNull();
  });

  it('returns compact evidence without mutating historical records', () => {
    const world = initializeGameWorld(20260718);
    const teamId = Object.keys(world.teamBases)[0];
    const finalRecord = record();
    const before = structuredClone(finalRecord);
    const result: ObservationThemeResult | null = describeObservationThemeResult(
      world,
      trajectory(teamId, 'giant_defense'),
      finalRecord,
    );

    expect(result?.evidence.length).toBeLessThanOrEqual(3);
    expect(finalRecord).toEqual(before);
  });
});

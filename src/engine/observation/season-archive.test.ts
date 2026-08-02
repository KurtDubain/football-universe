import { describe, expect, it } from 'vitest';
import { initializeGameWorld } from '../season/season-manager';
import type { SeasonRecord } from '../../types/team';
import type { ObserverSeasonTrajectory } from './season-trajectory';
import {
  buildSeasonObservationArchive,
  describeObserverImpression,
} from './season-archive';
import { seasonArchiveFilename } from './season-archive-image';

function judgment(total: number, correct: number) {
  return { total, correct, currentStreak: Math.min(correct, 2), bestStreak: Math.min(correct, 3) };
}

function trajectory(
  teamId: string,
  overrides: Partial<ObserverSeasonTrajectory> = {},
): ObserverSeasonTrajectory {
  return {
    seasonNumber: 1,
    teamId,
    leagueLevel: 1,
    expectedPosition: 5,
    checkpoints: [
      { phase: 'opening', played: 4, position: 5, points: 7, goalDifference: 1 },
      { phase: 'midseason', played: 8, position: 4, points: 15, goalDifference: 3 },
      { phase: 'run_in', played: 12, position: 3, points: 24, goalDifference: 6 },
      { phase: 'final', played: 16, position: 2, points: 34, goalDifference: 10 },
    ],
    ...overrides,
  };
}

function record(overrides: Partial<SeasonRecord> = {}): SeasonRecord {
  return {
    seasonNumber: 1,
    leagueLevel: 1,
    leaguePosition: 2,
    leaguePlayed: 16,
    leagueWon: 10,
    leagueDrawn: 4,
    leagueLost: 2,
    leagueGF: 31,
    leagueGA: 13,
    leaguePoints: 34,
    coachId: 'coach',
    promoted: false,
    relegated: false,
    ...overrides,
  };
}

describe('season observation archive', () => {
  it('keeps zero and small samples descriptive instead of rating accuracy', () => {
    expect(describeObserverImpression(undefined)).toMatchObject({
      label: '纯粹见证者',
      sampleState: 'none',
    });
    expect(describeObserverImpression(judgment(4, 4))).toMatchObject({
      label: '记录形成中',
      sampleState: 'forming',
    });
  });

  it('uses restrained, testable impressions after five judgments', () => {
    expect(describeObserverImpression(judgment(8, 6)).label).toBe('洞察潮向');
    expect(describeObserverImpression(judgment(9, 5)).label).toBe('稳定观察');
    expect(describeObserverImpression(judgment(8, 3))).toMatchObject({
      label: '仍在校准',
      sampleState: 'rated',
    });
  });

  it('derives final fate, cup path and next hook from frozen season facts', () => {
    const world = initializeGameWorld(20260730);
    const teamId = Object.keys(world.teamBases)[0];
    const archive = buildSeasonObservationArchive(
      world,
      trajectory(teamId, { judgment: judgment(6, 4) }),
      record({ promoted: true, leagueLevel: 2, cupResult: '四强' }),
    );

    expect(archive.finalFate).toMatchObject({
      label: '成功升级',
      expectedPosition: 5,
      positionDelta: 3,
    });
    expect(archive.cupPaths).toEqual([{ label: '联赛杯', result: '四强' }]);
    expect(archive.nextWatch).toContain('更高舞台');
    expect(archive.judgment.accuracy).toBeCloseTo(2 / 3);
  });

  it('recognizes a league champion without requiring a cup trophy', () => {
    const world = initializeGameWorld(20260730);
    const teamId = Object.keys(world.teamBases)[0];
    const archive = buildSeasonObservationArchive(
      world,
      trajectory(teamId),
      record({ leaguePosition: 1, cupResult: undefined, superCupResult: undefined }),
    );

    expect(archive.finalFate.label).toBe('联赛夺冠');
    expect(archive.cupPaths).toEqual([]);
    expect(archive.nextWatch).toContain('守住王座');
  });

  it('resolves the frozen representative by UUID rather than duplicate name', () => {
    const initial = initializeGameWorld(20260730);
    const teamId = Object.keys(initial.squads)[0];
    const [first, second] = initial.squads[teamId];
    const world = {
      ...initial,
      squads: {
        ...initial.squads,
        [teamId]: initial.squads[teamId].map(player =>
          player.uuid === first.uuid || player.uuid === second.uuid
            ? { ...player, name: '同名球员' }
            : player,
        ),
      },
      playerStats: {
        ...initial.playerStats,
        [first.uuid]: { ...initial.playerStats[first.uuid], appearances: 8, goals: 7 },
        [second.uuid]: { ...initial.playerStats[second.uuid], appearances: 12, goals: 1 },
      },
    };
    const archive = buildSeasonObservationArchive(
      world,
      trajectory(teamId, { representativePlayerId: second.uuid }),
      record(),
    );

    expect(archive.representative?.playerId).toBe(second.uuid);
    expect(archive.representative?.identity.playerName).toBe('同名球员');
  });

  it('uses a stable export filename without randomness', () => {
    expect(seasonArchiveFilename(12)).toBe('football-universe-S12-observer-archive.png');
    expect(seasonArchiveFilename(12)).toBe(seasonArchiveFilename(12));
  });
});

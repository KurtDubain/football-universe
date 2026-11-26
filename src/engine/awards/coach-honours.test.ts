import { describe, expect, it } from 'vitest';
import type { SeasonRecord } from '../../types/team';
import { initializeGameWorld, type GameWorld } from '../season/season-manager';
import { deriveCoachHonours, expectedPositionFor, leagueOneRecords } from './coach-honours';

const SEED = 20260722;

function record(seasonNumber: number, leaguePosition: number, coachId: string): SeasonRecord {
  return {
    seasonNumber,
    leagueLevel: 1,
    leaguePosition,
    leaguePlayed: 30,
    leagueWon: 0,
    leagueDrawn: 0,
    leagueLost: 0,
    leagueGF: 0,
    leagueGA: 0,
    leaguePoints: 0,
    coachId,
    promoted: false,
    relegated: false,
  };
}

/** Pin each club's pre-season expectation so the baseline is not a fixture of the seed. */
function withExpectations(world: GameWorld, expectations: Record<string, number>): GameWorld {
  const teamBases = { ...world.teamBases };
  for (const [teamId, expectation] of Object.entries(expectations)) {
    teamBases[teamId] = { ...teamBases[teamId], expectation };
  }
  return { ...world, teamBases };
}

/** A top-flight table for one season, with a named coach behind every club. */
function withTable(
  world: GameWorld,
  rows: Array<{ teamId: string; position: number; coachId: string }>,
  seasonNumber = 1,
): GameWorld {
  const teamSeasonRecords: GameWorld['teamSeasonRecords'] = {};
  const coachBases = { ...world.coachBases };
  const template = Object.values(world.coachBases)[0];
  for (const row of rows) {
    teamSeasonRecords[row.teamId] = [record(seasonNumber, row.position, row.coachId)];
    coachBases[row.coachId] = { ...template, id: row.coachId, name: row.coachId + ' 教练' };
  }
  return { ...world, teamSeasonRecords, coachBases };
}

describe('expectedPositionFor', () => {
  it('reads the expected finish from the club own pre-season expectation', () => {
    const world = initializeGameWorld(SEED);
    const [teamId] = Object.keys(world.teamBases);
    expect(expectedPositionFor(withExpectations(world, { [teamId]: 5 }), teamId, 16)).toBe(0);
    expect(expectedPositionFor(withExpectations(world, { [teamId]: 3 }), teamId, 16)).toBe(8);
    expect(expectedPositionFor(withExpectations(world, { [teamId]: 1 }), teamId, 16)).toBe(16);
  });

  it('falls back to a mid-table expectation for a club it does not know', () => {
    const world = initializeGameWorld(SEED);
    expect(expectedPositionFor(world, 'not-a-club', 16)).toBe(8);
  });
});

describe('leagueOneRecords', () => {
  it('keeps only the top flight and orders it by final position', () => {
    const world = initializeGameWorld(SEED);
    const [first, second] = Object.keys(world.teamBases);
    const withRecords: GameWorld = {
      ...world,
      teamSeasonRecords: {
        [first]: [record(1, 4, 'c1'), { ...record(1, 1, 'c1'), leagueLevel: 2 }],
        [second]: [record(1, 2, 'c2')],
      },
    };

    const rows = leagueOneRecords(withRecords, 1);
    expect(rows.map(row => row.teamId)).toEqual([second, first]);
    expect(rows.every(row => row.leagueLevel === 1)).toBe(true);
  });

  it('returns nothing for a season that has not been played', () => {
    expect(leagueOneRecords(initializeGameWorld(SEED), 1)).toEqual([]);
  });
});

describe('deriveCoachHonours', () => {
  it('gives the champion a card of its own and the biggest overperformance the other', () => {
    const world = initializeGameWorld(SEED);
    const ids = Object.keys(world.teamBases).slice(0, 4);
    const pinned = withExpectations(world, {
      [ids[0]]: 5,
      [ids[1]]: 5,
      [ids[2]]: 1,
      [ids[3]]: 1,
    });
    // Expectation 5 expects first, expectation 1 expects last, in a four-club flight.
    const table = withTable(pinned, [
      { teamId: ids[0], position: 1, coachId: 'c1' },
      { teamId: ids[1], position: 2, coachId: 'c2' },
      { teamId: ids[2], position: 3, coachId: 'c3' },
      { teamId: ids[3], position: 4, coachId: 'c4' },
    ]);

    const honours = deriveCoachHonours(table, 1);
    expect(honours).toHaveLength(2);

    expect(honours[0].kind).toBe('champion_coach');
    expect(honours[0].teamId).toBe(ids[0]);
    expect(honours[0].coachName).toBe('c1 教练');
    expect(honours[0].leaguePosition).toBe(1);

    expect(honours[1].kind).toBe('best_coach');
    expect(honours[1].teamId).toBe(ids[2]);
    expect(honours[1].leaguePosition).toBe(3);
    expect(honours[1].overperformance).toBe(1);
  });

  it('never hands both cards to the same club', () => {
    const world = initializeGameWorld(SEED);
    const ids = Object.keys(world.teamBases).slice(0, 3);
    // A bottom-seeded champion: the only club that beat its expectation by a mile.
    const pinned = withExpectations(world, { [ids[0]]: 1, [ids[1]]: 5, [ids[2]]: 5 });
    const table = withTable(pinned, [
      { teamId: ids[0], position: 1, coachId: 'c1' },
      { teamId: ids[1], position: 2, coachId: 'c2' },
      { teamId: ids[2], position: 3, coachId: 'c3' },
    ]);

    const honours = deriveCoachHonours(table, 1);
    expect(honours).toHaveLength(2);
    expect(honours[0].teamId).toBe(ids[0]);
    expect(honours[1].teamId).not.toBe(honours[0].teamId);
  });

  it('prints nothing when the top flight produced no table', () => {
    expect(deriveCoachHonours(initializeGameWorld(SEED), 1)).toEqual([]);
  });
});

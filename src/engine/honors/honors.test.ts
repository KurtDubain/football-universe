import { describe, expect, it } from 'vitest';
import { initializeGameWorld, executeCurrentWindow } from '../season/season-manager';
import { handleSeasonEnd } from '../season/season-end';
import { generateTeamTrophies } from './honors';
import { repairLeagueHonors as repair } from './repair-league-honors';
import type { SeasonRecord, Trophy } from '../../types/team';

function repairLeagueHonors(world: Parameters<typeof repair>[0]) {
  const skippedCoaches: (Trophy & { teamId: string })[] = [];
  return { world: repair(world, (teamId, trophy) => skippedCoaches.push({ teamId, ...trophy })), skippedCoaches };
}

function legacy() {
  const world = initializeGameWorld(20260709);
  const teamId = Object.keys(world.teamBases)[0];
  const coachId = Object.keys(world.coachStates).find(id => world.coachStates[id].currentTeamId === teamId)!;
  world.seasonState.seasonNumber = 2;
  world.teamSeasonRecords[teamId] = [{
    seasonNumber: 1, leagueLevel: 3, leaguePosition: 1, leaguePlayed: 14,
    leagueWon: 9, leagueDrawn: 2, leagueLost: 3, leagueGF: 25, leagueGA: 10,
    leaguePoints: 29, coachId, promoted: true, relegated: false,
  }];
  return { world, teamId, coachId };
}

describe('league title attribution', () => {
  it.each([1, 2, 3] as const)('awards level %i winners independently of their next division', level => {
    const winners = ['a', 'b', 'c'];
    expect(generateTeamTrophies(winners[level - 1], 1, 'a', 'b', 'c', '', '', undefined))
      .toEqual([{ type: `league${level}`, seasonNumber: 1 }]);
  });
  it('does not award a title to promoted non-champions and preserves cup doubles', () => {
    expect(generateTeamTrophies('d', 1, 'a', 'b', 'c', '', '', undefined)).toEqual([]);
    expect(generateTeamTrophies('b', 1, 'a', 'b', 'c', 'b', '', undefined)).toEqual([
      { type: 'league2', seasonNumber: 1 }, { type: 'league_cup', seasonNumber: 1 },
    ]);
  });
  it('repairs only honor fields, preserves cups and is immutable and idempotent', () => {
    const { world, teamId, coachId } = legacy();
    world.teamTrophies[teamId] = [{ type: 'mainland_cup', seasonNumber: 1 }];
    const before = structuredClone(world);
    const repaired = repairLeagueHonors(world);
    expect(world).toEqual(before);
    expect(repaired.skippedCoaches).toEqual([]);
    const trophy = { type: 'league3', seasonNumber: 1 };
    expect(repaired.world.teamTrophies[teamId]).toEqual([...world.teamTrophies[teamId], trophy]);
    expect(repaired.world.coachTrophies[coachId]).toContainEqual(trophy);
    expect(repaired.world.coachCareers[coachId][0].trophies).toContainEqual(trophy);
    for (const key of Object.keys(world) as (keyof typeof world)[]) {
      if (!['teamTrophies', 'coachTrophies', 'coachCareers', 'coachRetirementHistory'].includes(key)) {
        expect(repaired.world[key], key).toBe(world[key]);
      }
    }
    expect(repairLeagueHonors(repaired.world).world).toBe(repaired.world);
    const loaded = JSON.parse(JSON.stringify(repaired.world));
    expect(repairLeagueHonors(loaded).world).toEqual(repaired.world);
  });
  it('uses retirement evidence rather than the successor recorded by legacy season end', () => {
    const { world, teamId, coachId } = legacy();
    world.coachCareers[coachId][0].toSeason = 1;
    world.coachBases.successor = { ...world.coachBases[coachId], id: 'successor' };
    world.coachCareers.successor = [{ ...world.coachCareers[coachId][0], toSeason: null, trophies: [] }];
    world.teamSeasonRecords[teamId][0].coachId = 'successor';
    world.coachRetirementHistory = [{ id: coachId, name: 'Retiree', age: 72, seasonRetired: 1,
      totalSeasons: 1, trophies: [], finalTeamId: teamId, finalTeamName: 'Club' }];
    const { world: fixed } = repairLeagueHonors(world);
    expect(fixed.coachTrophies[coachId]).toContainEqual({ type: 'league3', seasonNumber: 1 });
    expect(fixed.coachCareers[coachId][0].trophies).toEqual(fixed.coachTrophies[coachId]);
    expect(fixed.coachRetirementHistory[0].trophies).toEqual(fixed.coachTrophies[coachId]);
    expect(fixed.coachCareers.successor[0].trophies).toEqual([]);
    expect(fixed.coachTrophies.successor).toBeUndefined();
  });
  it.each(['missing', 'overlap', 'conflict', 'new-tenure'])('skips uncertain coach ownership: %s', reason => {
    const { world, teamId, coachId } = legacy();
    if (reason === 'missing') world.coachCareers = {};
    if (reason === 'overlap') world.coachCareers.other = structuredClone(world.coachCareers[coachId]);
    if (reason === 'conflict') world.coachTrophies.other = [{ type: 'league3', seasonNumber: 1 }];
    if (reason === 'new-tenure') {
      world.teamSeasonRecords[teamId][0].seasonNumber = 2;
      world.coachCareers[coachId][0].fromSeason = 2;
    }
    const fixed = repairLeagueHonors(world);
    expect(fixed.skippedCoaches).toEqual([{ teamId, type: 'league3', seasonNumber: reason === 'new-tenure' ? 2 : 1 }]);
    expect(fixed.world.teamTrophies[teamId]).toHaveLength(1);
    expect(fixed.world.coachTrophies).toEqual(world.coachTrophies);
    expect(fixed.world.coachCareers).toEqual(world.coachCareers);
  });
  it('does not infer a winner when retained records conflict', () => {
    const { world, teamId } = legacy();
    const other = Object.keys(world.teamBases)[1];
    world.teamSeasonRecords[other] = structuredClone(world.teamSeasonRecords[teamId]);
    expect(repairLeagueHonors(world).world).toBe(world);
  });
  it('deduplicates honor records and repairs a team without inventing an absent coach history', () => {
    const { world, teamId } = legacy();
    const honor = { seasonNumber: 1, league1Champion: '', league2Champion: '', league3Champion: teamId,
      leagueCupWinner: '', superCupWinner: '', promoted: [], relegated: [], coachChanges: [] };
    world.honorHistory = [honor, structuredClone(honor)];
    world.teamSeasonRecords = {};
    const fixed = repairLeagueHonors(world);
    expect(fixed.world.teamTrophies[teamId]).toEqual([{ type: 'league3', seasonNumber: 1 }]);
    expect(fixed.world.coachTrophies).toEqual(world.coachTrophies);
    expect(fixed.skippedCoaches).toHaveLength(1);
    expect(repairLeagueHonors(fixed.world).world).toBe(fixed.world);
  });
  it('does not backfill conflicting championship evidence or non-champion promotion', () => {
    const { world, teamId } = legacy();
    world.teamSeasonRecords[teamId][0].leaguePosition = 2;
    expect(repairLeagueHonors(world).world).toBe(world);
    world.honorHistory = [{ seasonNumber: 1, league1Champion: '', league2Champion: '', league3Champion: teamId,
      leagueCupWinner: '', superCupWinner: '', promoted: [], relegated: [], coachChanges: [] }];
    expect(repairLeagueHonors(world).world).toBe(world);
  });
  it('keeps new season trophies, careers and retiring coach snapshot aligned for the real seed', () => {
    let world = initializeGameWorld(20260709);
    while (world.seasonState.calendar[world.seasonState.currentWindowIndex]?.type !== 'season_end') {
      world = executeCurrentWindow(world).world;
    }
    const champions = [world.league1Standings[0].teamId, world.league2Standings[0].teamId, world.league3Standings[0].teamId];
    const coachId = Object.keys(world.coachStates).find(id => world.coachStates[id].currentTeamId === champions[2])!;
    world.coachBases[coachId] = { ...world.coachBases[coachId], age: 72 };
    const before = structuredClone(world);
    const result = handleSeasonEnd(world);
    expect(world).toEqual(before);
    champions.forEach((id, i) => expect(result.teamTrophies[id]).toContainEqual({ type: `league${i + 1}`, seasonNumber: 1 }));
    const trophy = { type: 'league3', seasonNumber: 1 };
    expect(result.coachTrophies[coachId]).toContainEqual(trophy);
    expect(result.coachCareers[coachId].at(-1)?.trophies).toContainEqual(trophy);
    expect(result.coachRetirementHistory.find(r => r.id === coachId)?.trophies).toContainEqual(trophy);
    expect((result.teamSeasonRecords[champions[2]].at(-1) as SeasonRecord).coachId).toBe(coachId);
    expect(repairLeagueHonors(result).world).toBe(result);
  }, 15000);
});

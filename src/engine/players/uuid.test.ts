import { describe, it, expect } from 'vitest';
import { generateAllSquads, formatPlayerUuid } from './generator';
import { createInitialPlayerStats, updatePlayerStatsFromResults } from './stats';
import { processTransferWindow } from '../transfers/transfer-window';
import { SeededRNG } from '../match/rng';
import { TeamBase } from '../../types/team';
import { GameWorld } from '../season/season-manager';
import { Player, PlayerSeasonStats } from '../../types/player';

function makeTeam(id: string, overall: number): TeamBase {
  return {
    id,
    name: id,
    shortName: id.slice(0, 3),
    color: '#000000',
    tier: overall >= 82 ? 'elite' : overall >= 65 ? 'mid' : 'lower',
    overall,
    attack: overall,
    midfield: overall,
    defense: overall,
    stability: overall,
    depth: overall,
    reputation: overall,
    initialLeagueLevel: 1,
    expectation: 3,
    region: '大陆+测试',
  };
}

describe('Player UUID generation', () => {
  it('formatPlayerUuid produces strings of the form `p-<n>`', () => {
    expect(formatPlayerUuid(0)).toBe('p-0');
    expect(formatPlayerUuid(42)).toBe('p-42');
  });

  it('generateAllSquads assigns unique uuids to every generated player', () => {
    const teams = [makeTeam('a', 80), makeTeam('b', 75), makeTeam('c', 70)];
    const { squads, nextPlayerUuidCounter } = generateAllSquads(teams, 2024);

    const allUuids = Object.values(squads).flatMap(sq => sq.map(p => p.uuid));
    expect(new Set(allUuids).size).toBe(allUuids.length);
    expect(allUuids.every(u => u.startsWith('p-'))).toBe(true);

    // Counter equals total players generated
    const totalPlayers = Object.values(squads).reduce((n, sq) => n + sq.length, 0);
    expect(nextPlayerUuidCounter).toBe(totalPlayers);
  });

  it('uuid generation is deterministic for the same seed', () => {
    const teams = [makeTeam('a', 80), makeTeam('b', 75)];
    const a = generateAllSquads(teams, 1234);
    const b = generateAllSquads(teams, 1234);

    for (const tid of Object.keys(a.squads)) {
      const aUuids = a.squads[tid].map(p => p.uuid);
      const bUuids = b.squads[tid].map(p => p.uuid);
      expect(aUuids).toEqual(bUuids);
    }
  });
});

/**
 * Smoke test the whole transfer-uuid invariant end-to-end:
 *   1. Generate two synthetic teams.
 *   2. Build playerStats keyed by uuid.
 *   3. Force a transfer.
 *   4. Assert: the transferred player's uuid is the SAME, but their teamId
 *      and number changed; their playerStats entry survives unchanged in
 *      both the keys-set and the playerId field.
 */
describe('UUID stability across transfer (integration)', () => {
  function buildWorld(): GameWorld {
    const elite = makeTeam('elite', 90);
    const weak = makeTeam('weak', 65);

    const eliteSquad: Player[] = [
      { uuid: 'p-1', teamId: 'elite', name: 'A', number: 9, position: 'FW', rating: 85, peakRating: 85, peakAge: 27, goalScoring: 80, marketValue: 50, age: 28 },
      { uuid: 'p-2', teamId: 'elite', name: 'B', number: 10, position: 'FW', rating: 80, peakRating: 80, peakAge: 27, goalScoring: 75, marketValue: 40, age: 27 },
      { uuid: 'p-3', teamId: 'elite', name: 'C', number: 11, position: 'FW', rating: 75, peakRating: 75, peakAge: 27, goalScoring: 70, marketValue: 30, age: 26 },
      { uuid: 'p-4', teamId: 'elite', name: 'D', number: 17, position: 'FW', rating: 70, peakRating: 70, peakAge: 27, goalScoring: 60, marketValue: 20, age: 25 },
      { uuid: 'p-5', teamId: 'elite', name: 'GK', number: 1, position: 'GK', rating: 88, peakRating: 88, peakAge: 27, goalScoring: 1, marketValue: 30, age: 30 },
    ];
    const weakSquad: Player[] = [
      { uuid: 'p-101', teamId: 'weak', name: 'Cand', number: 9, position: 'FW', rating: 78, peakRating: 78, peakAge: 27, goalScoring: 80, marketValue: 15, age: 24 },
      { uuid: 'p-102', teamId: 'weak', name: 'F', number: 10, position: 'FW', rating: 72, peakRating: 72, peakAge: 27, goalScoring: 65, marketValue: 8, age: 25 },
      { uuid: 'p-103', teamId: 'weak', name: 'G', number: 11, position: 'FW', rating: 68, peakRating: 68, peakAge: 27, goalScoring: 60, marketValue: 5, age: 26 },
      { uuid: 'p-104', teamId: 'weak', name: 'H', number: 17, position: 'FW', rating: 60, peakRating: 60, peakAge: 27, goalScoring: 50, marketValue: 3, age: 27 },
      { uuid: 'p-105', teamId: 'weak', name: 'GK', number: 1, position: 'GK', rating: 65, peakRating: 65, peakAge: 27, goalScoring: 0, marketValue: 5, age: 28 },
    ];

    const playerStats: Record<string, PlayerSeasonStats> = {
      'p-101': { playerId: 'p-101', teamId: 'weak', goals: 10, assists: 4, yellowCards: 2, redCards: 0, appearances: 30, cleanSheets: 0, saves: 0, keyBlocks: 0, bigChances: 0, keyPasses: 0 },
      'p-102': { playerId: 'p-102', teamId: 'weak', goals: 3, assists: 1, yellowCards: 1, redCards: 0, appearances: 28, cleanSheets: 0, saves: 0, keyBlocks: 0, bigChances: 0, keyPasses: 0 },
      'p-1': { playerId: 'p-1', teamId: 'elite', goals: 8, assists: 5, yellowCards: 0, redCards: 0, appearances: 30, cleanSheets: 0, saves: 0, keyBlocks: 0, bigChances: 0, keyPasses: 0 },
    };

    return {
      seasonState: {
        seasonNumber: 1, currentWindowIndex: 5, calendar: [], completed: false,
        isWorldCupYear: false, worldCupPhase: false,
      },
      teamBases: { elite, weak },
      teamStates: {} as never,
      coachBases: {}, coachStates: {}, coachCareers: {},
      league1Standings: [], league2Standings: [], league3Standings: [],
      leagueCup: undefined as never, superCup: undefined as never, worldCup: null,
      honorHistory: [], teamTrophies: {}, coachTrophies: {}, teamSeasonRecords: {},
      coachChangesThisSeason: [],
      squads: { elite: eliteSquad, weak: weakSquad },
      playerStats,
      nextPlayerUuidCounter: 200,
      activeEvents: [], achievements: [], newsLog: [],
      seed: 1, rngState: 1,
      seasonStartLevels: {}, seasonBuffs: [],
      godHandUsed: false, coins: 0, bets: [],
      matchHistory: [], seasonBuffsHistory: [],
      playerAwardsHistory: [], transferHistory: [], memorableMatches: [], continentalCups: { mainland_cup: null, southern_cup: null, eastern_cup: null }, totalElapsedWindows: 0, teamFinances: {}, freeAgentPool: [], transferRumors: [], playerStatsHistory: {}, transferWindow: null,
      retirementHistory: [], coachCandidatePool: [],
      coachRetirementHistory: [], nextCoachIdCounter: 0,
    };
  }

  it('candidate uuid persists across the swap; playerStats entry follows', () => {
    const world = buildWorld();
    const beforeStats = world.playerStats['p-101'];

    // Probe seeds for one that fires a transfer
    let result = processTransferWindow(world, new SeededRNG(0));
    let s = 0;
    while (result.transfers.length === 0 && s < 50) {
      s++;
      result = processTransferWindow(world, new SeededRNG(s));
    }
    expect(result.transfers.length).toBeGreaterThan(0);

    // Candidate moved to elite (uuid unchanged, teamId now 'elite')
    const movedCandidate = result.squads['elite'].find(p => p.uuid === 'p-101');
    expect(movedCandidate).toBeDefined();
    expect(movedCandidate!.teamId).toBe('elite');

    // playerStats key 'p-101' still exists, value's teamId follows the player
    expect(result.playerStats['p-101']).toBeDefined();
    expect(result.playerStats['p-101'].teamId).toBe('elite');
    expect(result.playerStats['p-101'].goals).toBe(beforeStats.goals);
    expect(result.playerStats['p-101'].assists).toBe(beforeStats.assists);
  });

  it('appearances accumulate by uuid across a transfer (cross-season carryover)', () => {
    const world = buildWorld();

    // Fire transfer
    let result = processTransferWindow(world, new SeededRNG(0));
    let s = 0;
    while (result.transfers.length === 0 && s < 50) {
      s++;
      result = processTransferWindow(world, new SeededRNG(s));
    }
    expect(result.transfers.length).toBeGreaterThan(0);

    // Build a fresh empty stats record for the new "season" with the
    // post-transfer squads — the candidate's uuid is in the elite squad now,
    // so a stat row appears under elite's teamId.
    const newSeasonStats = createInitialPlayerStats(result.squads);
    expect(newSeasonStats['p-101']).toBeDefined();
    expect(newSeasonStats['p-101'].teamId).toBe('elite');

    // updatePlayerStatsFromResults indexes by uuid → an event with
    // playerId='p-101' increments the right row.
    const updated = updatePlayerStatsFromResults(
      newSeasonStats,
      [{
        fixtureId: 'F1',
        homeTeamId: 'elite', awayTeamId: 'weak',
        homeGoals: 1, awayGoals: 0,
        extraTime: false, penalties: false,
        events: [{ minute: 10, type: 'goal', teamId: 'elite', playerId: 'p-101', description: 'goal' }],
        stats: { possession: [55, 45], shots: [10, 5], shotsOnTarget: [5, 2], corners: [4, 2], fouls: [10, 12], yellowCards: [1, 2], redCards: [0, 0] },
        competitionType: 'league', competitionName: 'L1', roundLabel: 'R1',
      }],
      result.squads,
    );
    expect(updated['p-101'].goals).toBe(1);
  });
});

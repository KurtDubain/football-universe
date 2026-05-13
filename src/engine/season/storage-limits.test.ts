import { describe, it, expect } from 'vitest';
import {
  enforceStorageLimits,
  MATCH_HISTORY_SEASONS,
  TRANSFER_HISTORY_SEASONS,
  PLAYER_AWARDS_SEASONS,
  TEAM_SEASON_RECORDS_PER_TEAM,
} from './storage-limits';
import type { GameWorld, MatchHistoryEntry } from './season-manager';
import type { TransferRecord } from '../../types/transfer';
import type { PlayerAward } from '../../types/award';
import type { SeasonRecord } from '../../types/team';

/** Build a minimum-viable world stub with whatever fields a test needs to override. */
function buildWorld(overrides: Partial<GameWorld>): GameWorld {
  const base: Partial<GameWorld> = {
    seasonState: { seasonNumber: 100, currentWindowIndex: 0, calendar: [], completed: false, isWorldCupYear: false, worldCupPhase: false } as GameWorld['seasonState'],
    matchHistory: [],
    transferHistory: [],
    playerAwardsHistory: [],
    teamSeasonRecords: {},
    coachCareers: {},
    honorHistory: [],
    newsLog: [],
    teamBases: {},
    teamStates: {},
    coachBases: {},
    coachStates: {},
    teamTrophies: {},
    coachTrophies: {},
    league1Standings: [],
    league2Standings: [],
    league3Standings: [],
    leagueCup: undefined!,
    superCup: undefined!,
    worldCup: null,
    coachChangesThisSeason: [],
    squads: {},
    playerStats: {},
    activeEvents: [],
    achievements: [],
    seed: 1,
    rngState: 1,
    seasonStartLevels: {},
    seasonBuffs: [],
    godHandUsed: false,
    coins: 0,
    bets: [],
    seasonBuffsHistory: [],
    memorableMatches: [],
  };
  return { ...base, ...overrides } as GameWorld;
}

function makeMatch(season: number, idx = 0): MatchHistoryEntry {
  return {
    season,
    homeId: `home-${season}-${idx}`,
    awayId: `away-${season}-${idx}`,
    homeGoals: 1,
    awayGoals: 0,
    comp: 'L1',
  };
}

function makeTransfer(season: number, idx = 0): TransferRecord {
  return {
    season,
    windowIndex: 0,
    playerId: `p-${season}-${idx}`,
    playerName: `P${season}-${idx}`,
    playerNumber: 9,
    position: 'FW',
    fromTeamId: 'a',
    fromTeamName: 'A',
    toTeamId: 'b',
    toTeamName: 'B',
    type: 'transfer',
    reason: 'test',
  };
}

function makeAward(season: number, idx = 0): PlayerAward {
  return {
    season,
    type: 'mvp',
    playerId: `p-${season}-${idx}`,
    playerName: `P${season}-${idx}`,
    playerNumber: 9,
    teamId: 't',
    teamName: 'T',
    statValue: 0,
    statLabel: '',
  };
}

function makeRecord(seasonNumber: number): SeasonRecord {
  return {
    seasonNumber,
    leagueLevel: 1,
    leaguePosition: 1,
    leaguePlayed: 30,
    leagueWon: 20,
    leagueDrawn: 5,
    leagueLost: 5,
    leagueGF: 60,
    leagueGA: 25,
    leaguePoints: 65,
    coachId: 'c1',
    promoted: false,
    relegated: false,
  };
}

describe('enforceStorageLimits', () => {
  it('matchHistory keeps only entries from the last MATCH_HISTORY_SEASONS seasons', () => {
    const currentSeason = 100;
    const matchHistory: MatchHistoryEntry[] = [];
    // 1 entry per season, seasons 1..100
    for (let s = 1; s <= currentSeason; s++) matchHistory.push(makeMatch(s));

    const world = buildWorld({
      seasonState: { ...buildWorld({}).seasonState, seasonNumber: currentSeason },
      matchHistory,
    });
    const out = enforceStorageLimits(world);

    // Cutoff is currentSeason - MATCH_HISTORY_SEASONS + 1 = 96
    const cutoff = currentSeason - MATCH_HISTORY_SEASONS + 1;
    expect(out.matchHistory).toHaveLength(MATCH_HISTORY_SEASONS);
    expect(out.matchHistory.every((m) => m.season >= cutoff)).toBe(true);
    expect(out.matchHistory[0].season).toBe(cutoff);
    expect(out.matchHistory[out.matchHistory.length - 1].season).toBe(currentSeason);
  });

  it('transferHistory keeps only the most recent TRANSFER_HISTORY_SEASONS seasons', () => {
    const currentSeason = 200;
    const transferHistory: TransferRecord[] = [];
    for (let s = 1; s <= currentSeason; s++) transferHistory.push(makeTransfer(s));

    const world = buildWorld({
      seasonState: { ...buildWorld({}).seasonState, seasonNumber: currentSeason },
      transferHistory,
    });
    const out = enforceStorageLimits(world);

    const cutoff = currentSeason - TRANSFER_HISTORY_SEASONS + 1;
    expect(out.transferHistory).toHaveLength(TRANSFER_HISTORY_SEASONS);
    expect(out.transferHistory[0].season).toBe(cutoff);
  });

  it('playerAwardsHistory keeps only the most recent PLAYER_AWARDS_SEASONS seasons', () => {
    const currentSeason = 300;
    const playerAwardsHistory: PlayerAward[] = [];
    // 4 awards/season is realistic
    for (let s = 1; s <= currentSeason; s++) {
      for (let i = 0; i < 4; i++) playerAwardsHistory.push(makeAward(s, i));
    }

    const world = buildWorld({
      seasonState: { ...buildWorld({}).seasonState, seasonNumber: currentSeason },
      playerAwardsHistory,
    });
    const out = enforceStorageLimits(world);

    const cutoff = currentSeason - PLAYER_AWARDS_SEASONS + 1;
    expect(out.playerAwardsHistory).toHaveLength(PLAYER_AWARDS_SEASONS * 4);
    expect(out.playerAwardsHistory.every((a) => a.season >= cutoff)).toBe(true);
  });

  it('teamSeasonRecords[teamId] is capped at TEAM_SEASON_RECORDS_PER_TEAM entries each', () => {
    const teamSeasonRecords: Record<string, SeasonRecord[]> = {
      teamA: [],
      teamB: [],
    };
    // teamA has 200 seasons; teamB has only 20 (under the cap)
    for (let s = 1; s <= 200; s++) teamSeasonRecords.teamA.push(makeRecord(s));
    for (let s = 1; s <= 20; s++) teamSeasonRecords.teamB.push(makeRecord(s));

    const world = buildWorld({ teamSeasonRecords });
    const out = enforceStorageLimits(world);

    expect(out.teamSeasonRecords.teamA).toHaveLength(TEAM_SEASON_RECORDS_PER_TEAM);
    // Last entry is preserved (most recent)
    expect(out.teamSeasonRecords.teamA[out.teamSeasonRecords.teamA.length - 1].seasonNumber).toBe(200);
    // First entry is the start of the trailing window
    expect(out.teamSeasonRecords.teamA[0].seasonNumber).toBe(200 - TEAM_SEASON_RECORDS_PER_TEAM + 1);
    // teamB unchanged (under cap)
    expect(out.teamSeasonRecords.teamB).toHaveLength(20);
    expect(out.teamSeasonRecords.teamB).toBe(teamSeasonRecords.teamB);
  });

  it('does not crash on empty/undefined arrays', () => {
    const world = buildWorld({
      matchHistory: undefined as unknown as MatchHistoryEntry[],
      transferHistory: undefined as unknown as TransferRecord[],
      playerAwardsHistory: undefined as unknown as PlayerAward[],
      teamSeasonRecords: undefined as unknown as Record<string, SeasonRecord[]>,
    });
    expect(() => enforceStorageLimits(world)).not.toThrow();
    const out = enforceStorageLimits(world);
    expect(out.matchHistory).toEqual([]);
    expect(out.transferHistory).toEqual([]);
    expect(out.playerAwardsHistory).toEqual([]);
    expect(out.teamSeasonRecords).toEqual({});
  });

  it('returns the same world reference when nothing exceeds the caps', () => {
    const matchHistory: MatchHistoryEntry[] = [makeMatch(99), makeMatch(100)];
    const transferHistory: TransferRecord[] = [makeTransfer(99)];
    const playerAwardsHistory: PlayerAward[] = [makeAward(100)];
    const teamSeasonRecords: Record<string, SeasonRecord[]> = { teamA: [makeRecord(100)] };

    const world = buildWorld({
      seasonState: { ...buildWorld({}).seasonState, seasonNumber: 100 },
      matchHistory,
      transferHistory,
      playerAwardsHistory,
      teamSeasonRecords,
    });
    const out = enforceStorageLimits(world);
    // Pure pass-through when nothing changes — preserves reference identity
    expect(out).toBe(world);
    expect(out.matchHistory).toBe(matchHistory);
    expect(out.transferHistory).toBe(transferHistory);
    expect(out.playerAwardsHistory).toBe(playerAwardsHistory);
  });

  it('does not mutate the input world', () => {
    const matchHistory: MatchHistoryEntry[] = [];
    for (let s = 1; s <= 50; s++) matchHistory.push(makeMatch(s));
    const inputLength = matchHistory.length;

    const world = buildWorld({
      seasonState: { ...buildWorld({}).seasonState, seasonNumber: 50 },
      matchHistory,
    });
    enforceStorageLimits(world);
    // Original array untouched
    expect(matchHistory).toHaveLength(inputLength);
    expect(world.matchHistory).toBe(matchHistory);
  });
});

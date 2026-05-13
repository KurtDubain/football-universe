import { describe, it, expect } from 'vitest';
import { processTransferWindow, applyTransferIdMap } from './transfer-window';
import { GameWorld } from '../season/season-manager';
import { SeededRNG } from '../match/rng';
import { Player, PlayerSeasonStats, PlayerPosition } from '../../types/player';
import { TeamBase } from '../../types/team';

// ── Test fixtures ─────────────────────────────────────────────────

function makeTeam(id: string, overall: number): TeamBase {
  return {
    id,
    name: id,
    shortName: id.slice(0, 3),
    color: '#000000',
    tier: overall >= 82 ? 'elite' : overall >= 76 ? 'strong' : overall >= 65 ? 'mid' : 'lower',
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

function makePlayer(
  teamId: string,
  number: number,
  position: PlayerPosition,
  rating: number,
): Player {
  return {
    id: `${teamId}-${number}`,
    teamId,
    name: `${teamId}-P${number}`,
    number,
    position,
    rating,
    goalScoring: 50,
    marketValue: 10,
    age: 26,
  };
}

function makeStat(playerId: string, teamId: string, goals = 0): PlayerSeasonStats {
  return {
    playerId,
    teamId,
    goals,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
    appearances: 30,
  };
}

/**
 * Build a minimal synthetic world with:
 *  - One elite team (overall 90) with 4 forwards rated 85, 80, 75, 70
 *  - One non-elite team (overall 65) with 4 forwards rated 78, 72, 68, 60
 *  - The non-elite top scorer (10 goals, rating 78) is a transfer candidate
 */
function buildWorld(): GameWorld {
  const elite = makeTeam('elite', 90);
  const weak = makeTeam('weak', 65);

  const eliteSquad: Player[] = [
    makePlayer('elite', 9, 'FW', 85),
    makePlayer('elite', 10, 'FW', 80),
    makePlayer('elite', 11, 'FW', 75),
    makePlayer('elite', 17, 'FW', 70),
    makePlayer('elite', 1, 'GK', 88),
  ];
  const weakSquad: Player[] = [
    makePlayer('weak', 9, 'FW', 78), // <- candidate (10 goals)
    makePlayer('weak', 10, 'FW', 72),
    makePlayer('weak', 11, 'FW', 68),
    makePlayer('weak', 17, 'FW', 60),
    makePlayer('weak', 1, 'GK', 65),
  ];

  const candidateId = 'weak-9';

  const playerStats: Record<string, PlayerSeasonStats> = {
    [candidateId]: makeStat(candidateId, 'weak', 10),
    'weak-10': makeStat('weak-10', 'weak', 3),
    'elite-9': makeStat('elite-9', 'elite', 8),
  };

  return {
    seasonState: {
      seasonNumber: 1,
      currentWindowIndex: 5,
      calendar: [],
      completed: false,
      isWorldCupYear: false,
      worldCupPhase: false,
    },
    teamBases: { elite, weak },
    teamStates: {} as never,
    coachBases: {},
    coachStates: {},
    coachCareers: {},
    league1Standings: [],
    league2Standings: [],
    league3Standings: [],
    leagueCup: undefined as never,
    superCup: undefined as never,
    worldCup: null,
    honorHistory: [],
    teamTrophies: {},
    coachTrophies: {},
    teamSeasonRecords: {},
    coachChangesThisSeason: [],
    squads: { elite: eliteSquad, weak: weakSquad },
    playerStats,
    activeEvents: [],
    achievements: [],
    newsLog: [],
    seed: 1,
    rngState: 1,
    seasonStartLevels: {},
    seasonBuffs: [],
    godHandUsed: false,
    coins: 0,
    bets: [],
    matchHistory: [],
    seasonBuffsHistory: [],
    playerAwardsHistory: [],
    transferHistory: [],
    memorableMatches: [],
  };
}

describe('processTransferWindow', () => {
  it('returns idMap with old → new ID mappings when a transfer fires', () => {
    const world = buildWorld();
    // Try seeds until poaching fires (30% chance per shortlisted candidate)
    let result = processTransferWindow(world, new SeededRNG(0));
    let seed = 0;
    while (result.idMap.size === 0 && seed < 50) {
      seed++;
      result = processTransferWindow(world, new SeededRNG(seed));
    }
    expect(result.idMap.size).toBeGreaterThanOrEqual(2);

    // For each (oldId → newId) mapping, the new id should not equal the old id.
    for (const [oldId, newId] of result.idMap.entries()) {
      expect(newId).not.toBe(oldId);
      expect(typeof newId).toBe('string');
    }
  });

  it('preserves position composition (swap-out position == incoming position)', () => {
    const world = buildWorld();
    let result = processTransferWindow(world, new SeededRNG(0));
    let seed = 0;
    while (result.idMap.size === 0 && seed < 50) {
      seed++;
      result = processTransferWindow(world, new SeededRNG(seed));
    }

    // Find the transfers and assert positions match
    const incoming = result.transfers.find((t) => t.toTeamId === 'elite');
    const outgoing = result.transfers.find((t) => t.toTeamId === 'weak');
    expect(incoming?.position).toBe(outgoing?.position);

    // Squad sizes are preserved exactly (no team grows or shrinks)
    expect(result.squads['elite']).toHaveLength(world.squads['elite'].length);
    expect(result.squads['weak']).toHaveLength(world.squads['weak'].length);

    // Position distribution per team is preserved
    const eliteFW = result.squads['elite'].filter((p) => p.position === 'FW').length;
    expect(eliteFW).toBe(world.squads['elite'].filter((p) => p.position === 'FW').length);
  });

  it("skips when elite's weakest same-position player is rated >= candidate", () => {
    const world = buildWorld();
    // Replace elite forwards so even the weakest (rating 80) >= candidate (78)
    world.squads['elite'] = [
      makePlayer('elite', 9, 'FW', 90),
      makePlayer('elite', 10, 'FW', 88),
      makePlayer('elite', 11, 'FW', 85),
      makePlayer('elite', 17, 'FW', 80), // weakest >= candidate (78)
      makePlayer('elite', 1, 'GK', 88),
    ];

    // Run lots of seeds — none should produce a transfer
    for (let s = 0; s < 30; s++) {
      const r = processTransferWindow(world, new SeededRNG(s));
      expect(r.idMap.size).toBe(0);
      expect(r.transfers).toHaveLength(0);
    }
  });

  it('returns empty result when there are no elite teams', () => {
    const world = buildWorld();
    world.teamBases['elite'] = makeTeam('elite', 75); // no longer elite
    const r = processTransferWindow(world, new SeededRNG(0));
    expect(r.idMap.size).toBe(0);
    expect(r.transfers).toHaveLength(0);
  });
});

describe('applyTransferIdMap', () => {
  it('rewrites playerStats keys, awards.playerId, transferHistory.playerId', () => {
    const world = buildWorld();
    world.playerAwardsHistory = [
      {
        season: 1,
        type: 'mvp',
        playerId: 'weak-9',
        playerName: 'X',
        playerNumber: 9,
        teamId: 'weak',
        teamName: 'weak',
        statValue: 10,
        statLabel: '10球',
      },
    ];
    world.transferHistory = [
      {
        season: 0,
        windowIndex: 0,
        playerId: 'weak-9',
        playerName: 'X',
        playerNumber: 9,
        position: 'FW',
        fromTeamId: 'weak',
        fromTeamName: 'weak',
        toTeamId: 'elite',
        toTeamName: 'elite',
        type: 'transfer',
        reason: 'test',
      },
    ];

    const idMap = new Map([['weak-9', 'elite-22']]);
    const out = applyTransferIdMap(world, idMap);

    expect(out.playerStats['elite-22']).toBeDefined();
    expect(out.playerStats['elite-22'].playerId).toBe('elite-22');
    expect(out.playerStats['weak-9']).toBeUndefined();
    expect(out.playerAwardsHistory[0].playerId).toBe('elite-22');
    expect(out.transferHistory[0].playerId).toBe('elite-22');
  });

  it('returns world references unchanged when idMap is empty', () => {
    const world = buildWorld();
    const out = applyTransferIdMap(world, new Map());
    expect(out.playerStats).toBe(world.playerStats);
    expect(out.playerAwardsHistory).toBe(world.playerAwardsHistory);
    expect(out.transferHistory).toBe(world.transferHistory);
  });
});

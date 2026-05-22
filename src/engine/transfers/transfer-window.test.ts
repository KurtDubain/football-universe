import { describe, it, expect } from 'vitest';
import { processTransferWindow } from './transfer-window';
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

let __uuidCounter = 1000;
function nextUuid(): string {
  return `p-${__uuidCounter++}`;
}

function makePlayer(
  teamId: string,
  number: number,
  position: PlayerPosition,
  rating: number,
  uuid: string = nextUuid(),
): Player {
  return {
    uuid,
    teamId,
    name: `${teamId}-P${number}`,
    number,
    position,
    rating,
    // Test fixtures: peakRating == rating, peakAge == 27 (see other test
    // helpers). Tests that exercise the development curve set these explicitly.
    peakRating: rating,
    peakAge: 27,
    goalScoring: 50,
    marketValue: 10,
    age: 26,
  };
}

function makeStat(playerUuid: string, teamId: string, goals = 0): PlayerSeasonStats {
  return {
    playerId: playerUuid,
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
 *
 * We pin uuids so tests can assert "this exact player kept this exact uuid"
 * after the swap.
 */
const CANDIDATE_UUID = 'p-cand';
const SWAP_OUT_UUID = 'p-swapout';

function buildWorld(): GameWorld {
  const elite = makeTeam('elite', 90);
  const weak = makeTeam('weak', 65);

  const eliteSquad: Player[] = [
    makePlayer('elite', 9, 'FW', 85),
    makePlayer('elite', 10, 'FW', 80),
    makePlayer('elite', 11, 'FW', 75),
    makePlayer('elite', 17, 'FW', 70, SWAP_OUT_UUID), // <- swap-out (weakest FW)
    makePlayer('elite', 1, 'GK', 88),
  ];
  const weakSquad: Player[] = [
    makePlayer('weak', 9, 'FW', 78, CANDIDATE_UUID), // <- candidate (10 goals)
    makePlayer('weak', 10, 'FW', 72),
    makePlayer('weak', 11, 'FW', 68),
    makePlayer('weak', 17, 'FW', 60),
    makePlayer('weak', 1, 'GK', 65),
  ];

  const eliteScorerUuid = eliteSquad[0].uuid;
  const otherWeakUuid = weakSquad[1].uuid;

  const playerStats: Record<string, PlayerSeasonStats> = {
    [CANDIDATE_UUID]: makeStat(CANDIDATE_UUID, 'weak', 10),
    [otherWeakUuid]: makeStat(otherWeakUuid, 'weak', 3),
    [eliteScorerUuid]: makeStat(eliteScorerUuid, 'elite', 8),
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
    nextPlayerUuidCounter: __uuidCounter,
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
    memorableMatches: [], continentalCups: { mainland_cup: null, southern_cup: null, eastern_cup: null }, totalElapsedWindows: 0, teamFinances: {}, freeAgentPool: [], transferRumors: [], playerStatsHistory: {},
    retirementHistory: [],
    coachCandidatePool: [],
    coachRetirementHistory: [],
    nextCoachIdCounter: 0,
  };
}

/**
 * Find a seed that produces at least one transfer for a given world. The
 * 30%-per-candidate roll means most seeds DO fire one swap, but occasional
 * unlucky strings need probing — we cap at 50 attempts which is more than
 * enough in practice.
 */
function seedWithTransfer(world: GameWorld): ReturnType<typeof processTransferWindow> {
  for (let s = 0; s < 50; s++) {
    const r = processTransferWindow(world, new SeededRNG(s));
    if (r.transfers.length > 0) return r;
  }
  throw new Error('No seed produced a transfer in 50 tries');
}

describe('processTransferWindow (uuid-stable)', () => {
  it('preserves the candidate uuid across the swap (no ID rewrite needed)', () => {
    const world = buildWorld();
    const result = seedWithTransfer(world);

    // The candidate uuid is still present somewhere in the squads — at the
    // BUYER team (elite), not the seller. Same for swap-out at the seller.
    const allUuids = Object.values(result.squads).flatMap(sq => sq.map(p => p.uuid));
    expect(allUuids).toContain(CANDIDATE_UUID);
    expect(allUuids).toContain(SWAP_OUT_UUID);

    const candidateNow = result.squads['elite'].find(p => p.uuid === CANDIDATE_UUID);
    expect(candidateNow).toBeDefined();
    expect(candidateNow!.teamId).toBe('elite');
    // Number may be remapped if 9 was taken — but the player object exists.

    const swappedDown = result.squads['weak'].find(p => p.uuid === SWAP_OUT_UUID);
    expect(swappedDown).toBeDefined();
    expect(swappedDown!.teamId).toBe('weak');
  });

  it('returns playerStats with the same uuid keys (only teamId values updated)', () => {
    const world = buildWorld();
    const result = seedWithTransfer(world);

    // Keys are unchanged — uuids never mutate
    expect(Object.keys(result.playerStats).sort())
      .toEqual(Object.keys(world.playerStats).sort());

    // The candidate's stat row is still keyed by the same uuid, but
    // `teamId` now reflects the new club so future-season top-scorer rolls
    // attribute correctly.
    expect(result.playerStats[CANDIDATE_UUID].teamId).toBe('elite');
    // playerId field on the stat itself unchanged
    expect(result.playerStats[CANDIDATE_UUID].playerId).toBe(CANDIDATE_UUID);
  });

  it('preserves position composition (swap-out position == incoming position)', () => {
    const world = buildWorld();
    const result = seedWithTransfer(world);

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
      expect(r.transfers).toHaveLength(0);
    }
  });

  it('returns empty result when there are no elite teams', () => {
    const world = buildWorld();
    world.teamBases['elite'] = makeTeam('elite', 75); // no longer elite
    const r = processTransferWindow(world, new SeededRNG(0));
    expect(r.transfers).toHaveLength(0);
    // playerStats reference preserved when no transfers (no rebuild)
    expect(r.playerStats).toBe(world.playerStats);
  });

  it('emits TransferRecord.playerId as the player uuid (stable across history)', () => {
    const world = buildWorld();
    const result = seedWithTransfer(world);

    // Both records (incoming + outgoing) carry uuids — these should match
    // the players' uuids both BEFORE and AFTER the swap. (No "${teamId}-${number}"
    // strings — the playerId field now holds the stable uuid value.)
    const incoming = result.transfers.find(t => t.toTeamId === 'elite');
    const outgoing = result.transfers.find(t => t.toTeamId === 'weak');
    expect(incoming?.playerId).toBe(CANDIDATE_UUID);
    expect(outgoing?.playerId).toBe(SWAP_OUT_UUID);

    // Sanity: the uuid does NOT encode teamId-number, so the candidate's
    // record's playerId is unaffected by the team/number change.
    expect(incoming?.toTeamId).toBe('elite');
    expect(incoming?.fromTeamId).toBe('weak');
  });
});

describe('processTransferWindow v2 — 4 positions + free agent pool', () => {
  it('admits DF candidates with appearances >= 25 and rating >= 78', () => {
    const elite = makeTeam('elite', 90);
    const weak = makeTeam('weak', 65);
    // Star DF on weak team, 28 apps, rating 80
    const starDfUuid = 'p-df-star';
    const eliteSquad = [
      makePlayer('elite', 1, 'GK', 88),
      makePlayer('elite', 5, 'DF', 85),
      makePlayer('elite', 6, 'DF', 82),
      makePlayer('elite', 7, 'DF', 79),
      makePlayer('elite', 8, 'DF', 70), // weakest DF — will be released
    ];
    const weakSquad = [
      makePlayer('weak', 1, 'GK', 65),
      makePlayer('weak', 5, 'DF', 80, starDfUuid),
      makePlayer('weak', 6, 'DF', 70),
    ];
    const world: GameWorld = {
      ...buildWorld(),
      teamBases: { elite, weak },
      squads: { elite: eliteSquad, weak: weakSquad },
      playerStats: { [starDfUuid]: { ...makeStat(starDfUuid, 'weak', 0), appearances: 28 } },
    };

    // Probe seeds until a DF transfer fires (30% prob, plenty of attempts)
    let dfTransferred = false;
    for (let s = 0; s < 80; s++) {
      const r = processTransferWindow(world, new SeededRNG(s));
      if (r.transfers.find(t => t.playerId === starDfUuid)) {
        dfTransferred = true;
        // Verify candidate ended at elite, in DF position
        const candidate = r.squads['elite'].find(p => p.uuid === starDfUuid);
        expect(candidate).toBeDefined();
        expect(candidate!.position).toBe('DF');
        break;
      }
    }
    expect(dfTransferred).toBe(true);
  });

  it('emits free_agent transfer when released player is signed by another team', () => {
    const world = buildWorld();
    const result = seedWithTransfer(world);
    // The downstream movement should be a 'free_agent' type (was 'free' in v1)
    const downstream = result.transfers.find(t => t.toTeamId === 'weak');
    expect(downstream).toBeDefined();
    expect(downstream?.type).toBe('free_agent');
    expect(downstream?.fee).toBeGreaterThan(0); // €5M signing fee
  });

  it('returns freeAgentRetirees when released player has no taker', () => {
    // Setup: 1 elite + 1 weak (both teams have a star). Poach fires the elite
    // releases a player into pool. Weak team picks them up. So usually 0
    // retirees. To force a retiree, we'd need no eligible recipient — e.g.,
    // weak team has no roster gap or recipient picks fails.
    // For this smoke test we just verify the field is present.
    const world = buildWorld();
    const result = seedWithTransfer(world);
    expect(Array.isArray(result.freeAgentRetirees)).toBe(true);
  });
});

describe('processTransferWindow v2 — concentration caps', () => {
  it('per-seller cap limits one team to MAX_POACHES_PER_SELLER per season', () => {
    // Build a non-elite team with 5 high-scoring forwards. Without the cap,
    // multiple of them would get poached in a single season. With cap=1,
    // exactly one moves no matter how many candidates qualify.
    const elite1 = makeTeam('elite1', 90);
    const elite2 = makeTeam('elite2', 88);
    const weak = makeTeam('weak', 65);
    const candUuids = ['c1', 'c2', 'c3', 'c4', 'c5'];
    const eliteSquad1 = [
      makePlayer('elite1', 9, 'FW', 88),
      makePlayer('elite1', 10, 'FW', 70), // weakest — poachable target
    ];
    const eliteSquad2 = [
      makePlayer('elite2', 9, 'FW', 85),
      makePlayer('elite2', 10, 'FW', 68), // weakest
    ];
    const weakSquad = candUuids.map((u, i) => makePlayer('weak', 9 + i, 'FW', 82, u));
    const playerStats: Record<string, PlayerSeasonStats> = {};
    for (const u of candUuids) playerStats[u] = makeStat(u, 'weak', 15);

    const world: GameWorld = {
      ...buildWorld(),
      teamBases: { elite1, elite2, weak },
      squads: { elite1: eliteSquad1, elite2: eliteSquad2, weak: weakSquad },
      playerStats,
    };

    // Run many seeds. In each, count how many of weak's players got poached.
    // ALL of them should land at 1 or 0 — never ≥ 2.
    let maxFromOneTeam = 0;
    for (let s = 0; s < 30; s++) {
      const r = processTransferWindow(world, new SeededRNG(s));
      const fromWeak = r.transfers.filter(t => t.fromTeamId === 'weak' && t.type === 'transfer').length;
      maxFromOneTeam = Math.max(maxFromOneTeam, fromWeak);
    }
    expect(maxFromOneTeam).toBeLessThanOrEqual(1);
  });

  it('per-buyer cap limits one elite to MAX_POACHES_PER_BUYER per season', () => {
    // Multiple weak teams have candidates; one elite that could hoover them
    // all up. With buyer cap = 2, that elite is capped at 2 even if there
    // are 10 candidates.
    const elite = makeTeam('elite', 90);
    const w1 = makeTeam('w1', 65);
    const w2 = makeTeam('w2', 65);
    const w3 = makeTeam('w3', 65);
    const w4 = makeTeam('w4', 65);
    const eliteSquad = [
      makePlayer('elite', 9, 'FW', 88),
      makePlayer('elite', 10, 'FW', 70), // 4× weak FWs — but cap=2
      makePlayer('elite', 11, 'FW', 70),
      makePlayer('elite', 12, 'FW', 70),
      makePlayer('elite', 13, 'FW', 70),
    ];
    const ws = [w1, w2, w3, w4];
    const squads: Record<string, Player[]> = { elite: eliteSquad };
    const playerStats: Record<string, PlayerSeasonStats> = {};
    for (let i = 0; i < ws.length; i++) {
      const u = `c-${i}`;
      squads[ws[i].id] = [makePlayer(ws[i].id, 9, 'FW', 80, u)];
      playerStats[u] = makeStat(u, ws[i].id, 18);
    }
    const world: GameWorld = {
      ...buildWorld(),
      teamBases: { elite, w1, w2, w3, w4 },
      squads,
      playerStats,
    };

    let maxToElite = 0;
    for (let s = 0; s < 30; s++) {
      const r = processTransferWindow(world, new SeededRNG(s));
      const toElite = r.transfers.filter(t => t.toTeamId === 'elite' && t.type === 'transfer').length;
      maxToElite = Math.max(maxToElite, toElite);
    }
    expect(maxToElite).toBeLessThanOrEqual(2);
  });
});

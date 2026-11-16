import { describe, expect, it } from 'vitest';
import type { Player, PlayerPosition, PlayerSeasonStats } from '../../types/player';
import type { TeamBase } from '../../types/team';
import { SeededRNG } from '../match/rng';
import {
  MAX_TOPUP_SIGNINGS,
  squadTarget,
  SQUAD_TARGET_BASE,
  SQUAD_TARGET_MAX,
  SELLER_SLACK,
  SQUAD_TARGET_MIN,
  topUpSquads,
} from './squad-topup';
import { ARMS_RACE_MAX, ARMS_RACE_MIN, type LeagueClimate } from '../clubs/league-climate';
import { FREE_MARKET_TEAM_ID } from './transfer-application';

function makeTeam(id: string, overrides: Partial<TeamBase> = {}): TeamBase {
  return {
    id,
    name: id,
    shortName: id.slice(0, 3),
    color: '#000000',
    tier: 'mid',
    overall: 70,
    attack: 70,
    midfield: 70,
    defense: 70,
    stability: 70,
    depth: 70,
    reputation: 60,
    initialLeagueLevel: 1,
    expectation: 3,
    region: '大陆+测试',
    ...overrides,
  };
}

function makePlayer(uuid: string, teamId: string, overrides: Partial<Player> = {}): Player {
  return {
    uuid,
    teamId,
    name: `Player-${uuid}`,
    number: 1,
    position: 'MF',
    rating: 70,
    peakRating: 70,
    peakAge: 27,
    goalScoring: 50,
    marketValue: 10,
    age: 25,
    ...overrides,
  };
}

// 22 slots in the engine's own position proportions, so a squad built from this
// cycle has no positional hole for the top-up to be drawn to for the wrong reason.
const POSITION_CYCLE: PlayerPosition[] = [
  'GK', 'GK', 'GK',
  'DF', 'DF', 'DF', 'DF', 'DF', 'DF', 'DF',
  'MF', 'MF', 'MF', 'MF', 'MF', 'MF', 'MF',
  'FW', 'FW', 'FW', 'FW', 'FW',
];

function makeSquad(teamId: string, size: number): Player[] {
  const squad: Player[] = [];
  for (let i = 0; i < size; i++) {
    squad.push(makePlayer(`${teamId}-p${i}`, teamId, {
      position: POSITION_CYCLE[i % POSITION_CYCLE.length],
      number: i + 1,
    }));
  }
  return squad;
}

const NEUTRAL: LeagueClimate = { armsRace: 0, talentEra: 0 };

function buildParams(overrides: {
  squads: Record<string, Player[]>;
  freeAgentPool?: Player[];
  cash?: number;
  climate?: LeagueClimate;
  seed?: number;
}) {
  const teamIds = Object.keys(overrides.squads);
  const cash = overrides.cash ?? 300;
  return {
    squads: overrides.squads,
    teamBases: Object.fromEntries(teamIds.map(id => [id, makeTeam(id)])),
    playerStats: {} as Record<string, PlayerSeasonStats>,
    cashByTeam: Object.fromEntries(teamIds.map(id => [id, cash])),
    levelByTeam: Object.fromEntries(teamIds.map(id => [id, 1 as 1 | 2 | 3])),
    freeAgentPool: overrides.freeAgentPool ?? [],
    climate: overrides.climate ?? NEUTRAL,
    rng: new SeededRNG(overrides.seed ?? 4242),
    nextPlayerUuidCounter: 9000,
    seasonNumber: 10,
    windowIndex: 3,
  };
}

describe('squadTarget', () => {
  it('is the engine design squad at the neutral point', () => {
    expect(squadTarget({ armsRace: 0, spendingAxis: 0.5, cashRank: 0.5 })).toBe(SQUAD_TARGET_BASE);
  });

  it('moves one-for-one with the arms race', () => {
    const low = squadTarget({ armsRace: ARMS_RACE_MIN, spendingAxis: 0.5, cashRank: 0.5 });
    const high = squadTarget({ armsRace: ARMS_RACE_MAX, spendingAxis: 0.5, cashRank: 0.5 });
    expect(high - low).toBe(ARMS_RACE_MAX - ARMS_RACE_MIN);
  });

  it('lets a big spender run a bigger squad than a reluctant one', () => {
    const spender = squadTarget({ armsRace: 0, spendingAxis: 0.95, cashRank: 0.5 });
    const saver = squadTarget({ armsRace: 0, spendingAxis: 0.05, cashRank: 0.5 });
    expect(spender).toBeGreaterThan(saver);
  });

  it('lets a richer club run a bigger squad than a poorer one', () => {
    const rich = squadTarget({ armsRace: 0, spendingAxis: 0.5, cashRank: 1 });
    const poor = squadTarget({ armsRace: 0, spendingAxis: 0.5, cashRank: 0 });
    expect(rich).toBeGreaterThan(poor);
  });

  it('stays inside its bounds across the whole input space', () => {
    for (const armsRace of [ARMS_RACE_MIN, 0, ARMS_RACE_MAX]) {
      for (const spendingAxis of [0, 0.5, 1]) {
        for (const cashRank of [0, 0.5, 1]) {
          const target = squadTarget({ armsRace, spendingAxis, cashRank });
          expect(target).toBeGreaterThanOrEqual(SQUAD_TARGET_MIN);
          expect(target).toBeLessThanOrEqual(SQUAD_TARGET_MAX);
        }
      }
    }
  });
});

describe('topUpSquads', () => {
  it('fills a squad whose gap fits inside the per-season cap', () => {
    // A single-club world ranks last on cash (rank 0 of a one-entry table), so
    // its target lands at 21 and a 20-player squad is one short — inside the cap.
    const squads = { t1: makeSquad('t1', 20) };
    const result = topUpSquads(buildParams({ squads }));

    expect(result.squads.t1.length).toBe(result.targets.t1);
  });

  it('stops at the per-season cap when the gap is larger than it', () => {
    // A cap that let a 5-player squad jump straight to 22 in one summer would
    // make the pass a reset button rather than a market.
    const squads = { t1: makeSquad('t1', 5) };
    const result = topUpSquads(buildParams({ squads }));

    expect(result.squads.t1.length).toBe(5 + MAX_TOPUP_SIGNINGS);
    expect(result.squads.t1.length).toBeLessThan(result.targets.t1);
  });

  it('leaves a squad already at target alone', () => {
    const squads = { t1: makeSquad('t1', SQUAD_TARGET_BASE) };
    const before = squads.t1.map(p => p.uuid);
    const result = topUpSquads(buildParams({ squads }));

    expect(result.transfers).toHaveLength(0);
    expect(result.squads.t1.map(p => p.uuid)).toEqual(before);
  });

  it('prefers the free-agent pool and books the signing fee both ways', () => {
    const releaser = 't2';
    const pool = [
      makePlayer('pool-1', FREE_MARKET_TEAM_ID, { releasedFromTeamId: releaser, number: 30 }),
      makePlayer('pool-2', FREE_MARKET_TEAM_ID, { releasedFromTeamId: releaser, number: 31 }),
    ];
    const squads = { t1: makeSquad('t1', 18), t2: makeSquad('t2', SQUAD_TARGET_BASE) };
    const result = topUpSquads(buildParams({ squads, freeAgentPool: pool }));

    const signings = result.transfers.filter(t => t.type === 'free_agent');
    expect(signings.length).toBeGreaterThanOrEqual(1);
    expect(signings.every(t => t.toTeamId === 't1')).toBe(true);
    expect(signings.every(t => t.reason === '补强阵容人数')).toBe(true);
    // The fee leaves the buyer and reaches the club that released the player.
    const paid = signings.reduce((sum, t) => sum + (t.fee ?? 0), 0);
    expect(result.expenseByTeam.t1).toBeCloseTo(paid, 5);
    expect(result.incomeByTeam[releaser]).toBeCloseTo(paid, 5);
    // Players signed out of the pool are gone from it.
    const stillPooled = result.freeAgentPool.map(p => p.uuid);
    for (const t of signings) expect(stillPooled).not.toContain(t.playerId);
  });

  it('never strips a seller below its own target', () => {
    const squads = { buyer: makeSquad('buyer', 18), seller: makeSquad('seller', 26) };
    const result = topUpSquads(buildParams({ squads }));

    const sellerFloor = result.targets.seller + SELLER_SLACK;
    expect(result.squads.seller.length).toBeGreaterThanOrEqual(sellerFloor);
    // The buyer still reaches its target — channel 3 guarantees it.
    expect(result.squads.buyer.length).toBe(result.targets.buyer);
  });

  it('books a purchase as a two-sided cash flow when it happens', () => {
    // Seller sits exactly on the release threshold (target + RELEASE_SLACK), so
    // the release pass has nothing to list and the pool stays empty. That
    // matters: with a listed player in the pool the buyer would also pay a
    // signing fee, and the seller's income would be the sum of two different
    // channels — correct behaviour, but it cannot prove the purchase leg is
    // booked on both sides.
    const squads = { buyer: makeSquad('buyer', 18), seller: makeSquad('seller', 24) };
    const result = topUpSquads(buildParams({ squads, seed: 7 }));

    const buys = result.transfers.filter(t => t.type === 'transfer');
    expect(buys.length).toBeGreaterThan(0);
    for (const buy of buys) {
      expect(buy.toTeamId).toBe('buyer');
      expect(buy.fromTeamId).toBe('seller');
      expect(buy.reason).toBe('补强阵容人数');
      expect(buy.fee ?? 0).toBeGreaterThan(0);
    }
    // The pool was empty, so the purchase leg is the buyer's only expense and the
    // seller's only income: both sides must equal the summed fee exactly.
    expect(result.freeAgentPool).toHaveLength(0);
    const spent = buys.reduce((sum, t) => sum + (t.fee ?? 0), 0);
    expect(result.expenseByTeam.buyer ?? 0).toBeCloseTo(spent, 5);
    expect(result.incomeByTeam.seller ?? 0).toBeCloseTo(spent, 5);
  });

  it('exercises the buy channel for at least one seed', () => {
    // Channel 2 is probabilistic (the seller can refuse), so a single seed proves
    // nothing. Sweep a few and require the lane to fire at least once, which is
    // what stops it silently becoming dead code.
    let sawBuy = false;
    for (let seed = 1; seed <= 20 && !sawBuy; seed++) {
      const squads = { buyer: makeSquad('buyer', 18), seller: makeSquad('seller', 28) };
      const result = topUpSquads(buildParams({ squads, seed }));
      if (result.transfers.some(t => t.type === 'transfer')) sawBuy = true;
    }
    expect(sawBuy).toBe(true);
  });

  it('falls back to a free academy graduate when nothing can be bought', () => {
    const squads = { t1: makeSquad('t1', 18) };
    const result = topUpSquads(buildParams({ squads, cash: 0 }));

    expect(result.squads.t1.length).toBe(result.targets.t1);
    expect(result.transfers).toHaveLength(0);
    expect(result.nextPlayerUuidCounter).toBeGreaterThan(9000);
    // Graduates come in young, and on the team that promoted them.
    const promoted = result.squads.t1.filter(p => !p.uuid.startsWith('t1-p'));
    expect(promoted.length).toBeGreaterThan(0);
    expect(promoted.every(p => p.teamId === 't1')).toBe(true);
    expect(promoted.every(p => p.age <= 22)).toBe(true);
  });

  it('does not mutate its inputs', () => {
    const squads = { t1: makeSquad('t1', 18), t2: makeSquad('t2', 26) };
    const pool = [makePlayer('pool-1', FREE_MARKET_TEAM_ID, { releasedFromTeamId: 't2' })];
    const snapshot = JSON.stringify({ squads, pool });
    topUpSquads(buildParams({ squads, freeAgentPool: pool }));

    expect(JSON.stringify({ squads, pool })).toBe(snapshot);
  });
});

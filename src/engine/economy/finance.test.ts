/**
 * Phase H — economy module unit tests.
 *
 * We test the small, pure pieces (startingCashForRep, leaguePrize,
 * formatMoney, attemptFireSale, archiveSeasonFinance) — `applyIncome` and
 * `applyExpense` are integration-tested via the season-end pipeline.
 */
import { describe, it, expect } from 'vitest';
import {
  startingCashForRep,
  leaguePrize,
  formatMoney,
  initTeamFinances,
  attemptFireSale,
  archiveSeasonFinance,
  setSalaryRateForTesting,
  applyExpense,
  SALARY_RATE,
  CUP_PRIZE,
  TV_SPONSOR_BY_TIER,
  FIRE_SALE_PREMIUM,
  FIRE_SALE_MIN_VALUE,
  FIRE_SALE_BUYER_MIN_REP,
} from './finance';
import { SeededRNG } from '../match/rng';
import type { TeamBase, FinanceState } from '../../types/team';
import type { Player } from '../../types/player';

function mkBase(overrides: Partial<TeamBase> = {}): TeamBase {
  return {
    id: 'A', name: 'A', shortName: 'A', color: '#000', tier: 'mid',
    overall: 70, attack: 70, midfield: 70, defense: 70, stability: 70, depth: 70,
    reputation: 70, initialLeagueLevel: 1, expectation: 3, region: '大陆+测试',
    ...overrides,
  };
}

function mkPlayer(overrides: Partial<Player> = {}): Player {
  return {
    uuid: 'p-1', teamId: 'A', name: 'X', number: 9, position: 'FW',
    rating: 80, peakRating: 80, peakAge: 27,
    goalScoring: 70, marketValue: 30, age: 27,
    ...overrides,
  };
}

describe('startingCashForRep — reputation-tier seeding', () => {
  it('elite teams (rep≥85) start with €150M', () => {
    expect(startingCashForRep(85)).toBe(150);
    expect(startingCashForRep(98)).toBe(150);
  });
  it('top teams (75-84) start with €80M', () => {
    expect(startingCashForRep(75)).toBe(80);
    expect(startingCashForRep(84)).toBe(80);
  });
  it('mid teams (65-74) start with €40M', () => {
    expect(startingCashForRep(65)).toBe(40);
    expect(startingCashForRep(74)).toBe(40);
  });
  it('low teams (<65) start with €20M', () => {
    expect(startingCashForRep(64)).toBe(20);
    expect(startingCashForRep(0)).toBe(20);
  });
});

describe('leaguePrize — top-8 only with 0.85 decay', () => {
  it('L1 champion gets €60M', () => {
    expect(leaguePrize(1, 1)).toBe(60);
  });
  it('L1 8th place still positive (cliff is at 9th)', () => {
    expect(leaguePrize(1, 8)).toBeGreaterThan(0);
    expect(leaguePrize(1, 9)).toBe(0);
  });
  it('L2 champion gets exactly half of L1', () => {
    expect(leaguePrize(2, 1)).toBe(Math.round(60 * 0.5));
  });
  it('L3 champion gets a quarter of L1', () => {
    expect(leaguePrize(3, 1)).toBe(Math.round(60 * 0.25));
  });
  it('decay is monotonic (rank N+1 < rank N)', () => {
    for (let r = 1; r < 8; r++) {
      expect(leaguePrize(1, r + 1)).toBeLessThan(leaguePrize(1, r));
    }
  });
  it('out-of-range ranks return 0', () => {
    expect(leaguePrize(1, 0)).toBe(0);
    expect(leaguePrize(1, 99)).toBe(0);
    expect(leaguePrize(1, -1)).toBe(0);
  });
});

describe('formatMoney — display formatting', () => {
  it('zero renders as €0M', () => {
    expect(formatMoney(0)).toBe('€0M');
  });
  it('negatives prefix with minus', () => {
    expect(formatMoney(-50)).toBe('-€50M');
  });
  it('large positive rounds to integer', () => {
    expect(formatMoney(150)).toBe('€150M');
    expect(formatMoney(15.4)).toBe('€15M');
  });
  it('small magnitudes show one decimal place', () => {
    expect(formatMoney(1.5)).toBe('€1.5M');
    expect(formatMoney(-2.7)).toBe('-€2.7M');
  });
});

describe('initTeamFinances — bootstraps from teamBases', () => {
  it('seeds cash by reputation tier and empty history', () => {
    const bases: Record<string, TeamBase> = {
      A: mkBase({ id: 'A', reputation: 90 }),
      B: mkBase({ id: 'B', reputation: 70 }),
      C: mkBase({ id: 'C', reputation: 50 }),
    };
    const fin = initTeamFinances(bases);
    expect(fin.A).toEqual({ cash: 150, totalIncome: 0, totalExpense: 0, history: [] });
    expect(fin.B).toEqual({ cash: 40, totalIncome: 0, totalExpense: 0, history: [] });
    expect(fin.C).toEqual({ cash: 20, totalIncome: 0, totalExpense: 0, history: [] });
  });
});

describe('applyExpense — wage bill is squadValue × salaryRate', () => {
  it('uses runtime salaryRate, deducts from cash, accumulates totalExpense', () => {
    setSalaryRateForTesting(SALARY_RATE);
    const fin: Record<string, FinanceState> = {
      A: { cash: 100, totalIncome: 0, totalExpense: 0, history: [] },
    };
    const squads: Record<string, Player[]> = {
      A: [mkPlayer({ marketValue: 100 }), mkPlayer({ uuid: 'p-2', marketValue: 200 })],
    };
    // squadValue = 300; salary at 33% = 99
    const r = applyExpense(fin, squads);
    expect(r.teamFinances.A.cash).toBe(100 - 99);
    expect(r.teamFinances.A.totalExpense).toBe(99);
  });
  it('honours setSalaryRateForTesting overrides', () => {
    const orig = SALARY_RATE;
    setSalaryRateForTesting(0.5);
    const fin: Record<string, FinanceState> = {
      A: { cash: 100, totalIncome: 0, totalExpense: 0, history: [] },
    };
    const squads: Record<string, Player[]> = {
      A: [mkPlayer({ marketValue: 100 })],
    };
    const r = applyExpense(fin, squads);
    expect(r.teamFinances.A.cash).toBe(50);
    setSalaryRateForTesting(orig);
  });
});

describe('attemptFireSale — emergency 200% sale to elite buyer', () => {
  function buildScenario() {
    const teamBases: Record<string, TeamBase> = {
      POOR: mkBase({ id: 'POOR', reputation: 60 }),
      ELITE: mkBase({ id: 'ELITE', reputation: 90 }),
      ELITE2: mkBase({ id: 'ELITE2', reputation: 92 }),
    };
    const teamFinances: Record<string, FinanceState> = {
      POOR: { cash: -50, totalIncome: 0, totalExpense: 0, history: [] },
      ELITE: { cash: 200, totalIncome: 0, totalExpense: 0, history: [] },
      ELITE2: { cash: 200, totalIncome: 0, totalExpense: 0, history: [] },
    };
    const squads: Record<string, Player[]> = {
      POOR: [mkPlayer({ uuid: 'p-star', teamId: 'POOR', marketValue: 50, name: 'Star', number: 9 })],
      ELITE: [mkPlayer({ uuid: 'p-elite', teamId: 'ELITE', marketValue: 60, name: 'Y', number: 10 })],
      ELITE2: [mkPlayer({ uuid: 'p-elite2', teamId: 'ELITE2', marketValue: 60, name: 'Z', number: 10 })],
    };
    return { teamBases, teamFinances, squads };
  }

  it('moves the player and books cash flows at 200% market value', () => {
    const { teamBases, teamFinances, squads } = buildScenario();
    const rng = new SeededRNG(7);
    const r = attemptFireSale(teamFinances, squads, teamBases, 1, 5, rng);
    expect(r.transfers).toHaveLength(1);
    const t = r.transfers[0];
    expect(t.fromTeamId).toBe('POOR');
    expect(['ELITE', 'ELITE2']).toContain(t.toTeamId);
    expect(t.fee).toBe(50 * FIRE_SALE_PREMIUM); // 100
    // Seller cash recovers, buyer cash drops
    expect(r.teamFinances.POOR.cash).toBe(-50 + 100);
    expect(r.teamFinances.POOR.totalIncome).toBe(100);
    expect(r.teamFinances[t.toTeamId].cash).toBe(200 - 100);
    expect(r.teamFinances[t.toTeamId].totalExpense).toBe(100);
    // Squad arrays are reshuffled
    expect(r.squads.POOR).toHaveLength(0);
    expect(r.squads[t.toTeamId]).toHaveLength(2);
    // News
    expect(r.news).toHaveLength(1);
    expect(r.news[0].type).toBe('fire_sale');
  });

  it('does NOT fire if no team has cash < 0', () => {
    const { teamBases, teamFinances, squads } = buildScenario();
    teamFinances.POOR.cash = 5; // positive — no fire sale
    const rng = new SeededRNG(11);
    const r = attemptFireSale(teamFinances, squads, teamBases, 1, 5, rng);
    expect(r.transfers).toHaveLength(0);
  });

  it('does NOT fire if no €30M+ player on the squad', () => {
    const { teamBases, teamFinances, squads } = buildScenario();
    squads.POOR = [mkPlayer({ uuid: 'p-star', teamId: 'POOR', marketValue: FIRE_SALE_MIN_VALUE - 1 })];
    const rng = new SeededRNG(13);
    const r = attemptFireSale(teamFinances, squads, teamBases, 1, 5, rng);
    expect(r.transfers).toHaveLength(0);
  });

  it('does NOT fire if no eligible buyer (rep too low or insufficient cash)', () => {
    const { teamBases, teamFinances, squads } = buildScenario();
    // Demote all elite buyers below the rep threshold
    teamBases.ELITE.reputation = FIRE_SALE_BUYER_MIN_REP - 5;
    teamBases.ELITE2.reputation = FIRE_SALE_BUYER_MIN_REP - 5;
    const rng = new SeededRNG(17);
    const r = attemptFireSale(teamFinances, squads, teamBases, 1, 5, rng);
    expect(r.transfers).toHaveLength(0);
  });

  it('caps at one fire sale per seller per call (no repeat firing)', () => {
    const { teamBases, teamFinances, squads } = buildScenario();
    // Add a second valuable player to POOR — only one should sell
    squads.POOR.push(mkPlayer({ uuid: 'p-extra', teamId: 'POOR', marketValue: 40, number: 8 }));
    const rng = new SeededRNG(19);
    const r = attemptFireSale(teamFinances, squads, teamBases, 1, 5, rng);
    expect(r.transfers).toHaveLength(1);
    expect(r.squads.POOR).toHaveLength(1); // one player remains
  });
});

describe('archiveSeasonFinance — season-end snapshot + reset', () => {
  it('appends a record + zeroes running counters; cash carries over', () => {
    const fin: Record<string, FinanceState> = {
      A: { cash: 80, totalIncome: 100, totalExpense: 70, history: [] },
    };
    const startCash = { A: 50 };
    const breakdown = {
      A: { prizeMoney: 60, tvSponsor: 40, transferIncome: 0, salaries: 70, transferExpense: 0 },
    };
    const next = archiveSeasonFinance(fin, 7, startCash, breakdown);
    expect(next.A.cash).toBe(80);
    expect(next.A.totalIncome).toBe(0);
    expect(next.A.totalExpense).toBe(0);
    expect(next.A.history).toHaveLength(1);
    expect(next.A.history[0].season).toBe(7);
    expect(next.A.history[0].startCash).toBe(50);
    expect(next.A.history[0].endCash).toBe(80);
    expect(next.A.history[0].prizeMoney).toBe(60);
    expect(next.A.history[0].salaries).toBe(70);
  });

  it('caps history at 10 entries (FIFO)', () => {
    const seed: FinanceState = {
      cash: 0, totalIncome: 0, totalExpense: 0,
      history: Array.from({ length: 10 }, (_, i) => ({
        season: i + 1, startCash: 0, endCash: 0,
        prizeMoney: 0, tvSponsor: 0, transferIncome: 0, salaries: 0, transferExpense: 0,
      })),
    };
    const fin: Record<string, FinanceState> = { A: seed };
    const next = archiveSeasonFinance(fin, 11, { A: 0 }, {
      A: { prizeMoney: 0, tvSponsor: 0, transferIncome: 0, salaries: 0, transferExpense: 0 },
    });
    expect(next.A.history).toHaveLength(10);
    // Oldest dropped, newest appended
    expect(next.A.history[0].season).toBe(2);
    expect(next.A.history[9].season).toBe(11);
  });
});

describe('CUP_PRIZE / TV_SPONSOR_BY_TIER — sanity', () => {
  it('CUP_PRIZE keys all positive', () => {
    for (const v of Object.values(CUP_PRIZE)) {
      expect(v).toBeGreaterThan(0);
    }
  });
  it('TV_SPONSOR is anti-Matthew (L1 > L2 > L3 but spread is small)', () => {
    expect(TV_SPONSOR_BY_TIER[1]).toBeGreaterThan(TV_SPONSOR_BY_TIER[2]);
    expect(TV_SPONSOR_BY_TIER[2]).toBeGreaterThan(TV_SPONSOR_BY_TIER[3]);
    // L3 is half of L2; L2 is half of L1 — keeps lower tiers viable.
    expect(TV_SPONSOR_BY_TIER[1]).toBe(40);
    expect(TV_SPONSOR_BY_TIER[2]).toBe(20);
    expect(TV_SPONSOR_BY_TIER[3]).toBe(10);
  });
});

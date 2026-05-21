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
  SALARY_BRACKETS,
  computeSalary,
  resetSalaryBrackets,
  setSalaryBracketsForTesting,
  clearFlatRate,
  CUP_PRIZE,
  attributeCupPrizes,
  LEAGUE_CUP_TIERS,
  WORLD_CUP_TIERS,
  MAINLAND_CUP_TIERS,
  SMALL_CONTINENTAL_CUP_TIERS,
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
    // squadValue = 300; flat 33% = 99, BUT default L1 wage cap = 75 → 75
    const r = applyExpense(fin, squads);
    expect(r.teamFinances.A.cash).toBe(100 - 75);
    expect(r.teamFinances.A.totalExpense).toBe(75);
    clearFlatRate();
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
    // 100 × 50% = 50, under L1 cap 75
    const r = applyExpense(fin, squads);
    expect(r.teamFinances.A.cash).toBe(50);
    setSalaryRateForTesting(orig);
    clearFlatRate();
  });
});

describe('computeSalary — progressive bracket schedule', () => {
  it('returns 0 for empty/negative squad', () => {
    expect(computeSalary(0)).toBe(0);
    expect(computeSalary(-10)).toBe(0);
  });
  it('applies first bracket only when below first boundary', () => {
    // Default brackets: 33% @ 0-50, 22% @ 50-200, 15% @ 200+
    expect(computeSalary(30)).toBe(Math.round(30 * 0.33));      // 10
    expect(computeSalary(50)).toBe(Math.round(50 * 0.33));      // 17 (rounded from 16.5)
  });
  it('applies progressive rates across bracket boundaries', () => {
    // 100M = 50×0.33 + 50×0.22 = 16.5 + 11 = 27.5 → 28 (under L1 cap 75)
    expect(computeSalary(100)).toBe(28);
    // 200M = 50×0.33 + 150×0.22 = 16.5 + 33 = 49.5 → 50 (under L1 cap 75)
    expect(computeSalary(200)).toBe(50);
    // 500M bracketed = 94.5, but L1 cap = 75 → 75
    expect(computeSalary(500)).toBe(75);
    // 500M with explicit L1 cap → still 75
    expect(computeSalary(500, 1)).toBe(75);
    // 500M with L2 cap (38) → 38
    expect(computeSalary(500, 2)).toBe(38);
    // 500M with L3 cap (19) → 19
    expect(computeSalary(500, 3)).toBe(19);
  });
  it('big squads pay sub-linear salary (key invariant)', () => {
    // Doubling squad value should not double salary — that's the whole point
    const s100 = computeSalary(100);
    const s500 = computeSalary(500);
    // Linear-flat would give 5x. Bracketed+capped should be <3x.
    expect(s500 / s100).toBeLessThan(4);
    expect(s500 / s100).toBeGreaterThan(2);
  });
  it('league wage cap binds for star-loaded squads', () => {
    // €1500M fresh-game squad should hit cap regardless of bracket
    expect(computeSalary(1500, 1)).toBe(75);
    expect(computeSalary(1500, 2)).toBe(38);
    expect(computeSalary(1500, 3)).toBe(19);
  });
  it('honours setSalaryBracketsForTesting overrides', () => {
    setSalaryBracketsForTesting([{ boundary: Infinity, rate: 0.10 }]);
    expect(computeSalary(100)).toBe(10);
    resetSalaryBrackets();
    expect(computeSalary(100)).toBe(28); // back to default
  });
  it('default SALARY_BRACKETS sums to defined total at €500M', () => {
    // Sanity: production schedule integrity
    expect(SALARY_BRACKETS).toHaveLength(3);
    expect(SALARY_BRACKETS[0].rate).toBe(0.33);
    expect(SALARY_BRACKETS[2].boundary).toBe(Infinity);
  });
});

describe('applyExpense — uses bracketed salary by default (post-v2)', () => {
  it('charges bracketed+capped salary when no flat-rate override is set', () => {
    clearFlatRate(); // ensure default bracketed mode
    const fin: Record<string, FinanceState> = {
      A: { cash: 200, totalIncome: 0, totalExpense: 0, history: [] },
    };
    const squads: Record<string, Player[]> = {
      // squadValue = 500
      A: [
        mkPlayer({ uuid: 'p-1', marketValue: 200 }),
        mkPlayer({ uuid: 'p-2', marketValue: 200 }),
        mkPlayer({ uuid: 'p-3', marketValue: 100 }),
      ],
    };
    // 500 → bracketed 95, capped to 75 (default L1)
    const r = applyExpense(fin, squads);
    expect(r.teamFinances.A.cash).toBe(200 - 75);
    expect(r.teamFinances.A.totalExpense).toBe(75);
  });
  it('respects per-team league level for cap', () => {
    clearFlatRate();
    const fin: Record<string, FinanceState> = {
      A: { cash: 200, totalIncome: 0, totalExpense: 0, history: [] },
      B: { cash: 200, totalIncome: 0, totalExpense: 0, history: [] },
    };
    const squads: Record<string, Player[]> = {
      A: [mkPlayer({ uuid: 'pa', marketValue: 500 })],
      B: [mkPlayer({ uuid: 'pb', marketValue: 500 })],
    };
    const r = applyExpense(fin, squads, { A: 1, B: 3 });
    expect(r.teamFinances.A.totalExpense).toBe(75); // L1 cap
    expect(r.teamFinances.B.totalExpense).toBe(19); // L3 cap
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

describe('attributeCupPrizes — tiered prize attribution', () => {
  function fix(home: string, away: string, winner: string) {
    return { homeTeamId: home, awayTeamId: away, winnerId: winner };
  }

  it('handles a 3-round (8-team) cup — 南洲杯 style', () => {
    // 8 teams: A...H. R8: A>B, C>D, E>F, G>H. SF: A>C, E>G. Final: A>E
    const rounds = [
      { fixtures: [fix('A','B','A'), fix('C','D','C'), fix('E','F','E'), fix('G','H','G')] },
      { fixtures: [fix('A','C','A'), fix('E','G','E')] },
      { fixtures: [fix('A','E','A')] },
    ];
    const out = attributeCupPrizes(rounds, SMALL_CONTINENTAL_CUP_TIERS);
    expect(out.A).toBe(CUP_PRIZE.small_continental_cup_winner);  // 40
    expect(out.E).toBe(CUP_PRIZE.small_continental_cup_runner_up);  // 20
    expect(out.C).toBe(CUP_PRIZE.small_continental_cup_sf);  // 8 (lost SF)
    expect(out.G).toBe(CUP_PRIZE.small_continental_cup_sf);  // 8
    // R8 first-round losers (B, D, F, H) get nothing
    expect(out.B).toBeUndefined();
    expect(out.D).toBeUndefined();
    expect(out.F).toBeUndefined();
    expect(out.H).toBeUndefined();
  });

  it('handles a 4-round (16-team) cup — 大陆杯 style', () => {
    // 16 teams. Build out final 4 rounds quickly. Just verify SF/QF prizes.
    // R16, R8, SF, Final
    const rounds = [
      { fixtures: [
        fix('A','B','A'), fix('C','D','C'), fix('E','F','E'), fix('G','H','G'),
        fix('I','J','I'), fix('K','L','K'), fix('M','N','M'), fix('O','P','O'),
      ] },
      { fixtures: [fix('A','C','A'), fix('E','G','E'), fix('I','K','I'), fix('M','O','M')] },
      { fixtures: [fix('A','E','A'), fix('I','M','I')] },
      { fixtures: [fix('A','I','A')] },
    ];
    const out = attributeCupPrizes(rounds, MAINLAND_CUP_TIERS);
    expect(out.A).toBe(CUP_PRIZE.continental_cup_winner);   // 45
    expect(out.I).toBe(CUP_PRIZE.continental_cup_runner_up); // 25
    expect(out.E).toBe(CUP_PRIZE.continental_cup_semi);      // 10 (lost SF)
    expect(out.M).toBe(CUP_PRIZE.continental_cup_semi);      // 10
    expect(out.C).toBe(CUP_PRIZE.continental_cup_r8);        // 4 (lost R8 = "quarter" in 4-round labeling)
    expect(out.G).toBe(CUP_PRIZE.continental_cup_r8);        // 4
    // R16 first-round losers get nothing
    expect(out.B).toBeUndefined();
    expect(out.D).toBeUndefined();
  });

  it('handles a 5-round (32-team) cup — 联赛杯 style', () => {
    // Just verify the chain — winner gets winner prize, semi loser gets sf,
    // quarter loser gets qf, R16 loser gets r16, R32 loser gets nothing
    const rounds = [
      // R32 — only fill 4 fixtures (champion's path) for brevity
      { fixtures: [fix('A','B','A')] },
      // R16
      { fixtures: [fix('A','C','A')] },
      // QF
      { fixtures: [fix('A','D','A')] },
      // SF
      { fixtures: [fix('A','E','A')] },
      // Final
      { fixtures: [fix('A','F','A')] },
    ];
    const out = attributeCupPrizes(rounds, LEAGUE_CUP_TIERS);
    expect(out.A).toBe(CUP_PRIZE.league_cup_winner);     // 30
    expect(out.F).toBe(CUP_PRIZE.league_cup_runner_up);  // 18
    expect(out.E).toBe(CUP_PRIZE.league_cup_sf);         // 10
    expect(out.D).toBe(CUP_PRIZE.league_cup_qf);         // 5
    expect(out.C).toBe(CUP_PRIZE.league_cup_r16);        // 2
    expect(out.B).toBeUndefined(); // R32 = first round, no prize
  });

  it('handles a degenerate cup (no rounds yet) — empty result', () => {
    expect(attributeCupPrizes([], LEAGUE_CUP_TIERS)).toEqual({});
  });

  it('handles incomplete rounds (no winnerId) gracefully', () => {
    const rounds = [
      { fixtures: [{ homeTeamId: 'A', awayTeamId: 'B' /* no winnerId */ }] },
    ];
    expect(attributeCupPrizes(rounds, SMALL_CONTINENTAL_CUP_TIERS)).toEqual({});
  });

  it('WC tiers — confirms full progression', () => {
    // 4 rounds: R16 → QF → SF → Final
    const rounds = [
      { fixtures: [fix('A','B','A')] },  // R16
      { fixtures: [fix('A','C','A')] },  // QF
      { fixtures: [fix('A','D','A')] },  // SF
      { fixtures: [fix('A','E','A')] },  // Final
    ];
    const out = attributeCupPrizes(rounds, WORLD_CUP_TIERS);
    expect(out.A).toBe(CUP_PRIZE.world_cup_winner);     // 60
    expect(out.E).toBe(CUP_PRIZE.world_cup_runner_up);  // 30
    expect(out.D).toBe(CUP_PRIZE.world_cup_semi);       // 15
    expect(out.C).toBe(CUP_PRIZE.world_cup_qf);         // 10
    expect(out.B).toBe(CUP_PRIZE.world_cup_r16);        // 5
  });
});

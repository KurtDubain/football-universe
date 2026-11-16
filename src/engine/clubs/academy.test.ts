import { describe, it, expect } from 'vitest';
import {
  ACADEMY_CONVERGENCE,
  ACADEMY_LEVEL_DEFAULT,
  ACADEMY_LEVEL_MAX,
  ACADEMY_LEVEL_MIN,
  ACADEMY_REVENUE_CAP,
  ACADEMY_STREAK_CAP,
  ACADEMY_WAGE_BUFFER_SEASONS,
  academyReputationMultiplier,
  academyStreakBonus,
  academyTarget,
  clampAcademyLevel,
  computeAcademyInvestment,
  computeAffordable,
  computeInvestRatio,
  deriveInitialAcademyState,
  describeAcademyLevel,
  driftAcademyState,
  selectSeriousTeams,
  type AcademySeasonInput,
} from './academy';
import { DOCTRINE_REGRESSION } from './doctrine';
import { SeededRNG } from '../match/rng';

function input(overrides: Partial<AcademySeasonInput> = {}): AcademySeasonInput {
  return {
    revenue: 48,
    cash: 400,
    wage: 38,
    academyAxis: 0.5,
    coachBias: 0,
    reputation: 70,
    seriousRank: true,
    ...overrides,
  };
}

describe('academy — starting state', () => {
  it('starts every club at the league average', () => {
    const a = deriveInitialAcademyState();
    const b = deriveInitialAcademyState();
    expect(a).toEqual(b);
    expect(a).toEqual({ level: ACADEMY_LEVEL_DEFAULT, investmentStreak: 0, lastInvested: 0 });
  });

  it('is deterministic for a given rng', () => {
    const i = input();
    const invest = computeAcademyInvestment(i);
    const a = driftAcademyState(deriveInitialAcademyState(), i, invest, new SeededRNG(99));
    const b = driftAcademyState(deriveInitialAcademyState(), i, invest, new SeededRNG(99));
    expect(a).toEqual(b);
  });
});

describe('academy — investment sizing', () => {
  it('spends nothing when cash is under two seasons of wages', () => {
    const wage = 38;
    expect(computeAcademyInvestment(input({ cash: wage * 2, wage }))).toBe(0);
    expect(computeAcademyInvestment(input({ cash: wage * 2 - 1, wage }))).toBe(0);
    expect(computeAcademyInvestment(input({ cash: wage * 2 + 20, wage }))).toBeGreaterThan(0);
  });

  it('caps the budget at 1.2x revenue however much cash is on hand', () => {
    const rich = computeAcademyInvestment(input({ cash: 100000, revenue: 48, academyAxis: 1 }));
    expect(rich).toBe(Math.round(48 * ACADEMY_REVENUE_CAP * 1 * 10) / 10);
    // Twice the cash must not buy twice the academy.
    const richer = computeAcademyInvestment(input({ cash: 200000, revenue: 48, academyAxis: 1 }));
    expect(richer).toBe(rich);
  });

  it('computes the affordable headroom above the wage buffer', () => {
    expect(computeAffordable(100, 38)).toBe(100 - 38 * ACADEMY_WAGE_BUFFER_SEASONS);
    expect(computeAffordable(50, 38)).toBe(0);
    expect(computeAffordable(-10, 38)).toBe(0);
  });

  it('clamps the investment ratio into [0.05, 1]', () => {
    expect(computeInvestRatio(0.01, 0)).toBe(0.05);
    expect(computeInvestRatio(0.95, 0.5)).toBe(1);
    expect(computeInvestRatio(0.5, 0)).toBe(0.5);
  });

  it('buys more academy level per euro at low reputation', () => {
    expect(academyReputationMultiplier(40)).toBeCloseTo(1.4235, 3);
    expect(academyReputationMultiplier(70)).toBeCloseTo(1.1412, 3);
    expect(academyReputationMultiplier(95)).toBeCloseTo(0.9059, 3);
  });
});

describe('academy — level drift', () => {
  it('keeps the streak bonus inside the target, not as a per-season addend', () => {
    // The first draft added min(6, streak * 0.4) to the LEVEL every season.
    // Under a converging update that is a constant offset of bonus / convergence
    // for EVERY club (a flat +27 at 0.22), which both erased the differences
    // between clubs and pinned the level against the clamp. As part of the target
    // it cannot exceed the cap, whatever the streak.
    expect(academyStreakBonus(1000)).toBe(ACADEMY_STREAK_CAP);
    const withStreak = academyTarget(input(), 10, 1000);
    const withoutStreak = academyTarget(input(), 10, 0);
    expect(withStreak - withoutStreak).toBe(ACADEMY_STREAK_CAP);
  });

  it('drives the target from money actually spent, not from intent', () => {
    // Same keen doctrine, one club funded and one broke. Scoring intent would
    // let the broke club keep improving, which is the bug the streak term had.
    const keen = input({ academyAxis: 0.95 });
    const broke = { ...keen, cash: 5 };
    const fundedSpend = computeAcademyInvestment(keen);
    const brokeSpend = computeAcademyInvestment(broke);
    expect(fundedSpend).toBeGreaterThan(0);
    expect(brokeSpend).toBe(0);
    const gap = academyTarget(keen, fundedSpend, 0) - academyTarget(broke, brokeSpend, 0);
    expect(gap).toBeGreaterThan(20);
  });

  it('does not advance the streak for a club that could not fund the academy', () => {
    const prev = { level: 60, investmentStreak: 10, lastInvested: 20 };
    const brokeInput = input({ cash: 10, wage: 38, seriousRank: true });
    const invest = computeAcademyInvestment(brokeInput);
    expect(invest).toBe(0);
    const next = driftAcademyState(prev, brokeInput, invest, new SeededRNG(1));
    expect(next.investmentStreak).toBe(9);
    expect(next.lastInvested).toBe(0);
  });

  it('decays towards the floor when the club stops funding the academy', () => {
    let state = { level: 80, investmentStreak: 0, lastInvested: 0 };
    const rng = new SeededRNG(7);
    const idle = input({ academyAxis: 0.05, seriousRank: false });
    for (let s = 0; s < 60; s++) state = driftAcademyState(state, idle, 0, rng);
    expect(state.level).toBeLessThan(60);
    expect(state.level).toBeGreaterThanOrEqual(ACADEMY_LEVEL_MIN);
    expect(state.investmentStreak).toBe(0);
  });

  it('never leaves the hard bounds over 400 seasons, at either extreme', () => {
    for (const axis of [0.05, 0.95]) {
      let state = deriveInitialAcademyState();
      const rng = new SeededRNG(axis > 0.5 ? 11 : 22);
      for (let s = 0; s < 400; s++) {
        const i = input({
          academyAxis: axis,
          reputation: axis > 0.5 ? 95 : 35,
          seriousRank: axis > 0.5,
        });
        state = driftAcademyState(state, i, computeAcademyInvestment(i), rng);
        expect(state.level).toBeGreaterThanOrEqual(ACADEMY_LEVEL_MIN);
        expect(state.level).toBeLessThanOrEqual(ACADEMY_LEVEL_MAX);
      }
    }
  });

  it('converges more slowly than the doctrine axes that feed it', () => {
    // Half-lives: level 0.05 -> ~13.5 seasons, doctrine 0.10 -> ~6.6. Facilities,
    // scouting networks and coaching traditions outlive the board philosophy, so
    // the academy has to be the slower of the two. One manager must not be able
    // to erase a club's academy tradition in three seasons.
    const levelHalfLife = Math.log(0.5) / Math.log(1 - ACADEMY_CONVERGENCE);
    const doctrineHalfLife = Math.log(0.5) / Math.log(1 - DOCTRINE_REGRESSION);
    expect(levelHalfLife).toBeGreaterThan(doctrineHalfLife * 1.8);
  });

  it('separates a funded academy from an abandoned one', () => {
    // The first draft failed in the opposite direction: a per-season streak
    // addend under a converging update became the same constant offset for
    // EVERY club, so they all ended up in the same place regardless of what
    // they spent. Investment has to be the thing that separates them, and by a
    // margin wide enough to read a century later.
    const rng = new SeededRNG(4242);
    const run = (axis: number, rep: number, serious: boolean) => {
      let state = deriveInitialAcademyState();
      for (let s = 0; s < 120; s++) {
        const i = input({ academyAxis: axis, reputation: rep, seriousRank: serious });
        state = driftAcademyState(state, i, computeAcademyInvestment(i), rng);
      }
      return state.level;
    };
    // Axis 0.5 is the league-average doctrine; it only reaches this share
    // because the club can also afford it. Axis 0.05 is a club that has
    // effectively stopped, and the reputation bonus cannot save it.
    const funded = run(0.5, 70, true);
    const abandoned = run(0.05, 85, false);
    expect(funded - abandoned).toBeGreaterThan(40);
    expect(['顶级青训', '青训强项']).toContain(describeAcademyLevel(funded));
    expect(['青训薄弱', '形同虚设']).toContain(describeAcademyLevel(abandoned));
  });

  it('clamps the level into its hard bounds', () => {
    expect(clampAcademyLevel(-50)).toBe(ACADEMY_LEVEL_MIN);
    expect(clampAcademyLevel(500)).toBe(ACADEMY_LEVEL_MAX);
    expect(clampAcademyLevel(50)).toBe(50);
  });
});

describe('academy — serious investment ranking', () => {
  it('promotes the top third of the league, not the top two thirds', () => {
    // The first implementation computed floor(n * (1 - share)) and applied it
    // with slice(cut), which selects everything ABOVE the cut. With share = 2/3
    // that promoted 22 of 32 clubs. The tell was a median investment streak of
    // 33-46 seasons, impossible when only a third qualify in any one season.
    const intent: Record<string, number> = {};
    for (let i = 0; i < 32; i++) intent['t' + i] = i;
    const serious = selectSeriousTeams(intent);
    expect(serious.size).toBe(Math.floor(32 / 3));
    expect(serious.size).toBe(10);
    expect(serious.has('t31')).toBe(true);
    expect(serious.has('t22')).toBe(true);
    expect(serious.has('t21')).toBe(false);
    expect(serious.has('t0')).toBe(false);
  });

  it('breaks ties on team id so a seed always yields the same set', () => {
    const intent: Record<string, number> = { a: 5, b: 5, c: 5, d: 5, e: 5, f: 5 };
    const first = [...selectSeriousTeams(intent)].sort();
    const second = [...selectSeriousTeams({ ...intent })].sort();
    expect(first).toEqual(second);
    expect(first.length).toBe(2);
    expect(first).toEqual(['e', 'f']);
  });
});

describe('academy — presentation', () => {
  it('labels the level bands', () => {
    expect(describeAcademyLevel(90)).toBe('顶级青训');
    expect(describeAcademyLevel(70)).toBe('青训强项');
    expect(describeAcademyLevel(50)).toBe('中规中矩');
    expect(describeAcademyLevel(35)).toBe('青训薄弱');
    expect(describeAcademyLevel(20)).toBe('形同虚设');
  });
});
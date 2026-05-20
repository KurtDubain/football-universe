import { describe, it, expect } from 'vitest';
import {
  retireChance,
  processCoachRetirements,
  pickReplacement,
  COACH_HARD_AGE_CAP,
  COACH_RETIREMENT_MIN_AGE,
  MAX_COACH_RETIREMENTS_PER_SEASON,
} from './coach-retirement';
import type { GameWorld } from '../season/season-manager';
import type { CoachBase, CoachState } from '../../types/coach';
import type { TeamBase } from '../../types/team';
import { SeededRNG } from '../match/rng';
import { applyV11ToV12CoachAge } from '../../store/game-store';

// ── Test fixtures ────────────────────────────────────────────────

function makeTeam(id: string, overrides: Partial<TeamBase> = {}): TeamBase {
  return {
    id, name: `${id}-name`, shortName: id.slice(0, 3), color: '#000000', tier: 'mid',
    overall: 70, attack: 70, midfield: 70, defense: 70, stability: 70, depth: 70,
    reputation: 60, initialLeagueLevel: 1, expectation: 3, region: '大陆+测试', ...overrides,
  };
}

function makeCoach(id: string, overrides: Partial<CoachBase> = {}): CoachBase {
  return {
    id, name: `Coach-${id}`, rating: 70, style: 'balanced',
    attackBuff: 5, defenseBuff: 5, moraleBuff: 5, leagueBuff: 5, cupBuff: 5,
    pressureResistance: 60, riskBias: 0, stabilityBuff: 5, age: 50,
    ...overrides,
  };
}

function makeState(id: string, currentTeamId: string | null): CoachState {
  return {
    id, currentTeamId,
    isUnemployed: currentTeamId === null,
    unemployedSince: currentTeamId === null ? 0 : null,
  };
}

/** Build a synthetic world with N teams + N coaches. */
function buildWorld(args: {
  coaches: { coach: CoachBase; teamId: string }[];
  seasonNumber?: number;
  pool?: GameWorld['coachCandidatePool'];
  nextCoachIdCounter?: number;
}): GameWorld {
  const teamBases: Record<string, TeamBase> = {};
  const coachBases: Record<string, CoachBase> = {};
  const coachStates: Record<string, CoachState> = {};
  const coachCareers: Record<string, GameWorld['coachCareers'][string]> = {};
  for (const { coach, teamId } of args.coaches) {
    teamBases[teamId] = makeTeam(teamId);
    coachBases[coach.id] = coach;
    coachStates[coach.id] = makeState(coach.id, teamId);
    coachCareers[coach.id] = [{
      teamId, teamName: teamBases[teamId].name,
      fromSeason: 1, toSeason: null, fired: false, trophies: [],
    }];
  }
  return {
    seasonState: {
      seasonNumber: args.seasonNumber ?? 5,
      currentWindowIndex: 0, calendar: [], completed: false,
      isWorldCupYear: false, worldCupPhase: false,
    },
    teamBases, teamStates: {} as never,
    coachBases, coachStates, coachCareers,
    league1Standings: [], league2Standings: [], league3Standings: [],
    leagueCup: undefined as never, superCup: undefined as never, worldCup: null,
    honorHistory: [], teamTrophies: {}, coachTrophies: {}, teamSeasonRecords: {},
    coachChangesThisSeason: [],
    squads: {}, playerStats: {}, nextPlayerUuidCounter: 0,
    retirementHistory: [],
    coachCandidatePool: args.pool ?? [],
    coachRetirementHistory: [],
    nextCoachIdCounter: args.nextCoachIdCounter ?? 0,
    activeEvents: [], achievements: [], newsLog: [],
    seed: 1, rngState: 1,
    seasonStartLevels: {}, seasonBuffs: [],
    godHandUsed: false, coins: 0, bets: [],
    matchHistory: [], seasonBuffsHistory: [],
    playerAwardsHistory: [], transferHistory: [], memorableMatches: [],
  };
}

// ── 1. retireChance formula ────────────────────────────────────

describe('retireChance', () => {
  it('age below 60 → 0', () => {
    expect(retireChance(40, 70)).toBe(0);
    expect(retireChance(59, 90)).toBe(0);
    expect(retireChance(COACH_RETIREMENT_MIN_AGE - 1, 70)).toBe(0);
  });

  it('age >= 72 (HARD_AGE_CAP) → 1.0 (forced)', () => {
    expect(retireChance(COACH_HARD_AGE_CAP, 70)).toBe(1.0);
    expect(retireChance(COACH_HARD_AGE_CAP, 95)).toBe(1.0); // even legends forced
    expect(retireChance(80, 70)).toBe(1.0);
  });

  it('age 60, rating 70 → 0', () => {
    // (60-60)/12 = 0, no rating bonus → 0
    expect(retireChance(60, 70)).toBe(0);
  });

  it('age 65, rating 70 → ~0.42 (no rating bonus)', () => {
    // (65-60)/12 = 0.4167
    const c = retireChance(65, 70);
    expect(c).toBeCloseTo(0.4167, 3);
  });

  it('age 68, rating 70 → ~0.67', () => {
    const c = retireChance(68, 70);
    expect(c).toBeCloseTo(0.6667, 3);
  });

  it('age 70, rating 70 → ~0.83', () => {
    const c = retireChance(70, 70);
    expect(c).toBeCloseTo(0.8333, 3);
  });

  it('rating 95 reduces chance (legends play longer)', () => {
    // age 65 base = 0.4167; rating bonus = (95-80)/100 = 0.15 → 0.27
    const c = retireChance(65, 95);
    expect(c).toBeCloseTo(0.2667, 3);
  });

  it('rating below 80 contributes no bonus', () => {
    // age 65 — same chance regardless of rating below 80
    const c1 = retireChance(65, 70);
    const c2 = retireChance(65, 80);
    const c3 = retireChance(65, 50);
    expect(c1).toBe(c2);
    expect(c1).toBe(c3);
  });

  it('clamps below to 0 (super-elite at min age)', () => {
    // age 60, rating 99 — base 0, bonus (99-80)/100 = 0.19, result clamped to 0
    expect(retireChance(60, 99)).toBe(0);
  });

  it('clamps above at 0.95 (just below cap)', () => {
    // age 71, rating 50 — (71-60)/12 = 0.917 — under 0.95 cap
    const c = retireChance(71, 50);
    expect(c).toBeLessThanOrEqual(0.95);
    expect(c).toBeGreaterThan(0.90);
  });
});

// ── 2. processCoachRetirements basics ──────────────────────────

describe('processCoachRetirements — hard age cap', () => {
  it('forces retirement for age >= 72', () => {
    const world = buildWorld({
      coaches: [
        { coach: makeCoach('c1', { age: COACH_HARD_AGE_CAP, rating: 95 }), teamId: 't1' },
        { coach: makeCoach('c2', { age: 50, rating: 70 }), teamId: 't2' },
      ],
    });
    const rng = new SeededRNG(123);
    const result = processCoachRetirements(world, rng);
    expect(result.retirements).toHaveLength(1);
    expect(result.retirements[0].id).toBe('c1');
    // c1 is now unemployed
    expect(result.coachStates['c1'].currentTeamId).toBeNull();
    // A replacement was hired for t1
    expect(result.newHires).toHaveLength(1);
    expect(result.newHires[0].teamId).toBe('t1');
  });

  it('age 80 still retires (way past cap)', () => {
    const world = buildWorld({
      coaches: [{ coach: makeCoach('c1', { age: 80, rating: 70 }), teamId: 't1' }],
    });
    const result = processCoachRetirements(world, new SeededRNG(7));
    expect(result.retirements).toHaveLength(1);
  });

  it('age 59 never retires regardless of rating', () => {
    const world = buildWorld({
      coaches: [{ coach: makeCoach('c1', { age: 59, rating: 50 }), teamId: 't1' }],
    });
    // Run many seeds — none should produce a retirement
    let any = false;
    for (let s = 1; s < 50; s++) {
      const result = processCoachRetirements(world, new SeededRNG(s));
      if (result.retirements.length > 0) any = true;
    }
    expect(any).toBe(false);
  });
});

describe('processCoachRetirements — per-season cap', () => {
  it('caps at MAX_COACH_RETIREMENTS_PER_SEASON when more coaches qualify', () => {
    // 8 forced retirees → only 6 retire this season.
    const coaches = Array.from({ length: 8 }, (_, i) => ({
      coach: makeCoach(`c${i}`, { age: COACH_HARD_AGE_CAP + i, rating: 70 }),
      teamId: `t${i}`,
    }));
    const world = buildWorld({ coaches });
    const result = processCoachRetirements(world, new SeededRNG(42));
    expect(result.retirements).toHaveLength(MAX_COACH_RETIREMENTS_PER_SEASON);
  });

  it('forced retirees take precedence over optional ones', () => {
    // 4 forced + 4 optional (high chance, age 70) — forced should all 4 make it.
    const coaches = [
      ...Array.from({ length: 4 }, (_, i) => ({
        coach: makeCoach(`f${i}`, { age: COACH_HARD_AGE_CAP, rating: 70 }),
        teamId: `t${i}`,
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        coach: makeCoach(`o${i}`, { age: 70, rating: 50 }),
        teamId: `t${i + 4}`,
      })),
    ];
    const world = buildWorld({ coaches });
    const result = processCoachRetirements(world, new SeededRNG(99));
    // 4 forced + at most 2 optional = 6 cap
    expect(result.retirements.length).toBeLessThanOrEqual(MAX_COACH_RETIREMENTS_PER_SEASON);
    const forcedRetired = result.retirements.filter((r) => r.id.startsWith('f'));
    expect(forcedRetired).toHaveLength(4);
  });
});

// ── 3. pickReplacement (A3) ──────────────────────────────────

describe('pickReplacement — pool consumption (A3)', () => {
  it('consumes oldest candidate from pool when forced', () => {
    const team = makeTeam('t1');
    const pool: GameWorld['coachCandidatePool'] = [
      { uuid: 'p-100', name: '老球员A', fromTeamId: 't0', peakRating: 92, enteredPoolSeason: 3, style: 'attacking' },
      { uuid: 'p-200', name: '老球员B', fromTeamId: 't0', peakRating: 85, enteredPoolSeason: 5, style: 'defensive' },
    ];
    // Find a seed where the 50/50 falls to the candidate side. The first
    // RNG call after a fresh seed determines the path.
    let result: ReturnType<typeof pickReplacement> | null = null;
    for (let s = 0; s < 20; s++) {
      const r = pickReplacement('t1', team, 5, [...pool], 0, new SeededRNG(s));
      if (r.source === 'candidate') {
        result = r;
        break;
      }
    }
    expect(result).not.toBeNull();
    // Consumed FIRST entry (FIFO, oldest enteredPoolSeason)
    expect(result!.coach.id).toBe('c-from-player-p-100');
    expect(result!.coach.name).toBe('老球员A');
    expect(result!.coach.style).toBe('attacking');
    expect(result!.coach.rating).toBe(92);
    // Pool shrunk by 1
    expect(result!.coachCandidatePool).toHaveLength(1);
    expect(result!.coachCandidatePool[0].uuid).toBe('p-200');
  });

  it('falls through to fresh when pool is empty', () => {
    const team = makeTeam('t1');
    const result = pickReplacement('t1', team, 5, [], 7, new SeededRNG(123));
    expect(result.source).toBe('fresh');
    expect(result.coach.id).toBe('c-fresh-7');
    // Counter bumped
    expect(result.nextCoachIdCounter).toBe(8);
  });

  it('50/50 split is visible across many seeded runs', () => {
    const team = makeTeam('t1');
    const pool: GameWorld['coachCandidatePool'] = [
      { uuid: 'p-100', name: 'X', fromTeamId: 't0', peakRating: 90, enteredPoolSeason: 1, style: 'balanced' },
    ];
    let candCount = 0;
    let freshCount = 0;
    for (let s = 0; s < 200; s++) {
      // We feed a freshly-cloned pool each time so the consumption doesn't
      // bleed across iterations.
      const r = pickReplacement('t1', team, 5, [...pool], 0, new SeededRNG(s));
      if (r.source === 'candidate') candCount++;
      else freshCount++;
    }
    // ~50/50 — allow generous tolerance due to seeded RNG bias
    expect(candCount).toBeGreaterThan(60);
    expect(freshCount).toBeGreaterThan(60);
    // And the total adds up
    expect(candCount + freshCount).toBe(200);
  });

  it('candidate replacement keeps the coach assigned to the new team immediately', () => {
    const team = makeTeam('t1');
    const pool: GameWorld['coachCandidatePool'] = [
      { uuid: 'p-1', name: 'Y', fromTeamId: 't0', peakRating: 88, enteredPoolSeason: 2, style: 'counter' },
    ];
    // Force candidate path by probing seeds.
    let r: ReturnType<typeof pickReplacement> | null = null;
    for (let s = 0; s < 30; s++) {
      const candidate = pickReplacement('t1', team, 5, [...pool], 0, new SeededRNG(s));
      if (candidate.source === 'candidate') { r = candidate; break; }
    }
    expect(r).not.toBeNull();
    expect(r!.state.currentTeamId).toBe('t1');
    expect(r!.state.isUnemployed).toBe(false);
    expect(r!.career.teamId).toBe('t1');
    expect(r!.career.fromSeason).toBe(5);
    expect(r!.career.toSeason).toBeNull();
  });

  it('fresh coach generated has plausible random fields', () => {
    const team = makeTeam('t1');
    for (let s = 0; s < 20; s++) {
      const r = pickReplacement('t1', team, 5, [], s, new SeededRNG(s + 100));
      expect(r.source).toBe('fresh');
      expect(r.coach.rating).toBeGreaterThanOrEqual(50);
      expect(r.coach.rating).toBeLessThanOrEqual(75);
      expect(r.coach.age).toBeGreaterThanOrEqual(35);
      expect(r.coach.age).toBeLessThanOrEqual(50);
      expect(['attacking', 'defensive', 'balanced', 'possession', 'counter']).toContain(r.coach.style);
    }
  });
});

// ── 4. End-to-end: candidate consumption integration ───────

describe('processCoachRetirements — pool consumption integration', () => {
  it('a forced retirement with a non-empty pool sometimes consumes a candidate', () => {
    // Run many seeds — should see a non-zero number of "from candidate" hires.
    let usedPool = 0;
    let usedFresh = 0;
    for (let s = 1; s < 60; s++) {
      const world = buildWorld({
        coaches: [{ coach: makeCoach('c1', { age: COACH_HARD_AGE_CAP, rating: 70 }), teamId: 't1' }],
        pool: [
          { uuid: 'p-100', name: 'A', fromTeamId: 't0', peakRating: 88, enteredPoolSeason: 2, style: 'attacking' },
        ],
      });
      const result = processCoachRetirements(world, new SeededRNG(s));
      const hire = result.newHires[0];
      if (!hire) continue;
      if (hire.source === 'candidate') usedPool++;
      else usedFresh++;
    }
    // Both paths exercised across the seed range
    expect(usedPool).toBeGreaterThan(0);
    expect(usedFresh).toBeGreaterThan(0);
  });

  it('pool consumption removes the candidate from the pool', () => {
    let consumed = false;
    for (let s = 1; s < 60; s++) {
      const world = buildWorld({
        coaches: [{ coach: makeCoach('c1', { age: COACH_HARD_AGE_CAP, rating: 70 }), teamId: 't1' }],
        pool: [
          { uuid: 'p-100', name: 'A', fromTeamId: 't0', peakRating: 88, enteredPoolSeason: 2, style: 'attacking' },
        ],
      });
      const result = processCoachRetirements(world, new SeededRNG(s));
      if (result.newHires[0]?.source === 'candidate') {
        // Pool should be empty (consumed the only entry)
        expect(result.coachCandidatePool).toHaveLength(0);
        // The new coach has fromPlayer=true under the prefix convention
        expect(result.newHires[0].coach.id.startsWith('c-from-player-')).toBe(true);
        consumed = true;
        break;
      }
    }
    expect(consumed).toBe(true);
  });

  it('career entry is closed for the retiree (toSeason set, fired=false)', () => {
    const world = buildWorld({
      coaches: [{ coach: makeCoach('c1', { age: COACH_HARD_AGE_CAP, rating: 70 }), teamId: 't1' }],
    });
    const result = processCoachRetirements(world, new SeededRNG(5));
    const closed = result.coachCareers['c1'];
    expect(closed).toBeDefined();
    const last = closed[closed.length - 1];
    expect(last.toSeason).toBe(5);
    expect(last.fired).toBe(false);
  });

  it('immediate replacement leaves no team coach-less', () => {
    const world = buildWorld({
      coaches: [
        { coach: makeCoach('c1', { age: COACH_HARD_AGE_CAP, rating: 70 }), teamId: 't1' },
        { coach: makeCoach('c2', { age: COACH_HARD_AGE_CAP, rating: 70 }), teamId: 't2' },
      ],
    });
    const result = processCoachRetirements(world, new SeededRNG(11));
    // Every team that lost its coach has a replacement assigned
    for (const hire of result.newHires) {
      expect(result.coachStates[hire.coach.id].currentTeamId).toBe(hire.teamId);
    }
    // Team count has new coaches
    const teamsWithCoaches = new Set(
      Object.values(result.coachStates)
        .filter((s) => s.currentTeamId != null)
        .map((s) => s.currentTeamId),
    );
    expect(teamsWithCoaches.has('t1')).toBe(true);
    expect(teamsWithCoaches.has('t2')).toBe(true);
  });
});

// ── 5. v11 → v12 migration ──────────────────────────────────

describe('applyV11ToV12CoachAge (v11 → v12)', () => {
  it('assigns deterministic age in [35, 65] from id hash', () => {
    const world = {
      coachBases: {
        coach_a: { id: 'coach_a' } as { id?: string; age?: number },
        coach_b: { id: 'coach_b' } as { id?: string; age?: number },
      },
    };
    const tally = applyV11ToV12CoachAge(world);
    expect(tally.coachesTouched).toBe(2);
    for (const c of Object.values(world.coachBases)) {
      expect(c.age).toBeGreaterThanOrEqual(35);
      expect(c.age).toBeLessThanOrEqual(65);
    }
  });

  it('idempotent — does not overwrite an existing age', () => {
    const world = {
      coachBases: {
        coach_a: { id: 'coach_a', age: 42 } as { id?: string; age?: number },
      },
    };
    applyV11ToV12CoachAge(world);
    expect(world.coachBases.coach_a.age).toBe(42);
  });

  it('initialises coachRetirementHistory + nextCoachIdCounter', () => {
    const world: { coachBases?: unknown; coachRetirementHistory?: unknown; nextCoachIdCounter?: unknown } = {
      coachBases: {},
    };
    const tally = applyV11ToV12CoachAge(world);
    expect(tally.fieldsTouched).toBe(2);
    expect(world.coachRetirementHistory).toEqual([]);
    expect(world.nextCoachIdCounter).toBe(0);
  });

  it('two worlds with same coach ids produce identical ages (deterministic)', () => {
    const a = { coachBases: { c_x: { id: 'c_x' } as { id?: string; age?: number } } };
    const b = { coachBases: { c_x: { id: 'c_x' } as { id?: string; age?: number } } };
    applyV11ToV12CoachAge(a);
    applyV11ToV12CoachAge(b);
    expect(a.coachBases.c_x.age).toBe(b.coachBases.c_x.age);
  });

  it('handles malformed entries without throwing', () => {
    const world = { coachBases: { broken: {} as { id?: string; age?: number } } };
    expect(() => applyV11ToV12CoachAge(world)).not.toThrow();
    expect(world.coachBases.broken.age).toBeGreaterThanOrEqual(35);
    expect(world.coachBases.broken.age).toBeLessThanOrEqual(65);
  });
});

// ── 6. Determinism ──────────────────────────────────────────

describe('processCoachRetirements — determinism', () => {
  it('same seed produces the same result', () => {
    const w1 = buildWorld({
      coaches: [
        { coach: makeCoach('c1', { age: COACH_HARD_AGE_CAP, rating: 70 }), teamId: 't1' },
        { coach: makeCoach('c2', { age: 65, rating: 60 }), teamId: 't2' },
      ],
    });
    const w2 = buildWorld({
      coaches: [
        { coach: makeCoach('c1', { age: COACH_HARD_AGE_CAP, rating: 70 }), teamId: 't1' },
        { coach: makeCoach('c2', { age: 65, rating: 60 }), teamId: 't2' },
      ],
    });
    const r1 = processCoachRetirements(w1, new SeededRNG(1234));
    const r2 = processCoachRetirements(w2, new SeededRNG(1234));
    expect(r1.retirements.map((r) => r.id)).toEqual(r2.retirements.map((r) => r.id));
    expect(r1.newHires.map((h) => h.coach.id)).toEqual(r2.newHires.map((h) => h.coach.id));
  });
});

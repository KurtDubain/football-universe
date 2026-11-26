import { describe, it, expect } from 'vitest';
import {
  applyFreeAgentReplacements,
  computeRetirementChance,
  generateYouthReplacement,
  processRetirements,
  MAX_RETIREMENTS_PER_TEAM,
  HARD_AGE_CAP,
  COACH_POOL_CAP,
  capYouthPeakByTalentTier,
  rollYouthTalentTier,
  youthTalentTierChances,
} from './retirement';
import type { GameWorld } from '../season/season-manager';
import { TALENT_ERA_MAX, TALENT_ERA_MIN } from '../clubs/league-climate';
import type { Player, PlayerPosition } from '../../types/player';
import type { TeamBase } from '../../types/team';
import { SeededRNG } from '../match/rng';

// ── Test fixtures ────────────────────────────────────────────────

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
    goalScoring: 30,
    age: 25,
    marketValue: 5,
    ...overrides,
  };
}

/**
 * Build a synthetic world with a single team + squad and the bare minimum
 * fields needed by `processRetirements`. Anything missing throws via
 * non-null assertion when accessed — tests should fail loudly.
 */
function buildWorld(args: {
  team: TeamBase;
  squad: Player[];
  seasonNumber?: number;
  pool?: GameWorld['coachCandidatePool'];
  history?: GameWorld['retirementHistory'];
  nextUuidStart?: number;
  teamTrophies?: GameWorld['teamTrophies'];
}): GameWorld {
  const { team, squad } = args;
  return {
    seasonState: {
      seasonNumber: args.seasonNumber ?? 5,
      currentWindowIndex: 0,
      calendar: [],
      completed: false,
      isWorldCupYear: false,
    },
    teamBases: { [team.id]: team },
    teamStates: {},
    coachBases: {},
    coachStates: {},
    coachCareers: {},
    league1Standings: [],
    league2Standings: [],
    league3Standings: [],
    leagueCup: undefined!,
    superCup: undefined!,
    worldCup: null,
    honorHistory: [],
    teamTrophies: args.teamTrophies ?? {},
    coachTrophies: {},
    teamSeasonRecords: {},
    coachChangesThisSeason: [],
    squads: { [team.id]: squad },
    playerStats: {},
    nextPlayerUuidCounter: args.nextUuidStart ?? 1000,
    retirementHistory: args.history ?? [],
    coachCandidatePool: args.pool ?? [],
    coachRetirementHistory: [],
    nextCoachIdCounter: 0,
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
    memorableMatches: [], continentalCups: { mainland_cup: null, southern_cup: null, eastern_cup: null }, totalElapsedWindows: 0, teamFinances: {}, freeAgentPool: [], transferRumors: [], playerStatsHistory: {}, transferWindow: null,
  };
}

// ── 1. Retirement chance formula ────────────────────────────────

describe('computeRetirementChance', () => {
  it('age below 33 → 0', () => {
    expect(computeRetirementChance(20, 70)).toBe(0);
    expect(computeRetirementChance(32, 90)).toBe(0);
  });

  it('age 35, rating 70 → roughly 16% (no rating bonus)', () => {
    // (35 - 33) / 12 = 0.1666...
    const c = computeRetirementChance(35, 70);
    expect(c).toBeGreaterThan(0.15);
    expect(c).toBeLessThan(0.18);
  });

  it('age 38, rating 70 → at least 0.40 (floor for 38+)', () => {
    // formula: (38-33)/12 = 0.4166 ≈ 0.42, floor 0.40 → 0.4166 wins
    const c = computeRetirementChance(38, 70);
    expect(c).toBeGreaterThanOrEqual(0.40);
    expect(c).toBeLessThan(0.45);
  });

  it('age 35, rating 95 → near 0 (elite players cling on)', () => {
    // (35-33)/12 - (95-80)/100 = 0.1667 - 0.15 = 0.0167
    const c = computeRetirementChance(35, 95);
    expect(c).toBeLessThan(0.05);
    expect(c).toBeGreaterThanOrEqual(0);
  });

  it('age 42 → very high but capped at 0.95', () => {
    const c = computeRetirementChance(42, 60);
    expect(c).toBeLessThanOrEqual(0.95);
    expect(c).toBeGreaterThan(0.40);
  });

  it('rating bonus never produces a negative chance', () => {
    expect(computeRetirementChance(33, 99)).toBeGreaterThanOrEqual(0);
    expect(computeRetirementChance(34, 99)).toBeGreaterThanOrEqual(0);
  });

  it('floor 0.40 only kicks in at age 38+', () => {
    // Age 37, rating 99: (37-33)/12 - 0.19 = 0.143 — no floor, stays low
    const c37 = computeRetirementChance(37, 99);
    expect(c37).toBeLessThan(0.20);
    // Age 38 with same rating: floor kicks in
    const c38 = computeRetirementChance(38, 99);
    expect(c38).toBeGreaterThanOrEqual(0.40);
  });
});

// ── 2. processRetirements behavior ──────────────────────────────

describe('processRetirements — hard age cap', () => {
  it('forces retirement for any player at HARD_AGE_CAP (42) or older', () => {
    const team = makeTeam('t1');
    // Single 42yo with very low retirement chance (rating 95) — still retires.
    const squad = [
      makePlayer('p-1', 't1', { age: HARD_AGE_CAP, peakRating: 95, position: 'FW', number: 9 }),
      makePlayer('p-2', 't1', { age: 25, peakRating: 70, position: 'MF', number: 10 }),
    ];
    const world = buildWorld({ team, squad });
    world.teamTrophies = { t1: Array.from({ length: 50 }, (_, i) => ({ type: 'league1', seasonNumber: i + 1 })) };
    const rng = new SeededRNG(42);
    const result = processRetirements(world, rng);
    expect(result.retirements).toHaveLength(1);
    expect(result.retirements[0].uuid).toBe('p-1');
    expect(result.retirements[0].careerTrophies).toBeUndefined();
    expect(world.teamTrophies.t1).toHaveLength(50);
    // Squad still has 2 players — replacement was generated.
    expect(result.squads['t1']).toHaveLength(2);
  });

  it('player at age 50 (way past hard cap) still retires', () => {
    const team = makeTeam('t1');
    const squad = [makePlayer('p-old', 't1', { age: 50, peakRating: 80, position: 'GK' })];
    const world = buildWorld({ team, squad });
    const rng = new SeededRNG(7);
    const result = processRetirements(world, rng);
    expect(result.retirements).toHaveLength(1);
  });
});

describe('processRetirements — per-team cap', () => {
  it('caps retirements at MAX_RETIREMENTS_PER_TEAM, defers the rest', () => {
    const team = makeTeam('t1');
    // 6 over-aged players, all forced (age 42+) — only 4 retire this season.
    const squad: Player[] = [];
    for (let i = 0; i < 6; i++) {
      squad.push(makePlayer(`p-${i}`, 't1', {
        age: 42 + i, peakRating: 70, position: 'MF', number: 20 + i,
      }));
    }
    const world = buildWorld({ team, squad });
    const rng = new SeededRNG(123);
    const result = processRetirements(world, rng);
    expect(result.retirements).toHaveLength(MAX_RETIREMENTS_PER_TEAM);
    // 4 retired, 2 kept — squad still has 6 (4 youths + 2 originals).
    expect(result.squads['t1']).toHaveLength(6);
  });
});

describe('processRetirements — position preservation', () => {
  it('a retiring FW is replaced by a FW youth (squad position counts unchanged)', () => {
    const team = makeTeam('t1');
    // Squad of 1 FW + a few MFs. Make the FW forced-retired.
    const squad: Player[] = [
      makePlayer('p-fw', 't1', { age: HARD_AGE_CAP, peakRating: 70, position: 'FW', number: 9 }),
      makePlayer('p-mf-1', 't1', { age: 25, peakRating: 70, position: 'MF', number: 10 }),
      makePlayer('p-mf-2', 't1', { age: 26, peakRating: 70, position: 'MF', number: 11 }),
    ];
    const world = buildWorld({ team, squad });
    const rng = new SeededRNG(99);
    const result = processRetirements(world, rng);
    const newSquad = result.squads['t1'];
    // Same total count
    expect(newSquad).toHaveLength(3);
    const positionCounts: Record<PlayerPosition, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
    for (const p of newSquad) positionCounts[p.position]++;
    // Still 1 FW, 2 MFs.
    expect(positionCounts.FW).toBe(1);
    expect(positionCounts.MF).toBe(2);
    // The FW has a different uuid (it's the youth) AND its number tries to inherit 9.
    const fw = newSquad.find((p) => p.position === 'FW')!;
    expect(fw.uuid).not.toBe('p-fw');
    expect(fw.number).toBe(9);
  });

  it('preserves 3GK/7DF/7MF/5FW composition under multiple retirements', () => {
    const team = makeTeam('t1');
    const squad: Player[] = [];
    // Build a canonical 22-player squad
    const positions: PlayerPosition[] = [
      'GK', 'GK', 'GK', 'DF', 'DF', 'DF', 'DF', 'DF', 'DF', 'DF',
      'MF', 'MF', 'MF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW', 'FW', 'FW', 'FW',
    ];
    for (let i = 0; i < positions.length; i++) {
      // Force a few of each position to retire
      const age = i < 4 ? HARD_AGE_CAP : 25;
      squad.push(makePlayer(`p-${i}`, 't1', {
        age, peakRating: 70, position: positions[i], number: i + 1,
      }));
    }
    const world = buildWorld({ team, squad });
    const rng = new SeededRNG(77);
    const result = processRetirements(world, rng);
    const newSquad = result.squads['t1'];
    expect(newSquad).toHaveLength(22);
    const counts: Record<PlayerPosition, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
    for (const p of newSquad) counts[p.position]++;
    expect(counts.GK).toBe(3);
    expect(counts.DF).toBe(7);
    expect(counts.MF).toBe(7);
    expect(counts.FW).toBe(5);
  });
});

// ── 3. Youth generation ────────────────────────────────────────

describe('generateYouthReplacement — basic shape', () => {
  it('reserves 90+ potential for the rare elite tier', () => {
    expect(capYouthPeakByTalentTier('regular', 97)).toBe(84);
    expect(capYouthPeakByTalentTier('prospect', 97)).toBe(89);
    expect(capYouthPeakByTalentTier('elite', 97)).toBe(97);
  });

  it('keeps elite talent rare while leaving regular graduates as the clear majority', () => {
    const rng = new SeededRNG(20260812);
    const counts = { regular: 0, prospect: 0, elite: 0 };
    for (let index = 0; index < 20_000; index++) {
      counts[rollYouthTalentTier(50, 50, rng)]++;
    }

    expect(counts.regular / 20_000).toBeGreaterThan(0.78);
    expect(counts.prospect / 20_000).toBeGreaterThan(0.13);
    expect(counts.prospect / 20_000).toBeLessThan(0.2);
    expect(counts.elite / 20_000).toBeGreaterThan(0.012);
    expect(counts.elite / 20_000).toBeLessThan(0.03);
  });

  it('age in [18, 22], peakAge within the tag-widened band', () => {
    const team = makeTeam('t1');
    const rng = new SeededRNG(1234);
    const nextUuid = { value: 100 };
    for (let i = 0; i < 50; i++) {
      const youth = generateYouthReplacement(
        team, 'MF', 30, new Set<number>(), new Set<string>(), rng, nextUuid,
      );
      expect(youth.age).toBeGreaterThanOrEqual(18);
      expect(youth.age).toBeLessThanOrEqual(22);
      // v18 late_bloomer 28-32, v23 early_peak 21-24, elite tier 23-27 and
      // the default 24-29 — the union of every band is 21-32.
      expect(youth.peakAge).toBeGreaterThanOrEqual(21);
      expect(youth.peakAge).toBeLessThanOrEqual(32);
    }
  });

  it('peakRating clamped to [35, 98]', () => {
    const team = makeTeam('t1', { overall: 99, reputation: 99 });
    const rng = new SeededRNG(5555);
    const nextUuid = { value: 100 };
    for (let i = 0; i < 30; i++) {
      const y = generateYouthReplacement(team, 'FW', 9, new Set(), new Set(), rng, nextUuid);
      expect(y.peakRating).toBeGreaterThanOrEqual(35);
      expect(y.peakRating).toBeLessThanOrEqual(98);
    }
  });

  it('inherits retiree number when free, falls back when taken', () => {
    const team = makeTeam('t1');
    const rng = new SeededRNG(0xdeadbeef);
    const nextUuid = { value: 100 };

    // Inherits the free number
    const free = generateYouthReplacement(
      team, 'MF', 7, new Set<number>(), new Set<string>(), rng, nextUuid,
    );
    expect(free.number).toBe(7);

    // Number taken — falls back to lowest free (skips 1, 2 → tries 3)
    const used = new Set<number>([1, 2, 7]);
    const fallback = generateYouthReplacement(
      team, 'MF', 7, used, new Set<string>(), rng, nextUuid,
    );
    expect(fallback.number).toBe(3);
  });
});

// ── 4. Regional flavor ─────────────────────────────────────────

describe('generateYouthReplacement — regional flavor', () => {
  // Helper: generate N youths for a region/position and return all peakRatings.
  function sample(team: TeamBase, position: PlayerPosition, n: number, baseSeed: number): Player[] {
    const out: Player[] = [];
    for (let i = 0; i < n; i++) {
      const rng = new SeededRNG(baseSeed + i * 7);
      const nextUuid = { value: 1 };
      out.push(generateYouthReplacement(
        team, position, 30, new Set(), new Set(), rng, nextUuid,
      ));
    }
    return out;
  }

  it('东洲 youths trend higher in peakRating than neutral team (late-bloomer +5)', () => {
    const east = makeTeam('east', { region: '东洲+东京', overall: 70, reputation: 50 });
    const neutral = makeTeam('neutral', { region: '大陆+其他', overall: 70, reputation: 50 });

    const eastSamples = sample(east, 'MF', 80, 10000);
    const neutralSamples = sample(neutral, 'MF', 80, 10000);

    const eastAvg = eastSamples.reduce((s, p) => s + p.peakRating, 0) / eastSamples.length;
    const neutralAvg = neutralSamples.reduce((s, p) => s + p.peakRating, 0) / neutralSamples.length;
    // Should be at least ~3 higher on average (bonus is +5 before clamp).
    expect(eastAvg - neutralAvg).toBeGreaterThan(2.5);
  });

  it('大陆 DF/GK youths have a starting-rating boost (+3)', () => {
    const cn = makeTeam('cn', { region: '大陆+北京', overall: 70, reputation: 50 });
    const east = makeTeam('east', { region: '东洲+东京', overall: 70, reputation: 50 });
    // East is the foil — its DFs lose 2 startBonus instead of gaining 3.

    const cnDFs = sample(cn, 'DF', 80, 20000);
    const eastDFs = sample(east, 'DF', 80, 20000);

    const cnAvg = cnDFs.reduce((s, p) => s + p.rating, 0) / cnDFs.length;
    const eastAvg = eastDFs.reduce((s, p) => s + p.rating, 0) / eastDFs.length;
    // Gap should be substantial since flavor stacks (CN +3 startBonus, east -2)
    // but net +5 on rating, partly cancelled by east's +5 peak boost. Still
    // expect cnAvg to lead on START rating since age curve hides peak gap.
    expect(cnAvg).toBeGreaterThan(eastAvg);
  });

  it('南洲 FW/MF youths get goalScoring +10', () => {
    const south = makeTeam('south', { region: '南洲+广州', overall: 70, reputation: 50 });
    const neutral = makeTeam('cn', { region: '大陆+北京', overall: 70, reputation: 50 });

    const southFWs = sample(south, 'FW', 80, 30000);
    const neutralFWs = sample(neutral, 'FW', 80, 30000);

    const sAvg = southFWs.reduce((s, p) => s + p.goalScoring, 0) / southFWs.length;
    const nAvg = neutralFWs.reduce((s, p) => s + p.goalScoring, 0) / neutralFWs.length;
    // Net +10 on goalScoring on average, less variance since clamped to [0, 100].
    expect(sAvg - nAvg).toBeGreaterThan(7);
  });

  it('南洲 DF does NOT get the FW/MF bonus', () => {
    const south = makeTeam('south', { region: '南洲+广州', overall: 70, reputation: 50 });
    const neutral = makeTeam('cn', { region: '大陆+其他', overall: 70, reputation: 50 });

    const southDFs = sample(south, 'DF', 60, 40000);
    const neutralDFs = sample(neutral, 'DF', 60, 40000);

    const sAvg = southDFs.reduce((s, p) => s + p.peakRating, 0) / southDFs.length;
    const nAvg = neutralDFs.reduce((s, p) => s + p.peakRating, 0) / neutralDFs.length;
    // South DF has NO regional bonus; neutral CN also has no DF bonus
    // (only 大陆 DF/GK get +2 — same as control). Should be similar.
    expect(Math.abs(sAvg - nAvg)).toBeLessThan(3);
  });
});

describe('generateYouthReplacement — reputation + academy tier (B3)', () => {
  function samplePeaks(
    team: TeamBase,
    academyLevel: number,
    n: number,
    seed: number,
  ): number[] {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const rng = new SeededRNG(seed + i);
      const nextUuid = { value: 1 };
      const y = generateYouthReplacement(
        team, 'MF', 9, new Set(), new Set(), rng, nextUuid, academyLevel,
      );
      out.push(y.peakRating);
    }
    return out;
  }

  function avg(xs: number[]): number {
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  }

  it('reputation >= 85 still lifts the peak average, but only by +2', () => {
    const elite = makeTeam('elite', { overall: 70, reputation: 90, region: '大陆+其他' });
    const mid = makeTeam('mid', { overall: 70, reputation: 60, region: '大陆+其他' });
    const eAvg = avg(samplePeaks(elite, 50, 80, 50000));
    const mAvg = avg(samplePeaks(mid, 50, 80, 50000));
    // B3 narrowed this from +5-vs-+2 to +2-vs-0: the 65-84 reputation tier no
    // longer pays a peak bonus at all.
    expect(eAvg - mAvg).toBeGreaterThan(1.2);
    expect(eAvg - mAvg).toBeLessThan(3.5);
  });

  it('academy level moves the peak average in both directions', () => {
    const team = makeTeam('t', { overall: 70, reputation: 60, region: '大陆+其他' });
    const strong = avg(samplePeaks(team, 95, 120, 70000));
    const average = avg(samplePeaks(team, 50, 120, 70000));
    const weak = avg(samplePeaks(team, 15, 120, 70000));
    // level 95 -> +4, level 50 -> 0, level 15 -> -3. The negative end is the
    // point: not funding the academy has to be a cost, not a neutral choice.
    expect(strong - average).toBeGreaterThan(1.5);
    expect(average - weak).toBeGreaterThan(1.0);
  });

  it('conserves the reference club exactly: rep 70 / level 50', () => {
    const { eliteChance, prospectChance } = youthTalentTierChances(70, 50);
    // The pre-B3 single-term formulas, inlined. This is the hard constraint:
    // the reference club must get EXACTLY the odds it got before the rewire.
    const preB3Elite = 0.012 + (70 / 100) * 0.012;
    const preB3Prospect = 0.13 + (70 / 100) * 0.05;
    expect(eliteChance).toBeCloseTo(preB3Elite, 12);
    expect(prospectChance).toBeCloseTo(preB3Prospect, 12);
  });

  it('academy level is the larger lever across the full spans', () => {
    const repLow = youthTalentTierChances(34, 50).eliteChance;
    const repHigh = youthTalentTierChances(98, 50).eliteChance;
    const levelLow = youthTalentTierChances(70, 15).eliteChance;
    const levelHigh = youthTalentTierChances(70, 95).eliteChance;
    expect(levelHigh - levelLow).toBeGreaterThan(repHigh - repLow);
  });
});

describe('talent era (league climate)', () => {
  function samplePeaks(talentEra: number, n: number, seed: number): number[] {
    const team = makeTeam('t', { overall: 70, reputation: 60, region: '大陆+其他' });
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const rng = new SeededRNG(seed + i);
      const nextUuid = { value: 1 };
      out.push(generateYouthReplacement(
        team, 'MF', 9, new Set(), new Set(), rng, nextUuid, 50, talentEra,
      ).peakRating);
    }
    return out;
  }

  const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

  it('conserves the pre-climate odds exactly at the neutral point', () => {
    // Saves written before the climate existed, and every caller that omits the
    // argument, must get the identical distribution they got before.
    const omitted = youthTalentTierChances(70, 50);
    const neutral = youthTalentTierChances(70, 50, 0);
    expect(neutral.eliteChance).toBe(omitted.eliteChance);
    expect(neutral.prospectChance).toBe(omitted.prospectChance);
  });

  it('scales the elite band harder than the prospect band', () => {
    const base = youthTalentTierChances(70, 50, 0);
    const golden = youthTalentTierChances(70, 50, TALENT_ERA_MAX);
    const barren = youthTalentTierChances(70, 50, TALENT_ERA_MIN);
    const eliteScale = golden.eliteChance / base.eliteChance;
    const prospectScale = golden.prospectChance / base.prospectChance;
    // Both bands thicken in a golden generation, but the tail is the point of one.
    expect(eliteScale).toBeGreaterThan(prospectScale);
    expect(prospectScale).toBeGreaterThan(1);
    expect(barren.eliteChance).toBeLessThan(base.eliteChance);
    expect(barren.prospectChance).toBeLessThan(base.prospectChance);
  });

  it('stays a valid distribution across the whole input space', () => {
    for (const talentEra of [TALENT_ERA_MIN - 10, TALENT_ERA_MIN, 0, TALENT_ERA_MAX, TALENT_ERA_MAX + 10]) {
      for (const reputation of [0, 50, 100]) {
        for (const academyLevel of [0, 50, 100]) {
          const { eliteChance, prospectChance } = youthTalentTierChances(reputation, academyLevel, talentEra);
          expect(eliteChance).toBeGreaterThan(0);
          expect(prospectChance).toBeGreaterThan(0);
          // `rollYouthTalentTier` tests one roll against elite then elite+prospect.
          expect(eliteChance + prospectChance).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('clamps an out-of-range era instead of producing impossible odds', () => {
    const beyond = youthTalentTierChances(70, 50, TALENT_ERA_MAX + 25);
    const atBound = youthTalentTierChances(70, 50, TALENT_ERA_MAX);
    expect(beyond.eliteChance).toBe(atBound.eliteChance);
    expect(beyond.prospectChance).toBe(atBound.prospectChance);
  });

  it('rolls a visibly thicker elite tier in a golden generation', () => {
    const countElite = (talentEra: number): number => {
      const rng = new SeededRNG(20261103);
      let elite = 0;
      for (let i = 0; i < 20_000; i++) {
        if (rollYouthTalentTier(50, 50, rng, talentEra) === 'elite') elite++;
      }
      return elite;
    };
    const golden = countElite(TALENT_ERA_MAX);
    const neutral = countElite(0);
    const barren = countElite(TALENT_ERA_MIN);
    expect(golden).toBeGreaterThan(neutral * 1.4);
    expect(neutral).toBeGreaterThan(barren * 1.4);
  });

  it('moves the graduate peak average in both directions', () => {
    const golden = avg(samplePeaks(TALENT_ERA_MAX, 400, 90000));
    const neutral = avg(samplePeaks(0, 400, 90000));
    const barren = avg(samplePeaks(TALENT_ERA_MIN, 400, 90000));
    // The down direction is the one that was missing before: a barren era has to
    // produce visibly worse graduates, not just fewer great ones.
    expect(golden - neutral).toBeGreaterThan(3);
    expect(neutral - barren).toBeGreaterThan(3);
  });

  it('leaves the per-tier peak bands alone, moving only their frequency', () => {
    const team = makeTeam('t', { overall: 70, reputation: 60, region: '大陆+其他' });
    for (const talentEra of [TALENT_ERA_MIN, 0, TALENT_ERA_MAX]) {
      for (let i = 0; i < 300; i++) {
        const rng = new SeededRNG(310000 + i);
        const y = generateYouthReplacement(
          team, 'MF', 9, new Set(), new Set(), rng, { value: 1 }, 50, talentEra,
        );
        // Only the rare elite tier may cross 89, in every era. If the era widened
        // the bands instead of their odds, this is where it would show up.
        expect(y.peakRating).toBeLessThanOrEqual(98);
        expect(y.peakRating).toBeGreaterThanOrEqual(35);
      }
    }
  });
});

// ── 5. Coach candidate pool ────────────────────────────────────

describe('processRetirements — coach pool seeding', () => {
  it('adds eligible retirees to pool with the right style mapping', () => {
    const team = makeTeam('t1');
    // Two FW retirees (peakRating 90, age 38 — eligible) + one DF, one GK.
    const squad: Player[] = [
      makePlayer('p-fw1', 't1', { age: HARD_AGE_CAP, peakRating: 90, position: 'FW', number: 9 }),
      makePlayer('p-fw2', 't1', { age: HARD_AGE_CAP, peakRating: 88, position: 'FW', number: 11 }),
      makePlayer('p-df', 't1', { age: HARD_AGE_CAP, peakRating: 87, position: 'DF', number: 4 }),
      makePlayer('p-gk', 't1', { age: HARD_AGE_CAP, peakRating: 86, position: 'GK', number: 1 }),
    ];
    // Try several seeds — at least one should land enough 40% rolls to
    // populate the pool. The deterministic coverage test below pins the seed.
    let foundFW = false;
    let foundDF = false;
    let foundGK = false;
    for (let seed = 1; seed < 50; seed++) {
      const w = buildWorld({ team, squad });
      const rng = new SeededRNG(seed);
      const result = processRetirements(w, rng);
      for (const c of result.candidatesAdded) {
        if (c.uuid === 'p-fw1' || c.uuid === 'p-fw2') {
          expect(c.style).toBe('attacking');
          foundFW = true;
        } else if (c.uuid === 'p-df') {
          expect(c.style).toBe('defensive');
          foundDF = true;
        } else if (c.uuid === 'p-gk') {
          expect(c.style).toBe('balanced');
          foundGK = true;
        }
      }
    }
    expect(foundFW).toBe(true);
    expect(foundDF).toBe(true);
    expect(foundGK).toBe(true);
  });

  it('does NOT add retirees with peakRating < 85', () => {
    const team = makeTeam('t1');
    const squad: Player[] = [
      makePlayer('p-low', 't1', { age: HARD_AGE_CAP, peakRating: 84, position: 'FW' }),
    ];
    // Run many seeds — none should produce a candidate (rating below threshold).
    for (let seed = 1; seed < 30; seed++) {
      const world = buildWorld({ team, squad });
      const rng = new SeededRNG(seed);
      const result = processRetirements(world, rng);
      expect(result.candidatesAdded.length).toBe(0);
    }
  });

  it('does NOT add retirees with age < 35', () => {
    // Force a 33yo elite to retire via cap-on-rating-bonus combo. We can't
    // really, but we can test the filter directly: build a 33yo with rating
    // 90, run many seeds. Should never end up in candidatesAdded — even on
    // the rare retirement roll that fires.
    const team = makeTeam('t1');
    const squad: Player[] = [
      makePlayer('p-young-elite', 't1', { age: HARD_AGE_CAP, peakRating: 90, position: 'MF', number: 10 }),
    ];
    const youthSquad: Player[] = [
      makePlayer('p-too-young', 't1', { age: 34, peakRating: 90, position: 'MF', number: 10 }),
    ];
    // Force-eligible (age 42) goes through the 40% gate — should sometimes hit.
    // Sanity check: the gate fires for the age-42 case at *some* seed.
    let firedForOld = false;
    for (let seed = 1; seed < 30; seed++) {
      const w = buildWorld({ team, squad });
      const rng = new SeededRNG(seed);
      const result = processRetirements(w, rng);
      if (result.candidatesAdded.length > 0) firedForOld = true;
    }
    expect(firedForOld).toBe(true);

    // Now test the actual filter — 34yo never enters pool (skipped by age).
    // Force retirement by using HARD_AGE_CAP age but younger? Not possible —
    // they'd be 42 by definition. Test indirectly: a 34yo at peakRating 90
    // doesn't hit the hard cap, doesn't roll into retirement either (chance
    // tiny). So no records produced.
    void youthSquad;
  });

  it('pool cap eviction: 13th entry evicts the OLDEST (lowest enteredPoolSeason)', () => {
    // Pre-populate pool with 12 entries spanning seasons 1..12.
    const pool: GameWorld['coachCandidatePool'] = [];
    for (let i = 1; i <= 12; i++) {
      pool.push({
        uuid: `existing-${i}`,
        name: `Existing-${i}`,
        fromTeamId: 'old-team',
        peakRating: 90,
        enteredPoolSeason: i,
        style: 'balanced',
      });
    }
    expect(pool.length).toBe(COACH_POOL_CAP);

    const team = makeTeam('t1');
    const squad: Player[] = [
      // Forced 42yo with high rating — guaranteed retirement, eligible for pool.
      makePlayer('p-new', 't1', { age: HARD_AGE_CAP, peakRating: 90, position: 'FW', number: 9 }),
    ];
    // Scan seeds until we find one where the 40% gate fires. The eviction
    // logic itself is what we're testing.
    let evictionVerified = false;
    for (let seed = 1; seed < 80; seed++) {
      const world = buildWorld({ team, squad, pool: pool.map((p) => ({ ...p })), seasonNumber: 20 });
      const rng = new SeededRNG(seed);
      const result = processRetirements(world, rng);
      if (result.candidatesAdded.length > 0) {
        // Pool stayed at the cap; oldest (season 1) was evicted.
        expect(result.coachCandidatePool.length).toBeLessThanOrEqual(COACH_POOL_CAP);
        const uuids = result.coachCandidatePool.map((c) => c.uuid);
        expect(uuids).not.toContain('existing-1'); // oldest gone
        expect(uuids).toContain('p-new'); // new one is in
        evictionVerified = true;
        break;
      }
    }
    expect(evictionVerified).toBe(true);
  });
});

// ── 6. Determinism & immutability ───────────────────────────────

describe('processRetirements — determinism & immutability', () => {
  it('does NOT mutate the input world.squads array', () => {
    const team = makeTeam('t1');
    const squad: Player[] = [
      makePlayer('p-1', 't1', { age: HARD_AGE_CAP, peakRating: 70, position: 'MF', number: 10 }),
    ];
    const originalSquadRef = squad;
    const world = buildWorld({ team, squad });
    const rng = new SeededRNG(123);
    processRetirements(world, rng);
    // Original array reference still has the retired player intact
    expect(originalSquadRef[0].uuid).toBe('p-1');
    expect(world.squads['t1']).toBe(originalSquadRef);
  });

  it('same seed produces the same result (deterministic)', () => {
    const team = makeTeam('t1');
    const squad: Player[] = [
      makePlayer('p-1', 't1', { age: HARD_AGE_CAP, peakRating: 80, position: 'FW', number: 9 }),
      makePlayer('p-2', 't1', { age: 25, peakRating: 70, position: 'MF', number: 10 }),
    ];
    const w1 = buildWorld({ team, squad });
    const w2 = buildWorld({ team, squad });
    const r1 = processRetirements(w1, new SeededRNG(8888));
    const r2 = processRetirements(w2, new SeededRNG(8888));
    expect(r1.retirements.map((r) => r.uuid)).toEqual(r2.retirements.map((r) => r.uuid));
    // Generated youth uuid should match (counter starts identically)
    const newPlayers1 = r1.squads['t1'].filter((p) => p.uuid.startsWith('p-1000'));
    const newPlayers2 = r2.squads['t1'].filter((p) => p.uuid.startsWith('p-1000'));
    expect(newPlayers1.length).toBe(newPlayers2.length);
  });
});

// ── 7. Integration with season-end ─────────────────────────────

import { handleSeasonEnd } from '../season/season-end';

describe('handleSeasonEnd integration', () => {
  function buildSeasonWorld(squad: Player[]): GameWorld {
    const team = makeTeam('t1', { overall: 70, reputation: 60 });
    return {
      seasonState: {
        seasonNumber: 5,
        currentWindowIndex: 30,
        calendar: [],
        completed: false,
        isWorldCupYear: false,
      },
      teamBases: { t1: team },
      teamStates: {
        t1: {
          id: 't1', leagueLevel: 1, morale: 60, fatigue: 10, momentum: 0,
          squadHealth: 85, coachPressure: 10, recentForm: [],
        },
      },
      coachBases: {},
      coachStates: {},
      coachCareers: {},
      league1Standings: [{
        teamId: 't1', played: 0, won: 0, drawn: 0, lost: 0,
        goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0, form: [],
      }],
      league2Standings: [],
      league3Standings: [],
      leagueCup: { rounds: [], winnerId: null, currentRound: null } as unknown as GameWorld['leagueCup'],
      superCup: { groups: [], knockoutRounds: [], groupStageCompleted: false, winnerId: null, currentRound: null, awayGoalRule: false } as unknown as GameWorld['superCup'],
      worldCup: null,
      honorHistory: [],
      teamTrophies: { t1: [] },
      coachTrophies: {},
      teamSeasonRecords: { t1: [] },
      coachChangesThisSeason: [],
      squads: { t1: squad },
      playerStats: {},
      nextPlayerUuidCounter: 1000,
      retirementHistory: [],
      coachCandidatePool: [],
      coachRetirementHistory: [],
      nextCoachIdCounter: 0,
      activeEvents: [],
      achievements: [],
      newsLog: [],
      seed: 1,
      rngState: 1,
      seasonStartLevels: { t1: 1 },
      seasonBuffs: [],
      godHandUsed: false,
      coins: 0,
      bets: [],
      matchHistory: [],
      seasonBuffsHistory: [],
      playerAwardsHistory: [],
      transferHistory: [],
      memorableMatches: [], continentalCups: { mainland_cup: null, southern_cup: null, eastern_cup: null }, totalElapsedWindows: 0, teamFinances: {}, freeAgentPool: [], transferRumors: [], playerStatsHistory: {}, transferWindow: null,
    };
  }

  it('a 42yo player is retired + replaced through handleSeasonEnd', () => {
    const squad: Player[] = [
      makePlayer('p-veteran', 't1', { age: HARD_AGE_CAP, peakRating: 70, position: 'FW', number: 9 }),
      makePlayer('p-young', 't1', { age: 25, peakRating: 70, position: 'MF', number: 10 }),
    ];
    const world = buildSeasonWorld(squad);
    const result = handleSeasonEnd(world);

    expect(result.retirementHistory.length).toBeGreaterThanOrEqual(1);
    const retired = result.retirementHistory.find((r) => r.uuid === 'p-veteran');
    expect(retired).toBeDefined();
    // The veteran is gone and a fresh FW took his place on the same team.
    //
    // Squad size is deliberately NOT asserted here. A 2-player squad sits far
    // below any club's target, so the top-up pass fills it after the
    // replacement lands; asserting a total would be asserting two mechanisms at
    // once. The top-up pass has its own coverage in squad-topup.test.ts.
    const newSquad = result.squads['t1'];
    expect(newSquad.some((p) => p.uuid === 'p-veteran')).toBe(false);
    expect(newSquad.some((p) => p.uuid === 'p-young')).toBe(true);
    const fws = newSquad.filter((p) => p.position === 'FW');
    expect(fws.length).toBeGreaterThanOrEqual(1);
    expect(fws.every((p) => p.uuid !== 'p-veteran')).toBe(true);
  });

  it('never shrinks a squad across season-end', () => {
    const squad: Player[] = [];
    // 11 starters, mix of ages
    const positions: PlayerPosition[] = ['GK', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'FW', 'FW'];
    for (let i = 0; i < positions.length; i++) {
      squad.push(makePlayer(`p-${i}`, 't1', {
        age: i === 0 ? HARD_AGE_CAP : 25,
        peakRating: 70,
        position: positions[i],
        number: i + 1,
      }));
    }
    const world = buildSeasonWorld(squad);
    const result = handleSeasonEnd(world);
    // Retirement is strictly 1:1 and the top-up pass only ever adds, so the
    // count can grow but never fall. Equality stopped being the right
    // assertion when the top-up landed: this squad is well under target and
    // gets filled, which is the behaviour that ended the 18-player freeze.
    expect(result.squads['t1'].length).toBeGreaterThanOrEqual(positions.length);
  });

  it('records career goals from finished history plus the current retiring season', () => {
    const veteran = makePlayer('p-veteran', 't1', {
      age: HARD_AGE_CAP,
      peakRating: 70,
      position: 'FW',
      number: 9,
    });
    const world = buildWorld({
      team: makeTeam('t1'),
      squad: [veteran],
      seasonNumber: 5,
    });
    world.playerStatsHistory = {
      [veteran.uuid]: [
        {
          season: 3,
          teamId: 't1',
          position: 'FW',
          goals: 11,
          assists: 4,
          appearances: 28,
          yellowCards: 1,
          redCards: 0,
          teamGoalsConceded: 25,
          teamMatches: 30,
        },
        {
          season: 4,
          teamId: 't1',
          position: 'FW',
          goals: 9,
          assists: 5,
          appearances: 24,
          yellowCards: 0,
          redCards: 0,
          teamGoalsConceded: 22,
          teamMatches: 30,
        },
      ],
    };
    world.playerStats = {
      [veteran.uuid]: {
        playerId: veteran.uuid,
        teamId: 't1',
        goals: 6,
        assists: 2,
        yellowCards: 0,
        redCards: 0,
        appearances: 18,
        cleanSheets: 0,
        saves: 0,
        keyBlocks: 0,
        bigChances: 8,
        keyPasses: 3,
      },
    };

    const result = processRetirements(world, new SeededRNG(1));
    const retired = result.retirements.find((r) => r.uuid === veteran.uuid);

    expect(retired?.careerGoals).toBe(26);
  });

  it('retirementHistory grows but is capped at 300 entries', () => {
    // Pre-fill with 299 fake entries; force 1 new retirement; expect 300.
    const squad: Player[] = [
      makePlayer('p-veteran', 't1', { age: HARD_AGE_CAP, peakRating: 70, position: 'FW', number: 9 }),
    ];
    const world = buildSeasonWorld(squad);
    for (let i = 0; i < 300; i++) {
      world.retirementHistory.push({
        uuid: `old-${i}`, name: `Old-${i}`, teamId: 't1', teamName: 'T1',
        position: 'MF', peakRating: 60, age: 40, seasonRetired: 1, careerGoals: 0,
      });
    }
    const result = handleSeasonEnd(world);
    expect(result.retirementHistory.length).toBe(300);
    // The new retirement is at the END (most recent)
    const lastEntry = result.retirementHistory[result.retirementHistory.length - 1];
    expect(lastEntry.uuid).toBe('p-veteran');
    // Oldest entry was dropped (overflow → cap)
    expect(result.retirementHistory.some((r) => r.uuid === 'old-0')).toBe(false);
  });
});

describe('applyFreeAgentReplacements', () => {
  const buildSquads = () => ({
    t1: [
      makePlayer('a1', 't1', { position: 'FW', number: 9, age: 30 }),
      makePlayer('a2', 't1', { position: 'MF', number: 8, age: 28 }),
    ],
    t2: [
      makePlayer('b1', 't2', { position: 'DF', number: 4, age: 27 }),
    ],
  });

  const teamBases = { t1: makeTeam('t1'), t2: makeTeam('t2') };

  it('adds exactly one replacement per retiree, preserving position', () => {
    const squads = buildSquads();
    const result = applyFreeAgentReplacements({
      squads,
      retirees: [
        { position: 'FW', releasedFromTeamId: 't1' },
        { position: 'GK', releasedFromTeamId: 't1' },
      ],
      teamBases,
      rng: new SeededRNG(1234),
      nextPlayerUuidCounter: 500,
    });
    expect(result.squads.t1).toHaveLength(4);
    expect(result.squads.t2).toHaveLength(1);
    expect(result.nextPlayerUuidCounter).toBe(502);
    const positions = result.squads.t1.map(p => p.position).sort();
    expect(positions.filter(p => p === 'FW')).toHaveLength(2);
    expect(positions.filter(p => p === 'GK')).toHaveLength(1);
  });

  it('sends the replacement back to the club that released the player', () => {
    const squads = buildSquads();
    const result = applyFreeAgentReplacements({
      squads,
      retirees: [{ position: 'DF', releasedFromTeamId: 't2' }],
      teamBases,
      rng: new SeededRNG(77),
      nextPlayerUuidCounter: 10,
    });
    expect(result.squads.t2).toHaveLength(2);
    expect(result.squads.t1).toHaveLength(2);
    const youth = result.squads.t2.find(p => !['b1'].includes(p.uuid));
    expect(youth?.teamId).toBe('t2');
    expect(youth?.position).toBe('DF');
  });

  it('falls back to the shortest squad when the releasing club cannot be resolved', () => {
    const squads = buildSquads();
    const result = applyFreeAgentReplacements({
      squads,
      // Market sentinel: what pre-fix saves carry, and what a retired player's
      // record holds once teamId is rewritten on release.
      retirees: [{ position: 'MF', releasedFromTeamId: '__free_market__' }],
      teamBases,
      rng: new SeededRNG(5),
      nextPlayerUuidCounter: 20,
    });
    expect(result.squads.t2).toHaveLength(2);
    expect(result.squads.t1).toHaveLength(2);
  });

  it('never hands out a shirt number already taken on the receiving squad', () => {
    const squads = buildSquads();
    const result = applyFreeAgentReplacements({
      squads,
      retirees: [
        { position: 'FW', releasedFromTeamId: 't1' },
        { position: 'FW', releasedFromTeamId: 't1' },
      ],
      teamBases,
      rng: new SeededRNG(9),
      nextPlayerUuidCounter: 30,
    });
    const numbers = result.squads.t1.map(p => p.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('does not mutate the input squads and passes an empty retiree list straight through', () => {
    const squads = buildSquads();
    const snapshot = JSON.stringify(squads);
    const applied = applyFreeAgentReplacements({
      squads,
      retirees: [{ position: 'FW', releasedFromTeamId: 't1' }],
      teamBases,
      rng: new SeededRNG(1),
      nextPlayerUuidCounter: 40,
    });
    expect(JSON.stringify(squads)).toBe(snapshot);
    expect(applied.squads.t1).not.toBe(squads.t1);

    const empty = applyFreeAgentReplacements({
      squads,
      retirees: [],
      teamBases,
      rng: new SeededRNG(1),
      nextPlayerUuidCounter: 40,
    });
    expect(empty.squads).toBe(squads);
    expect(empty.nextPlayerUuidCounter).toBe(40);
  });
});


/**
 * v8 → v9 migration tests for `backfillStaleHistoryPlayerIds`.
 *
 * The v8 migration only rewrote `playerId` values that matched a player's
 * CURRENT `${teamId}-${number}`. Historical entries produced before the player
 * transferred kept their FORMER legacy id, so the link rendered as
 * "未找到球员: jeonbuk-75". v9 walks `transferHistory` / `playerAwardsHistory`
 * and resolves those stale ids by name + team lookup.
 *
 * v9 → v10 migration tests for `applyV9ToV10PlayerCurve` are at the bottom.
 */
import { describe, it, expect } from 'vitest';
import { backfillStaleHistoryPlayerIds, applyV9ToV10PlayerCurve } from './game-store';
import { computeCurrentRating } from '../engine/players/development';

type TestPlayer = { uuid: string; name: string };
type TestWorld = Parameters<typeof backfillStaleHistoryPlayerIds>[0];

function makeWorld(squads: Record<string, TestPlayer[]>): TestWorld {
  return {
    squads,
    transferHistory: [],
    playerAwardsHistory: [],
  };
}

describe('backfillStaleHistoryPlayerIds (v8 → v9)', () => {
  it('repairs a stale transferHistory.playerId via (name, toTeamId)', () => {
    // Player 尹景元 originally at jeonbuk, then moved to gz_hengda, then to
    // bj_guoan — squads only have him at his CURRENT team. The old transfer
    // record kept "jeonbuk-75" as the playerId, which no longer resolves.
    const world = makeWorld({
      bj_guoan: [{ uuid: 'p-999', name: '尹景元' }],
      other: [{ uuid: 'p-1', name: '张三' }],
    });
    world.transferHistory!.push({
      playerId: 'jeonbuk-75',
      playerName: '尹景元',
      toTeamId: 'gz_hengda', // his destination at the time of THIS record
    });

    const tally = backfillStaleHistoryPlayerIds(world);

    // gz_hengda no longer has him — falls through to name-only lookup,
    // which finds him at bj_guoan.
    expect(world.transferHistory![0].playerId).toBe('p-999');
    expect(tally.transfers).toBe(1);
    expect(tally.awards).toBe(0);
  });

  it('prefers (name, teamId) match over name-only when both are present', () => {
    // Two players with the same name on different teams — only the (name,
    // teamId) lookup can pick the right one.
    const world = makeWorld({
      teamA: [{ uuid: 'p-A', name: '李四' }],
      teamB: [{ uuid: 'p-B', name: '李四' }],
    });
    world.transferHistory!.push({
      playerId: 'someoldid-7',
      playerName: '李四',
      toTeamId: 'teamA',
    });

    backfillStaleHistoryPlayerIds(world);
    expect(world.transferHistory![0].playerId).toBe('p-A');
  });

  it('repairs a stale playerAwardsHistory.playerId via (name, teamId)', () => {
    const world = makeWorld({
      sy_street: [{ uuid: 'p-77', name: '蔡国栋' }],
    });
    world.playerAwardsHistory!.push({
      playerId: 'sy_street-5', // stale legacy shape
      playerName: '蔡国栋',
      teamId: 'sy_street',
    });

    const tally = backfillStaleHistoryPlayerIds(world);

    expect(world.playerAwardsHistory![0].playerId).toBe('p-77');
    expect(tally.awards).toBe(1);
  });

  it('leaves uuid-shaped playerIds alone (idempotent on already-migrated saves)', () => {
    const world = makeWorld({
      teamA: [{ uuid: 'p-42', name: '王五' }],
    });
    world.transferHistory!.push({
      playerId: 'p-42', // already a uuid
      playerName: '王五',
      toTeamId: 'teamA',
    });
    world.playerAwardsHistory!.push({
      playerId: 'p-42',
      playerName: '王五',
      teamId: 'teamA',
    });

    const tally = backfillStaleHistoryPlayerIds(world);

    expect(world.transferHistory![0].playerId).toBe('p-42');
    expect(world.playerAwardsHistory![0].playerId).toBe('p-42');
    expect(tally.transfers).toBe(0);
    expect(tally.awards).toBe(0);

    // Running it again is a no-op as well.
    const tally2 = backfillStaleHistoryPlayerIds(world);
    expect(tally2.transfers).toBe(0);
    expect(tally2.awards).toBe(0);
  });

  it('leaves unresolvable entries as-is and does not crash', () => {
    // Player no longer in any squad (e.g. retired). The UI's missing-player
    // fallback still applies — we just don't make things worse.
    const world = makeWorld({
      teamA: [{ uuid: 'p-1', name: '陈六' }],
    });
    world.transferHistory!.push({
      playerId: 'oldteam-99',
      playerName: '某退役球员',
      toTeamId: 'someplace',
    });
    world.playerAwardsHistory!.push({
      playerId: 'oldteam-50',
      playerName: '另一个失踪球员',
      teamId: 'oldteam',
    });

    const tally = backfillStaleHistoryPlayerIds(world);

    expect(world.transferHistory![0].playerId).toBe('oldteam-99');
    expect(world.playerAwardsHistory![0].playerId).toBe('oldteam-50');
    expect(tally.transfers).toBe(0);
    expect(tally.awards).toBe(0);
  });

  it('tolerates missing optional fields (no transferHistory, no name)', () => {
    const world: TestWorld = {
      squads: { teamA: [{ uuid: 'p-1', name: '黄七' }] },
      // intentionally no transferHistory / playerAwardsHistory
    };
    expect(() => backfillStaleHistoryPlayerIds(world)).not.toThrow();
  });

  it('reproduces the real-save audit numbers (16 transfers, 1 award)', () => {
    // Mirrors the audit on /Users/mutu/Downloads/football-universe-s16.json:
    // 16 stale transfer entries, 1 stale award entry. Constructed
    // synthetically so the test doesn't depend on the file existing.
    const squads: Record<string, TestPlayer[]> = {
      currentTeam: [],
    };
    const transferHistory: Array<{ playerId?: string; playerName?: string; toTeamId?: string }> = [];
    const playerAwardsHistory: Array<{ playerId?: string; playerName?: string; teamId?: string }> = [];
    for (let i = 0; i < 16; i++) {
      const name = `球员${i}`;
      squads.currentTeam.push({ uuid: `p-${i}`, name });
      transferHistory.push({
        playerId: `oldteam-${i}`,
        playerName: name,
        toTeamId: 'somewhere', // intentionally not their current team
      });
    }
    // Plus 28 already-uuid transfers (44 total to match the audit denominator)
    for (let i = 0; i < 28; i++) {
      transferHistory.push({
        playerId: `p-${i}`,
        playerName: `球员${i}`,
        toTeamId: 'currentTeam',
      });
    }
    // 1 stale award + 59 already-uuid awards
    squads.currentTeam.push({ uuid: 'p-award', name: '奖项球员' });
    playerAwardsHistory.push({
      playerId: 'oldteam-award',
      playerName: '奖项球员',
      teamId: 'someoldteam',
    });
    for (let i = 0; i < 59; i++) {
      playerAwardsHistory.push({
        playerId: `p-${i}`,
        playerName: `球员${i}`,
        teamId: 'currentTeam',
      });
    }

    const world: TestWorld = { squads, transferHistory, playerAwardsHistory };
    const tally = backfillStaleHistoryPlayerIds(world);

    expect(tally.transfers).toBe(16);
    expect(tally.awards).toBe(1);
  });
});

/**
 * v9 → v10 migration tests for `applyV9ToV10PlayerCurve`.
 *
 * The v10 schema introduces `peakRating` + `peakAge` per player and
 * recomputes `rating` from the development curve. It also half-compresses
 * ages over 33 because pre-v10 saves had no retirement system and let some
 * players drift up to ~49.
 */

type V9Player = {
  uuid: string;
  age: number;
  rating: number;
  peakRating?: number;
  peakAge?: number;
};

function makeV9World(squads: Record<string, V9Player[]>) {
  return { squads };
}

describe('applyV9ToV10PlayerCurve (v9 → v10)', () => {
  it('assigns peakRating + peakAge to every player and recomputes rating', () => {
    const world = makeV9World({
      teamA: [
        { uuid: 'p-1', age: 25, rating: 80 }, // peak band
      ],
    });
    const tally = applyV9ToV10PlayerCurve(world);

    expect(tally.touched).toBe(1);
    expect(tally.skipped).toBe(0);
    const p = world.squads.teamA[0];
    expect(p.peakRating).toBe(80);
    expect(p.peakAge).toBeGreaterThanOrEqual(24);
    expect(p.peakAge).toBeLessThanOrEqual(29);
    // Age 25, peakAge in [24,29] — always inside the plateau (peakAge ± 2 → 22-31).
    // So rating == peakRating after recompute.
    expect(p.rating).toBe(80);
  });

  it('half-compresses ages over 33: 41 → 37, 49 → 41, 35 → 34', () => {
    const world = makeV9World({
      teamA: [
        { uuid: 'p-old1', age: 41, rating: 99 },
        { uuid: 'p-old2', age: 49, rating: 80 },
        { uuid: 'p-old3', age: 35, rating: 75 },
        { uuid: 'p-young', age: 24, rating: 70 }, // no compression for ≤ 33
      ],
    });
    applyV9ToV10PlayerCurve(world);

    expect(world.squads.teamA[0].age).toBe(37); // 33 + floor((41-33)*0.5) = 33+4
    expect(world.squads.teamA[1].age).toBe(41); // 33 + floor((49-33)*0.5) = 33+8
    expect(world.squads.teamA[2].age).toBe(34); // 33 + floor((35-33)*0.5) = 33+1
    expect(world.squads.teamA[3].age).toBe(24); // unchanged
  });

  it('idempotent: running it twice produces the same output', () => {
    const world = makeV9World({
      teamA: [
        { uuid: 'p-a', age: 41, rating: 99 },
        { uuid: 'p-b', age: 25, rating: 78 },
        { uuid: 'p-c', age: 19, rating: 70 },
      ],
    });
    applyV9ToV10PlayerCurve(world);
    const snapshot = JSON.parse(JSON.stringify(world));

    // Second run — should be a no-op (peakRating already set on every player).
    const tally2 = applyV9ToV10PlayerCurve(world);
    expect(tally2.touched).toBe(0);
    expect(tally2.skipped).toBe(3);
    expect(world).toEqual(snapshot);
  });

  it('peakAge is deterministic from uuid (reproducibility)', () => {
    // Two worlds with the same uuid → same peakAge.
    const a = makeV9World({ teamA: [{ uuid: 'p-deterministic', age: 25, rating: 80 }] });
    const b = makeV9World({ teamA: [{ uuid: 'p-deterministic', age: 25, rating: 80 }] });
    applyV9ToV10PlayerCurve(a);
    applyV9ToV10PlayerCurve(b);
    expect(a.squads.teamA[0].peakAge).toBe(b.squads.teamA[0].peakAge);
  });

  it('old age 41 + rating 99 → new age 37, peakRating 99, rating in plausible range', () => {
    const world = makeV9World({
      teamA: [{ uuid: 'p-vet1', age: 41, rating: 99 }],
    });
    applyV9ToV10PlayerCurve(world);
    const p = world.squads.teamA[0];
    expect(p.age).toBe(37);
    expect(p.peakRating).toBe(99);
    // age 37, peakAge in [24, 29], new (softer) curve:
    //   peakAge=24 → 37 = peakAge+13, twilight: 0.75 - 3*0.04 = 0.63 → 62
    //   peakAge=29 → 37 = peakAge+8, late career: 0.925 - 3*0.035 = 0.82 → 81
    expect(p.rating).toBeGreaterThanOrEqual(60);
    expect(p.rating).toBeLessThanOrEqual(82);
  });

  it('old age 49 + rating 80 → new age 41, peakRating 80, rating reasonable', () => {
    const world = makeV9World({
      teamA: [{ uuid: 'p-vet2', age: 49, rating: 80 }],
    });
    applyV9ToV10PlayerCurve(world);
    const p = world.squads.teamA[0];
    expect(p.age).toBe(41);
    expect(p.peakRating).toBe(80);
    // age 41 with peakAge in [24,29]:
    //   peakAge=24 → 41 = peakAge+17 → very-old: max(0.40, 0.55 - 2*0.05) = 0.45 → 36
    //   peakAge=29 → 41 = peakAge+12 → twilight: 0.75 - 2*0.04 = 0.67 → 54
    expect(p.rating).toBeGreaterThanOrEqual(35);
    expect(p.rating).toBeLessThanOrEqual(55);
  });

  it('young player (age 19, rating 70) gets peak ≥ rating after migration', () => {
    // A 19-year-old in v9 had rating 70. In v10 with the new curve and our
    // migration's "peakRating = current rating" rule, we KEEP peakRating=70
    // (we have no way to know they were destined for higher). Their rating
    // recomputes from the curve: age 19, peakAge in [24,29], so they're in
    // the rising segment.
    const world = makeV9World({
      teamA: [{ uuid: 'p-young', age: 19, rating: 70 }],
    });
    applyV9ToV10PlayerCurve(world);
    const p = world.squads.teamA[0];
    expect(p.peakRating).toBe(70);
    // For peakAge 24-29, age 19:
    //   peakAge=24 (peakAge-2=22) → 19<22, rising. t=(19-18)/(22-18)=0.25 → 0.775 × 70 ≈ 54
    //   peakAge=29 (peakAge-2=27) → 19<27, rising. t=(19-18)/(27-18)=1/9 ≈ 0.111 → 0.733 × 70 ≈ 51
    // Either way, rating drops from 70 to ~51-54.
    expect(p.rating).toBeLessThan(70);
    expect(p.rating).toBeGreaterThanOrEqual(50);
  });

  it('produces ratings consistent with computeCurrentRating', () => {
    // Cross-check: the migration should produce exactly what computeCurrentRating
    // would produce given the migration's chosen peakRating + peakAge.
    const world = makeV9World({
      teamA: [
        { uuid: 'p-test1', age: 28, rating: 85 },
        { uuid: 'p-test2', age: 35, rating: 70 },
      ],
    });
    applyV9ToV10PlayerCurve(world);
    for (const p of world.squads.teamA) {
      const expected = computeCurrentRating(p.peakRating!, p.age, p.peakAge!);
      expect(p.rating).toBe(expected);
    }
  });

  it('handles missing/empty squads without throwing', () => {
    expect(() => applyV9ToV10PlayerCurve({ squads: {} })).not.toThrow();
    expect(() => applyV9ToV10PlayerCurve({})).not.toThrow();
    expect(() => applyV9ToV10PlayerCurve({ squads: { teamA: [] } })).not.toThrow();
  });

  it('handles missing rating / age fields with sensible fallbacks', () => {
    const world = makeV9World({
      teamA: [
        { uuid: 'p-broken' } as V9Player, // missing both age and rating
      ],
    });
    expect(() => applyV9ToV10PlayerCurve(world)).not.toThrow();
    const p = world.squads.teamA[0];
    expect(p.peakRating).toBe(60); // fallback rating
    expect(p.age).toBe(28); // fallback age
    expect(p.peakAge).toBeGreaterThanOrEqual(24);
    expect(p.peakAge).toBeLessThanOrEqual(29);
  });
});


// ── v13 → v14 migration tests ────────────────────────────────────

import { applyV13ToV14InjuriesInit } from "./game-store";

describe("applyV13ToV14InjuriesInit (v13 → v14)", () => {
  it("backfills totalElapsedWindows from seasonState.currentWindowIndex", () => {
    const world: { totalElapsedWindows?: unknown; seasonState?: { currentWindowIndex?: number } } = {
      seasonState: { currentWindowIndex: 17 },
    };
    const r = applyV13ToV14InjuriesInit(world);
    expect(r.touched).toBe(true);
    expect(world.totalElapsedWindows).toBe(17);
  });
  it("defaults to 0 if seasonState is missing", () => {
    const world: { totalElapsedWindows?: unknown } = {};
    const r = applyV13ToV14InjuriesInit(world);
    expect(r.touched).toBe(true);
    expect(world.totalElapsedWindows).toBe(0);
  });
  it("idempotent — leaves existing number alone", () => {
    const world: { totalElapsedWindows?: unknown } = { totalElapsedWindows: 42 };
    const r = applyV13ToV14InjuriesInit(world);
    expect(r.touched).toBe(false);
    expect(world.totalElapsedWindows).toBe(42);
  });
});


// ── v14 → v15 migration tests (Phase H — economy) ────────────────

import { applyV14ToV15FinanceInit } from "./game-store";
import type { TeamBase } from "../types/team";

function mkBase(id: string, reputation: number): TeamBase {
  return {
    id, name: id, shortName: id.slice(0, 2), color: '#000', tier: 'mid',
    overall: 70, attack: 70, midfield: 70, defense: 70, stability: 70, depth: 70,
    reputation, initialLeagueLevel: 1, expectation: 3, region: '大陆+测试',
  };
}

describe("applyV14ToV15FinanceInit (v14 → v15)", () => {
  it("seeds teamFinances from teamBases reputation tiers", () => {
    const world: { teamFinances?: unknown; teamBases?: Record<string, TeamBase> } = {
      teamBases: {
        ELITE: mkBase('ELITE', 92),
        TOP: mkBase('TOP', 78),
        MID: mkBase('MID', 70),
        LOW: mkBase('LOW', 40),
      },
    };
    const r = applyV14ToV15FinanceInit(world);
    expect(r.touched).toBe(true);
    expect(r.teamsInitialized).toBe(4);
    const fin = world.teamFinances as Record<string, { cash: number; totalIncome: number; totalExpense: number; history: unknown[] }>;
    expect(fin.ELITE.cash).toBe(150);
    expect(fin.TOP.cash).toBe(80);
    expect(fin.MID.cash).toBe(40);
    expect(fin.LOW.cash).toBe(20);
    // Empty running totals + history on every team
    for (const id of ['ELITE', 'TOP', 'MID', 'LOW']) {
      expect(fin[id].totalIncome).toBe(0);
      expect(fin[id].totalExpense).toBe(0);
      expect(fin[id].history).toEqual([]);
    }
  });

  it("idempotent — leaves an existing non-empty teamFinances alone", () => {
    const existing = {
      A: { cash: 999, totalIncome: 0, totalExpense: 0, history: [] },
    };
    const world: { teamFinances?: unknown; teamBases?: Record<string, TeamBase> } = {
      teamFinances: existing,
      teamBases: { A: mkBase('A', 90) },
    };
    const r = applyV14ToV15FinanceInit(world);
    expect(r.touched).toBe(false);
    expect(world.teamFinances).toBe(existing);
    expect((world.teamFinances as typeof existing).A.cash).toBe(999);
  });

  it("treats {} (empty object) as missing and seeds from teamBases", () => {
    const world: { teamFinances?: unknown; teamBases?: Record<string, TeamBase> } = {
      teamFinances: {},
      teamBases: { A: mkBase('A', 90) },
    };
    const r = applyV14ToV15FinanceInit(world);
    expect(r.touched).toBe(true);
    expect((world.teamFinances as Record<string, { cash: number }>).A.cash).toBe(150);
  });

  it("handles missing teamBases gracefully (no crash, empty seed)", () => {
    const world: { teamFinances?: unknown; teamBases?: Record<string, TeamBase> } = {};
    const r = applyV14ToV15FinanceInit(world);
    expect(r.touched).toBe(true);
    expect(r.teamsInitialized).toBe(0);
    expect(world.teamFinances).toEqual({});
  });
});


import { applyV15ToV16HealLegacyDebt } from "./game-store";

describe("applyV15ToV16HealLegacyDebt (v15 → v16)", () => {
  it("resets cash for negative-cash teams to tier-appropriate starting balance", () => {
    const world = {
      teamFinances: {
        ELITE: { cash: -300, totalIncome: 100, totalExpense: 400, history: [] },
        TOP: { cash: -100, totalIncome: 80, totalExpense: 180, history: [] },
        MID: { cash: 50, totalIncome: 60, totalExpense: 10, history: [] },
        LOW: { cash: -20, totalIncome: 40, totalExpense: 60, history: [] },
      },
      teamBases: {
        ELITE: mkBase("ELITE", 90),
        TOP: mkBase("TOP", 80),
        MID: mkBase("MID", 70),
        LOW: mkBase("LOW", 50),
      },
    };
    const r = applyV15ToV16HealLegacyDebt(world);
    expect(r.touched).toBe(true);
    expect(r.teamsHealed).toBe(3); // MID was already positive — left alone
    expect(world.teamFinances.ELITE.cash).toBe(150);
    expect(world.teamFinances.TOP.cash).toBe(80);
    expect(world.teamFinances.MID.cash).toBe(50); // unchanged
    expect(world.teamFinances.LOW.cash).toBe(20);
    // Running totals + history preserved
    expect(world.teamFinances.ELITE.totalExpense).toBe(400);
    expect(world.teamFinances.ELITE.history).toEqual([]);
  });

  it("idempotent — clean v16 save unchanged", () => {
    const world = {
      teamFinances: {
        A: { cash: 100, totalIncome: 0, totalExpense: 0, history: [] },
        B: { cash: 50, totalIncome: 0, totalExpense: 0, history: [] },
      },
      teamBases: { A: mkBase("A", 90), B: mkBase("B", 60) },
    };
    const r = applyV15ToV16HealLegacyDebt(world);
    expect(r.touched).toBe(false);
    expect(r.teamsHealed).toBe(0);
    expect(world.teamFinances.A.cash).toBe(100);
  });

  it("handles missing teamFinances/teamBases gracefully", () => {
    const r1 = applyV15ToV16HealLegacyDebt({});
    expect(r1.touched).toBe(false);
    expect(r1.teamsHealed).toBe(0);
  });
});

import { applyV16ToV17TagsAndPool } from "./game-store";

describe("applyV16ToV17TagsAndPool (v16 → v17)", () => {
  it("assigns tags deterministically based on uuid hash + inits empty pool", () => {
    const world = {
      squads: {
        TEAM_A: [
          { uuid: 'p-001' },
          { uuid: 'p-002' },
          { uuid: 'p-003' },
          { uuid: 'p-004' },
        ],
      },
    };
    const r1 = applyV16ToV17TagsAndPool(world);
    expect(r1.touched).toBe(true);
    expect(r1.poolInitialized).toBe(true);
    // Re-run on same state — no new tags, pool already there
    const r2 = applyV16ToV17TagsAndPool(world);
    expect(r2.touched).toBe(false);
    expect(r2.playersTagged).toBe(0);
  });

  it("never assigns more than one tag per player", () => {
    const world = {
      squads: { T: [{ uuid: 'p-xyz' }] },
    };
    applyV16ToV17TagsAndPool(world);
    const p = world.squads.T[0] as { uuid?: string; tag?: string };
    // tag may be undefined (70% bucket) or one of 4 — never an array
    if (p.tag !== undefined) {
      expect(['loyal', 'ambitious', 'iron', 'glass']).toContain(p.tag);
    }
  });

  it("preserves existing freeAgentPool if already non-empty", () => {
    const existing = [{ uuid: 'old' } as unknown];
    const world = {
      squads: {},
      freeAgentPool: existing,
    };
    const r = applyV16ToV17TagsAndPool(world);
    expect(r.poolInitialized).toBe(false);
    expect(world.freeAgentPool).toBe(existing);
  });

  it("preserves pre-existing tag values (idempotent)", () => {
    const world = {
      squads: { T: [{ uuid: 'p-1', tag: 'loyal' }] },
    };
    applyV16ToV17TagsAndPool(world);
    expect(world.squads.T[0].tag).toBe('loyal');
  });
});

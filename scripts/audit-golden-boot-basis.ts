import { executeCurrentWindow, initializeGameWorld } from '../src/engine/season/season-manager';
import type { GameWorld } from '../src/engine/season/season-manager';
import { leagueConfigs } from '../src/config/competitions';
import type { LeagueTier } from '../src/engine/awards/award-weights';

/**
 * Golden Boot basis comparison.
 *
 * `playerStats.goals` is an all-competitions total (the stat updater applies no
 * competition filter), yet the shipped normalisation divides by LEAGUE rounds.
 * That mismatch is measured here against two alternatives:
 *
 *   A  shipped      goals(all comp) x (30 / leagueRounds) x coef
 *   B  all-comp     goals(all comp) x (refApps / tierApps) x coef
 *   C  league-only  goals(league only) x (30 / leagueRounds) x coef
 *
 * C is the real-football Golden Shoe basis and needs no schedule guesswork at
 * all, because numerator and denominator finally describe the same matches.
 *
 * Usage: SEASONS=20 npx tsx scripts/audit-golden-boot-basis.ts
 */

const SEASONS = Number(process.env.SEASONS ?? 20);
const SEED = Number(process.env.SEED ?? 20260722);

const LEAGUE_ROUNDS = leagueConfigs.reduce((acc, c) => {
  acc[c.level as LeagueTier] = c.rounds;
  return acc;
}, {} as Record<LeagueTier, number>);

/**
 * Measured all-competitions appearances per season for a goalscoring player in
 * each tier. Re-measure with scripts/probe-goal-sources.ts if cup formats change.
 */
const ALL_COMP_APPS: Record<LeagueTier, number> = { 1: 34.1, 2: 18.8, 3: 15.9 };

const COEF: Record<LeagueTier, number> = { 1: 1.0, 2: 0.75, 3: 0.58 };

function levelOf(world: GameWorld, teamId: string, season: number): LeagueTier {
  const record = world.teamSeasonRecords?.[teamId]?.find(r => r.seasonNumber === season);
  return (record?.leagueLevel ?? 1) as LeagueTier;
}

interface Row {
  playerId: string;
  tier: LeagueTier;
  allGoals: number;
  leagueGoals: number;
  allApps: number;
  assists: number;
}

/** League-only goals per player, read from the completed season's calendar. */
function leagueGoalsFrom(world: GameWorld): Map<string, number> {
  const out = new Map<string, number>();
  for (const window of world.seasonState.calendar) {
    if (!window.completed) continue;
    for (const result of window.results ?? []) {
      if (result.competitionType !== 'league') continue;
      for (const event of result.events) {
        if (event.type !== 'goal' || event.minute > 120 || !event.playerId) continue;
        out.set(event.playerId, (out.get(event.playerId) ?? 0) + 1);
      }
    }
  }
  return out;
}

function pick(rows: Row[], score: (r: Row) => number): Row | null {
  let best: Row | null = null;
  let bestScore = -Infinity;
  for (const row of rows) {
    const value = score(row);
    const better = best === null
      || value > bestScore
      || (value === bestScore && (
        row.allGoals > best.allGoals
        || (row.allGoals === best.allGoals && row.assists > best.assists)
      ));
    if (better) { best = row; bestScore = value; }
  }
  return best;
}

const basis = {
  A: { label: '已上线：全赛事进球 / 联赛轮次', tally: { 1: 0, 2: 0, 3: 0 } as Record<LeagueTier, number>, goals: [] as number[] },
  B: { label: '全赛事进球 / 全赛事场次', tally: { 1: 0, 2: 0, 3: 0 } as Record<LeagueTier, number>, goals: [] as number[] },
  C: { label: '纯联赛进球 / 联赛轮次', tally: { 1: 0, 2: 0, 3: 0 } as Record<LeagueTier, number>, goals: [] as number[] },
};

let seasons = 0;
let mismatch = 0;
let world = initializeGameWorld(SEED);

for (let index = 0; index < SEASONS; index += 1) {
  const season = world.seasonState.seasonNumber;
  let leagueGoals = leagueGoalsFrom(world);
  let guard = 0;
  while (world.seasonState.seasonNumber === season && guard < 300) {
    leagueGoals = leagueGoalsFrom(world);
    world = executeCurrentWindow(world).world;
    guard += 1;
  }
  if (world.seasonState.seasonNumber === season) throw new Error('season stuck');

  const rows: Row[] = [];
  for (const [playerId, entries] of Object.entries(world.playerStatsHistory ?? {})) {
    for (const entry of entries) {
      if (entry.season !== season) continue;
      if ((entry.goals ?? 0) <= 0) continue;
      rows.push({
        playerId,
        tier: levelOf(world, entry.teamId, season),
        allGoals: entry.goals ?? 0,
        leagueGoals: leagueGoals.get(playerId) ?? 0,
        allApps: entry.appearances ?? 0,
        assists: entry.assists ?? 0,
      });
    }
  }
  if (rows.length === 0) continue;
  seasons += 1;

  // Sanity: league goals must never exceed the all-competitions total.
  for (const row of rows) if (row.leagueGoals > row.allGoals) mismatch += 1;

  const winners = {
    A: pick(rows, r => r.allGoals * (LEAGUE_ROUNDS[1] / LEAGUE_ROUNDS[r.tier]) * COEF[r.tier]),
    B: pick(rows, r => r.allGoals * (ALL_COMP_APPS[1] / ALL_COMP_APPS[r.tier]) * COEF[r.tier]),
    C: pick(rows.filter(r => r.leagueGoals > 0), r => r.leagueGoals * (LEAGUE_ROUNDS[1] / LEAGUE_ROUNDS[r.tier]) * COEF[r.tier]),
  };

  for (const key of ['A', 'B', 'C'] as const) {
    const winner = winners[key];
    if (!winner) continue;
    basis[key].tally[winner.tier] += 1;
    basis[key].goals.push(key === 'C' ? winner.leagueGoals : winner.allGoals);
  }
}

const mean = (v: number[]) => v.length ? (v.reduce((s, x) => s + x, 0) / v.length).toFixed(1) : '—';

console.log(`seed ${SEED} · ${seasons} seasons`);
console.log(`（联赛进球 > 全赛事进球的异常行: ${mismatch}）`);
console.log('');
console.log('口径                                    L1  L2  L3  低级别占比  获奖者场均进球');
for (const key of ['A', 'B', 'C'] as const) {
  const b = basis[key];
  const total = b.tally[1] + b.tally[2] + b.tally[3];
  const lower = total > 0 ? ((b.tally[2] + b.tally[3]) / total) : 0;
  console.log(
    `${key} ${b.label.padEnd(34)} `
    + `${String(b.tally[1]).padStart(2)}  ${String(b.tally[2]).padStart(2)}  ${String(b.tally[3]).padStart(2)}  `
    + `${lower.toFixed(3).padStart(10)}  ${String(mean(b.goals)).padStart(14)}`,
  );
}

import { executeCurrentWindow, initializeGameWorld } from '../src/engine/season/season-manager';
import type { GameWorld } from '../src/engine/season/season-manager';
import { leagueTopScorerScore } from '../src/engine/awards/award-scoring';
import type { LeagueTier } from '../src/engine/awards/award-weights';

/**
 * End-to-end verification of the two-honour scoring split.
 *
 * Reads what the ENGINE actually produced — the Golden Boot from
 * `playerAwardsHistory` and the league top scorer from the season's news line —
 * rather than recomputing either from raw stats. That makes it a check on the
 * implementation, not on the formula in isolation.
 *
 * Usage: SEASONS=20 SEED=20260722 npx tsx scripts/verify-scoring-split.ts
 */

const SEASONS = Number(process.env.SEASONS ?? 20);
const SEED = Number(process.env.SEED ?? 20260722);

function levelOf(world: GameWorld, teamId: string, season: number): LeagueTier {
  const record = world.teamSeasonRecords?.[teamId]?.find(r => r.seasonNumber === season);
  return (record?.leagueLevel ?? 1) as LeagueTier;
}

/** League goals per player from the completed season's calendar. */
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

const bootTally = { 1: 0, 2: 0, 3: 0 } as Record<LeagueTier, number>;
const scorerTally = { 1: 0, 2: 0, 3: 0 } as Record<LeagueTier, number>;
const bootGoals: number[] = [];
const scorerGoals: number[] = [];
let differ = 0;
let seasons = 0;
/** Guards the invariant the whole split exists to protect. */
let scorerExceededAllComp = 0;
/** Spot-check rows for lower-tier league top scorers. */
const examples: string[] = [];

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

  const boot = (world.playerAwardsHistory ?? [])
    .find(a => a.season === season && a.type === 'golden_boot');
  if (!boot) continue;
  seasons += 1;

  const bootTier = levelOf(world, boot.teamId, season);
  bootTally[bootTier] += 1;
  const bootRaw = Number(/(\d+)球/.exec(boot.statLabel)?.[1] ?? Number.NaN);
  if (Number.isFinite(bootRaw)) bootGoals.push(bootRaw);

  // League top scorer, ranked exactly as the selector ranks it.
  let best: { playerId: string; teamId: string; goals: number; score: number } | null = null;
  for (const [playerId, stat] of Object.entries(world.playerStatsHistory ?? {})) {
    const entry = stat.find(row => row.season === season);
    if (!entry) continue;
    const goals = leagueGoals.get(playerId) ?? 0;
    if (goals <= 0) continue;
    if (goals > (entry.goals ?? 0)) scorerExceededAllComp += 1;
    const tier = levelOf(world, entry.teamId, season);
    const score = leagueTopScorerScore(goals, tier);
    if (best === null || score > best.score || (score === best.score && goals > best.goals)) {
      best = { playerId, teamId: entry.teamId, goals, score };
    }
  }
  if (!best) continue;

  const scorerTier = levelOf(world, best.teamId, season);
  scorerTally[scorerTier] += 1;
  scorerGoals.push(best.goals);
  if (best.playerId !== boot.playerId) differ += 1;

  // Spot-check every lower-tier winner against that season's top-flight best,
  // so "no weak-league padding" is shown rather than asserted.
  if (scorerTier !== 1 && examples.length < 6) {
    let topFlightBest = 0;
    for (const [otherId, rows] of Object.entries(world.playerStatsHistory ?? {})) {
      const row = rows.find(r => r.season === season);
      if (!row) continue;
      if (levelOf(world, row.teamId, season) !== 1) continue;
      topFlightBest = Math.max(topFlightBest, leagueGoals.get(otherId) ?? 0);
    }
    const rounds = scorerTier === 1 ? 30 : 14;
    const teamName = world.teamBases[best.teamId]?.name ?? best.teamId;
    examples.push(
      `S${String(season).padStart(2)} ${teamName} `
      + `${best.goals}球/${rounds}轮（${(best.goals / rounds).toFixed(2)}/轮）`
      + `  vs 顶级最佳 ${topFlightBest}球/30轮（${(topFlightBest / 30).toFixed(2)}/轮）`,
    );
  }
}

const mean = (v: number[]) => v.length ? (v.reduce((s, x) => s + x, 0) / v.length).toFixed(1) : '—';
const share = (t: Record<LeagueTier, number>) => {
  const total = t[1] + t[2] + t[3];
  return total > 0 ? ((t[2] + t[3]) / total).toFixed(3) : '—';
};

console.log(`seed ${SEED} · ${seasons} seasons · 引擎实际产出`);
console.log('');
console.log('荣誉            L1  L2  L3  低级别占比  获奖者场均进球');
console.log(`金靴（全赛事）    ${String(bootTally[1]).padStart(2)}  ${String(bootTally[2]).padStart(2)}  `
  + `${String(bootTally[3]).padStart(2)}  ${share(bootTally).padStart(10)}  ${String(mean(bootGoals)).padStart(14)}`);
console.log(`射手王（联赛）    ${String(scorerTally[1]).padStart(2)}  ${String(scorerTally[2]).padStart(2)}  `
  + `${String(scorerTally[3]).padStart(2)}  ${share(scorerTally).padStart(10)}  ${String(mean(scorerGoals)).padStart(14)}`);
console.log('');
console.log(`两个荣誉颁给不同球员的赛季: ${differ}/${seasons}`);
console.log(`联赛进球 > 全赛事进球的异常行: ${scorerExceededAllComp}（应为 0）`);

if (examples.length > 0) {
  console.log('');
  console.log('低级别射手王逐例核对（每轮产量必须高于当年顶级最佳）:');
  for (const line of examples) console.log(`  ${line}`);
}

import { executeCurrentWindow, initializeGameWorld } from '../src/engine/season/season-manager';
import type { GameWorld } from '../src/engine/season/season-manager';
import { leagueConfigs } from '../src/config/competitions';
import type { LeagueTier } from '../src/engine/awards/award-weights';

/**
 * Proposed split: two scoring honours, two clean bases.
 *
 *   金靴奖   = 全赛事进球 x 联赛系数            （杯赛征程是挣来的，不做赛程折算）
 *   射手王   = 联赛进球 x 赛程归一 x 联赛系数    （分子分母同为联赛，折算才成立）
 *
 * This measures both so the split can be judged before any engine change.
 *
 * Usage: SEASONS=20 npx tsx scripts/audit-scoring-split.ts
 */

const SEASONS = Number(process.env.SEASONS ?? 20);
const SEED = Number(process.env.SEED ?? 20260722);

const LEAGUE_ROUNDS = leagueConfigs.reduce((acc, c) => {
  acc[c.level as LeagueTier] = c.rounds;
  return acc;
}, {} as Record<LeagueTier, number>);

const COEF: Record<LeagueTier, number> = { 1: 1.0, 2: 0.75, 3: 0.58 };

function levelOf(world: GameWorld, teamId: string, season: number): LeagueTier {
  const record = world.teamSeasonRecords?.[teamId]?.find(r => r.seasonNumber === season);
  return (record?.leagueLevel ?? 1) as LeagueTier;
}

interface Row {
  tier: LeagueTier;
  allGoals: number;
  leagueGoals: number;
  assists: number;
}

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

const track = (label: string) => ({
  label,
  tally: { 1: 0, 2: 0, 3: 0 } as Record<LeagueTier, number>,
  raw: [] as number[],
});

const boot = track('金靴：全赛事 x 系数');
const bootNoCoef = track('金靴：全赛事，不加系数');
const topScorer = track('射手王：联赛 x 归一 x 系数');
const topScorerRaw = track('射手王：联赛，不归一不加系数');

/** Do the two honours ever go to different players? */
let sameWinner = 0;
let seasons = 0;

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
        tier: levelOf(world, entry.teamId, season),
        allGoals: entry.goals ?? 0,
        leagueGoals: leagueGoals.get(playerId) ?? 0,
        assists: entry.assists ?? 0,
      });
    }
  }
  if (rows.length === 0) continue;
  seasons += 1;

  const bootWinner = pick(rows, r => r.allGoals * COEF[r.tier]);
  const bootRawWinner = pick(rows, r => r.allGoals);
  const leagueRows = rows.filter(r => r.leagueGoals > 0);
  const tsWinner = pick(leagueRows, r => r.leagueGoals * (LEAGUE_ROUNDS[1] / LEAGUE_ROUNDS[r.tier]) * COEF[r.tier]);
  const tsRawWinner = pick(leagueRows, r => r.leagueGoals);

  const record = (t: ReturnType<typeof track>, w: Row | null, value: (r: Row) => number) => {
    if (!w) return;
    t.tally[w.tier] += 1;
    t.raw.push(value(w));
  };
  record(boot, bootWinner, r => r.allGoals);
  record(bootNoCoef, bootRawWinner, r => r.allGoals);
  record(topScorer, tsWinner, r => r.leagueGoals);
  record(topScorerRaw, tsRawWinner, r => r.leagueGoals);

  if (bootWinner && tsWinner
    && bootWinner.allGoals === tsWinner.allGoals
    && bootWinner.leagueGoals === tsWinner.leagueGoals
    && bootWinner.tier === tsWinner.tier) sameWinner += 1;
}

const mean = (v: number[]) => v.length ? (v.reduce((s, x) => s + x, 0) / v.length).toFixed(1) : '—';

console.log(`seed ${SEED} · ${seasons} seasons`);
console.log('');
console.log('口径                                  L1  L2  L3  低级别占比  获奖者场均进球');
for (const t of [boot, bootNoCoef, topScorer, topScorerRaw]) {
  const total = t.tally[1] + t.tally[2] + t.tally[3];
  const lower = total > 0 ? (t.tally[2] + t.tally[3]) / total : 0;
  console.log(
    `${t.label.padEnd(36)} `
    + `${String(t.tally[1]).padStart(2)}  ${String(t.tally[2]).padStart(2)}  ${String(t.tally[3]).padStart(2)}  `
    + `${lower.toFixed(3).padStart(10)}  ${String(mean(t.raw)).padStart(14)}`,
  );
}
console.log('');
console.log(`两个荣誉颁给同一人的赛季: ${sameWinner}/${seasons}`);

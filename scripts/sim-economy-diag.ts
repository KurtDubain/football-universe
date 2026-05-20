/**
 * Phase H — Economy DIAGNOSTIC simulation.
 *
 * Re-runs the 20-season sim against the s16 save BUT tracks per-team
 * trajectories with full income/expense breakdown. Goal: find why big
 * teams bleed cash in the user's playthrough despite the tuner saying
 * 33% is fine.
 *
 * Output:
 *   - Per-tier mean trajectory (sanity vs original tuner)
 *   - Top 10 teams by cash AT END (S20)
 *   - Bottom 10 teams by cash AT END
 *   - Per-team breakdown of TV/prize/cup/salary across 20 seasons
 *   - Hypothesis tests:
 *     a) Are big teams bleeding because salaries scale too fast as squad
 *        value inflates over seasons?
 *     b) Are big teams bleeding because they finish 9-10 in L1 (no prize)?
 *     c) Are big teams that get RELEGATED bleeding the worst?
 */
// @ts-expect-error — node types intentionally not added
import { readFileSync, writeFileSync } from 'fs';
import {
  applyV9ToV10PlayerCurve, applyV10ToV11RetirementInit,
  applyV11ToV12CoachAge, applyV12ToV13ContinentalCupsInit,
  applyV13ToV14InjuriesInit, applyV14ToV15FinanceInit,
  backfillStaleHistoryPlayerIds,
} from '../src/store/game-store';
import { executeCurrentWindow, getCurrentWindow } from '../src/engine/season/season-manager';
import { setSalaryRateForTesting, SALARY_RATE, leaguePrize, TV_SPONSOR_BY_TIER } from '../src/engine/economy/finance';
import type { GameWorld } from '../src/engine/season/season-manager';
import type { TeamBase } from '../src/types/team';

const SAVE_PATH = '/Users/mutu/Downloads/football-universe-s16.json';
const TARGET_SEASONS = 20;
const SEEDS = [7, 13, 21];

interface PerTeamSnap {
  teamId: string;
  teamName: string;
  reputation: number;
  startReputation: number;
  cash: number;
  squadValue: number;
  league: 1 | 2 | 3;
  rank: number;
  // Per-season breakdown derived from finance history
  prizeYTD: number;
  tvYTD: number;
  salaryYTD: number;
  transferIncomeYTD: number;
  transferExpenseYTD: number;
}

interface SeasonReport {
  season: number;
  perTeam: Record<string, PerTeamSnap>;
}

function buildBaseline(): GameWorld {
  const raw = JSON.parse(readFileSync(SAVE_PATH, 'utf8'));
  const world = raw.state.world as GameWorld;
  backfillStaleHistoryPlayerIds(world as unknown as Parameters<typeof backfillStaleHistoryPlayerIds>[0]);
  applyV9ToV10PlayerCurve(world as unknown as Parameters<typeof applyV9ToV10PlayerCurve>[0]);
  applyV10ToV11RetirementInit(world);
  applyV11ToV12CoachAge(world as unknown as Parameters<typeof applyV11ToV12CoachAge>[0]);
  applyV12ToV13ContinentalCupsInit(world as unknown as Parameters<typeof applyV12ToV13ContinentalCupsInit>[0]);
  applyV13ToV14InjuriesInit(world as unknown as Parameters<typeof applyV13ToV14InjuriesInit>[0]);
  applyV14ToV15FinanceInit(world as unknown as Parameters<typeof applyV14ToV15FinanceInit>[0]);
  return world;
}

function deepClone(w: GameWorld): GameWorld { return structuredClone(w); }

function snap(world: GameWorld, startReps: Record<string, number>): Record<string, PerTeamSnap> {
  const out: Record<string, PerTeamSnap> = {};
  // build standings lookup
  const standings: Record<string, { lv: 1|2|3; rank: number }> = {};
  for (const lv of [1, 2, 3] as const) {
    const arr = lv === 1 ? world.league1Standings : lv === 2 ? world.league2Standings : world.league3Standings;
    arr.forEach((s, i) => { standings[s.teamId] = { lv, rank: i + 1 }; });
  }
  for (const [tid, base] of Object.entries(world.teamBases)) {
    const fin = world.teamFinances[tid];
    if (!fin) continue;
    const squad = world.squads[tid] ?? [];
    const squadValue = squad.reduce((s, p) => s + ((p as { marketValue?: number }).marketValue ?? 0), 0);
    const std = standings[tid];
    // Aggregate from history (last entries since baseline; we accumulate on top)
    let prizeYTD = 0, tvYTD = 0, salaryYTD = 0, trIn = 0, trOut = 0;
    for (const h of fin.history) {
      prizeYTD += h.prizeMoney;
      tvYTD += h.tvSponsor;
      salaryYTD += h.salaries;
      trIn += h.transferIncome;
      trOut += h.transferExpense;
    }
    out[tid] = {
      teamId: tid,
      teamName: (base as TeamBase).name,
      reputation: (base as TeamBase).reputation,
      startReputation: startReps[tid] ?? (base as TeamBase).reputation,
      cash: fin.cash,
      squadValue: Math.round(squadValue),
      league: std?.lv ?? 3,
      rank: std?.rank ?? 99,
      prizeYTD: Math.round(prizeYTD),
      tvYTD: Math.round(tvYTD),
      salaryYTD: Math.round(salaryYTD),
      transferIncomeYTD: Math.round(trIn),
      transferExpenseYTD: Math.round(trOut),
    };
  }
  return out;
}

function runOnce(rate: number, seed: number): SeasonReport[] {
  setSalaryRateForTesting(rate);
  let world = deepClone(BASELINE);
  world = { ...world, rngState: (world.rngState ^ (seed * 1664525 + 1013904223)) >>> 0 };

  const startReps: Record<string, number> = {};
  for (const [tid, base] of Object.entries(world.teamBases)) {
    startReps[tid] = (base as TeamBase).reputation;
  }

  const reports: SeasonReport[] = [];
  let prevSeasonNumber = world.seasonState.seasonNumber;
  let safety = 0;
  while (safety < 5000 && reports.length < TARGET_SEASONS) {
    const cw = getCurrentWindow(world);
    if (!cw) break;
    const r = executeCurrentWindow(world);
    world = r.world;
    if (world.seasonState.seasonNumber !== prevSeasonNumber) {
      reports.push({ season: prevSeasonNumber, perTeam: snap(world, startReps) });
      prevSeasonNumber = world.seasonState.seasonNumber;
    }
    safety++;
  }
  return reports;
}

const BASELINE = buildBaseline();
const startReps: Record<string, number> = {};
for (const [tid, base] of Object.entries(BASELINE.teamBases)) {
  startReps[tid] = (base as TeamBase).reputation;
}

console.log('=== Economy diagnostic — current SALARY_RATE = ' + (SALARY_RATE * 100).toFixed(1) + '% ===');
console.log(`Baseline season: ${BASELINE.seasonState.seasonNumber}`);
console.log();

// Run 3 seeds; aggregate by-team results across seeds
const allRuns: SeasonReport[][] = [];
for (const seed of SEEDS) {
  const t0 = Date.now();
  const run = runOnce(SALARY_RATE, seed);
  console.log(`seed=${seed}: ${run.length} seasons, ${Date.now() - t0}ms`);
  allRuns.push(run);
}

// Take seed 0's final season for per-team analysis
const finalSeason = allRuns[0].at(-1);
if (!finalSeason) { console.error('No final season'); process.exit(1); }

const perTeamArr = Object.values(finalSeason.perTeam);
const sortedByCash = perTeamArr.slice().sort((a, b) => b.cash - a.cash);

console.log('\n=== Top 10 wealthiest @ S' + finalSeason.season + ' (seed=' + SEEDS[0] + ') ===');
console.log('Team                 | StartRep→Now | League | Rank | Cash       | SquadVal   | Prize10y | TV10y | Salary10y | NetPrize-Salary');
console.log('---------------------+--------------+--------+------+------------+------------+----------+-------+-----------+----------------');
for (const t of sortedByCash.slice(0, 10)) {
  console.log(
    `${t.teamName.padEnd(20)} | ${String(t.startReputation).padEnd(3)} → ${String(t.reputation).padEnd(3)}      | L${t.league}     | #${String(t.rank).padEnd(2)} | €${String(Math.round(t.cash)).padStart(5)}M     | €${String(t.squadValue).padStart(5)}M     | €${String(t.prizeYTD).padStart(4)}M     | €${String(t.tvYTD).padStart(4)}M | €${String(t.salaryYTD).padStart(5)}M    | €${String(t.prizeYTD + t.tvYTD - t.salaryYTD).padStart(5)}M`
  );
}

console.log('\n=== Bottom 10 poorest @ S' + finalSeason.season + ' ===');
console.log('Team                 | StartRep→Now | League | Rank | Cash       | SquadVal   | Prize10y | TV10y | Salary10y | NetPrize-Salary');
console.log('---------------------+--------------+--------+------+------------+------------+----------+-------+-----------+----------------');
for (const t of sortedByCash.slice(-10)) {
  console.log(
    `${t.teamName.padEnd(20)} | ${String(t.startReputation).padEnd(3)} → ${String(t.reputation).padEnd(3)}      | L${t.league}     | #${String(t.rank).padEnd(2)} | €${String(Math.round(t.cash)).padStart(5)}M     | €${String(t.squadValue).padStart(5)}M     | €${String(t.prizeYTD).padStart(4)}M     | €${String(t.tvYTD).padStart(4)}M | €${String(t.salaryYTD).padStart(5)}M    | €${String(t.prizeYTD + t.tvYTD - t.salaryYTD).padStart(5)}M`
  );
}

// === Hypothesis A: salaries scale faster than income ===
// For each team, plot squadValue at S0 vs S20
console.log('\n=== Hypothesis A: squad value inflation ===');
const baselineSquad: Record<string, number> = {};
for (const tid of Object.keys(BASELINE.teamBases)) {
  const sq = BASELINE.squads[tid] ?? [];
  baselineSquad[tid] = sq.reduce((s, p) => s + ((p as { marketValue?: number }).marketValue ?? 0), 0);
}
const inflation: { teamId: string; name: string; rep: number; s0: number; s20: number; ratio: number }[] = [];
for (const t of perTeamArr) {
  const s0 = baselineSquad[t.teamId] ?? 0;
  inflation.push({
    teamId: t.teamId,
    name: t.teamName,
    rep: t.startReputation,
    s0: Math.round(s0),
    s20: t.squadValue,
    ratio: s0 > 0 ? t.squadValue / s0 : 0,
  });
}
inflation.sort((a, b) => b.ratio - a.ratio);
console.log('Top 5 squad-value inflation:');
for (const i of inflation.slice(0, 5)) {
  console.log(`  ${i.name.padEnd(20)} rep=${i.rep}  €${i.s0}M → €${i.s20}M  (×${i.ratio.toFixed(2)})`);
}
console.log('Bottom 5 squad-value inflation:');
for (const i of inflation.slice(-5)) {
  console.log(`  ${i.name.padEnd(20)} rep=${i.rep}  €${i.s0}M → €${i.s20}M  (×${i.ratio.toFixed(2)})`);
}
const meanInflation = inflation.reduce((s, i) => s + i.ratio, 0) / inflation.length;
console.log(`Mean squad-value ratio: ${meanInflation.toFixed(2)}x`);

// === Hypothesis B: relegated big teams ===
// Find teams whose startReputation >= 75 but ended in L2/L3
console.log('\n=== Hypothesis B: relegated big teams ===');
const fallen = perTeamArr.filter(t => t.startReputation >= 75 && t.league > 1);
console.log(`${fallen.length} originally top/elite teams (rep >= 75) ended below L1 by S${finalSeason.season}:`);
for (const f of fallen) {
  console.log(`  ${f.name.padEnd(20)} rep=${f.startReputation} → L${f.league} #${f.rank}, cash €${Math.round(f.cash)}M, squad €${f.squadValue}M`);
}

// === Hypothesis C: salary vs income ratio ===
console.log('\n=== Hypothesis C: salary vs (TV+prize) ratio over 10 most recent years ===');
const ratios = perTeamArr.map(t => ({
  name: t.teamName,
  rep: t.startReputation,
  league: t.league,
  rank: t.rank,
  income10y: t.prizeYTD + t.tvYTD,
  salary10y: t.salaryYTD,
  ratio: (t.prizeYTD + t.tvYTD) > 0 ? t.salaryYTD / (t.prizeYTD + t.tvYTD) : 999,
  cash: t.cash,
})).sort((a, b) => b.ratio - a.ratio);
console.log('Top 10 worst salary-to-income ratio:');
for (const r of ratios.slice(0, 10)) {
  console.log(`  ${r.name.padEnd(20)} rep=${r.rep} L${r.league} #${r.rank} | income=€${r.income10y}M, salary=€${r.salary10y}M, ratio=${r.ratio.toFixed(2)}x | cash=€${Math.round(r.cash)}M`);
}

// === Per-tier final breakdown ===
console.log('\n=== Per-tier final state @ S' + finalSeason.season + ' ===');
const tierStats: Record<string, { count: number; cashSum: number; cashMin: number; cashMax: number; negCount: number }> = {
  'elite (rep>=85)': { count: 0, cashSum: 0, cashMin: Infinity, cashMax: -Infinity, negCount: 0 },
  'top (75-84)':     { count: 0, cashSum: 0, cashMin: Infinity, cashMax: -Infinity, negCount: 0 },
  'mid (65-74)':     { count: 0, cashSum: 0, cashMin: Infinity, cashMax: -Infinity, negCount: 0 },
  'low (<65)':       { count: 0, cashSum: 0, cashMin: Infinity, cashMax: -Infinity, negCount: 0 },
};
for (const t of perTeamArr) {
  const k = t.startReputation >= 85 ? 'elite (rep>=85)' :
            t.startReputation >= 75 ? 'top (75-84)' :
            t.startReputation >= 65 ? 'mid (65-74)' :
            'low (<65)';
  const s = tierStats[k];
  s.count++;
  s.cashSum += t.cash;
  s.cashMin = Math.min(s.cashMin, t.cash);
  s.cashMax = Math.max(s.cashMax, t.cash);
  if (t.cash < 0) s.negCount++;
}
for (const [k, s] of Object.entries(tierStats)) {
  if (s.count === 0) continue;
  console.log(`  ${k.padEnd(20)} count=${s.count}, mean=€${(s.cashSum / s.count).toFixed(0)}M, min=€${s.cashMin.toFixed(0)}M, max=€${s.cashMax.toFixed(0)}M, negative=${s.negCount}`);
}

// Save full data for later inspection
writeFileSync('/tmp/economy-diag.json', JSON.stringify({
  finalSeason: finalSeason.season,
  perTeamArr,
  inflation,
  ratios,
  tierStats,
}, null, 2));
console.log('\nFull data: /tmp/economy-diag.json');

setSalaryRateForTesting(SALARY_RATE);

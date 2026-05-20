/**
 * Phase H v2 — Progressive salary bracket tuning.
 *
 * Tests multiple bracket schedules against the s16 save over 20 seasons.
 * For each candidate schedule, captures per-tier mean cash and top/bottom
 * 5 individual outliers. Picks the schedule with:
 *   - No tier ends in deep deficit (mean cash ≥ -€50M)
 *   - Top elite teams (rep ≥ 90) end with cash ≥ -€100M (no €500M deficits)
 *   - Mid/low teams accumulate moderately (€100-€400M, not €500M+)
 *   - Fire-sale frequency moderate (0.3-1.5 per season)
 */
// @ts-expect-error — node types intentionally not added
import { readFileSync } from 'fs';
import {
  applyV9ToV10PlayerCurve, applyV10ToV11RetirementInit,
  applyV11ToV12CoachAge, applyV12ToV13ContinentalCupsInit,
  applyV13ToV14InjuriesInit, applyV14ToV15FinanceInit,
  backfillStaleHistoryPlayerIds,
} from '../src/store/game-store';
import { executeCurrentWindow, getCurrentWindow } from '../src/engine/season/season-manager';
import {
  setSalaryBracketsForTesting, resetSalaryBrackets, computeSalary,
  type SalaryBracket,
} from '../src/engine/economy/finance';
import type { GameWorld } from '../src/engine/season/season-manager';
import type { TeamBase } from '../src/types/team';

const SAVE_PATH = '/Users/mutu/Downloads/football-universe-s16.json';
const TARGET_SEASONS = 20;
const SEEDS = [7, 13, 21];

interface Candidate {
  name: string;
  brackets: SalaryBracket[];
}

const CANDIDATES: Candidate[] = [
  {
    name: 'A: 33/28/20/12 @ 50/150/300',
    brackets: [
      { boundary: 50, rate: 0.33 },
      { boundary: 150, rate: 0.28 },
      { boundary: 300, rate: 0.20 },
      { boundary: Infinity, rate: 0.12 },
    ],
  },
  {
    name: 'B: 33/22/15 @ 50/200',
    brackets: [
      { boundary: 50, rate: 0.33 },
      { boundary: 200, rate: 0.22 },
      { boundary: Infinity, rate: 0.15 },
    ],
  },
  {
    name: 'C: 35/20/12 @ 100/300',
    brackets: [
      { boundary: 100, rate: 0.35 },
      { boundary: 300, rate: 0.20 },
      { boundary: Infinity, rate: 0.12 },
    ],
  },
  {
    name: 'D: 33/18 @ 100',
    brackets: [
      { boundary: 100, rate: 0.33 },
      { boundary: Infinity, rate: 0.18 },
    ],
  },
  {
    name: 'E: 33/30/22/14 @ 50/150/300',
    brackets: [
      { boundary: 50, rate: 0.33 },
      { boundary: 150, rate: 0.30 },
      { boundary: 300, rate: 0.22 },
      { boundary: Infinity, rate: 0.14 },
    ],
  },
  {
    name: 'F: 30/25/18/10 @ 50/150/300',
    brackets: [
      { boundary: 50, rate: 0.30 },
      { boundary: 150, rate: 0.25 },
      { boundary: 300, rate: 0.18 },
      { boundary: Infinity, rate: 0.10 },
    ],
  },
];

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

function runSim(seed: number): GameWorld {
  let world = deepClone(BASELINE);
  world = { ...world, rngState: (world.rngState ^ (seed * 1664525 + 1013904223)) >>> 0 };
  let prevSeasonNumber = world.seasonState.seasonNumber;
  let safety = 0;
  let seasonsAdvanced = 0;
  while (safety < 5000 && seasonsAdvanced < TARGET_SEASONS) {
    const cw = getCurrentWindow(world);
    if (!cw) break;
    const r = executeCurrentWindow(world);
    world = r.world;
    if (world.seasonState.seasonNumber !== prevSeasonNumber) {
      seasonsAdvanced++;
      prevSeasonNumber = world.seasonState.seasonNumber;
    }
    safety++;
  }
  return world;
}

interface Verdict {
  name: string;
  summary: { tier: string; count: number; mean: number; min: number; max: number; negCount: number; topRepNeg: number }[];
  fireSaleTotal: number;
  highRepBleeders: { name: string; rep: number; cash: number }[];
  lowRepHoarders: { name: string; rep: number; cash: number }[];
  finalSquadValueMean: { tier: string; mean: number }[];
}

function evaluate(c: Candidate): Verdict {
  setSalaryBracketsForTesting(c.brackets);
  const finalWorlds: GameWorld[] = [];
  for (const seed of SEEDS) {
    finalWorlds.push(runSim(seed));
  }

  type TeamAgg = {
    name: string; rep: number; cashSum: number;
    cashSamples: number[]; squadValueSum: number; samples: number;
  };
  const teams: Record<string, TeamAgg> = {};
  let fireSaleTotal = 0;
  for (const w of finalWorlds) {
    fireSaleTotal += w.newsLog.filter(n => n.type === 'fire_sale').length;
    for (const [tid, base] of Object.entries(w.teamBases)) {
      const fin = w.teamFinances[tid];
      if (!fin) continue;
      const sq = w.squads[tid] ?? [];
      const sv = sq.reduce((s, p) => s + ((p as { marketValue?: number }).marketValue ?? 0), 0);
      if (!teams[tid]) {
        teams[tid] = {
          name: (base as TeamBase).name,
          rep: (base as TeamBase).reputation,
          cashSum: 0, cashSamples: [], squadValueSum: 0, samples: 0,
        };
      }
      teams[tid].cashSum += fin.cash;
      teams[tid].cashSamples.push(fin.cash);
      teams[tid].squadValueSum += sv;
      teams[tid].samples++;
    }
  }
  // Average across seeds
  const avgTeams: { id: string; name: string; rep: number; cash: number; squadValue: number }[] = [];
  for (const [id, t] of Object.entries(teams)) {
    avgTeams.push({
      id,
      name: t.name,
      rep: t.rep,
      cash: t.cashSum / t.samples,
      squadValue: t.squadValueSum / t.samples,
    });
  }

  // Tier summaries
  const tiers = [
    { name: 'elite (rep≥85)', test: (r: number) => r >= 85 },
    { name: 'top (75-84)',    test: (r: number) => r >= 75 && r < 85 },
    { name: 'mid (65-74)',    test: (r: number) => r >= 65 && r < 75 },
    { name: 'low (<65)',      test: (r: number) => r < 65 },
  ];
  const summary = tiers.map(t => {
    const subset = avgTeams.filter(a => t.test(a.rep));
    if (subset.length === 0) {
      return { tier: t.name, count: 0, mean: 0, min: 0, max: 0, negCount: 0, topRepNeg: 0 };
    }
    const mean = subset.reduce((s, a) => s + a.cash, 0) / subset.length;
    const min = Math.min(...subset.map(a => a.cash));
    const max = Math.max(...subset.map(a => a.cash));
    const negCount = subset.filter(a => a.cash < 0).length;
    const topRepNeg = subset.filter(a => a.cash < 0 && a.rep >= 90).length;
    return { tier: t.name, count: subset.length, mean, min, max, negCount, topRepNeg };
  });

  const finalSquadValueMean = tiers.map(t => {
    const subset = avgTeams.filter(a => t.test(a.rep));
    const mean = subset.length > 0 ? subset.reduce((s, a) => s + a.squadValue, 0) / subset.length : 0;
    return { tier: t.name, mean };
  });

  const sorted = avgTeams.slice().sort((a, b) => a.cash - b.cash);
  const highRepBleeders = sorted.filter(a => a.rep >= 85).slice(0, 5).map(a => ({ name: a.name, rep: a.rep, cash: a.cash }));
  const lowRepHoarders = sorted.slice().reverse().filter(a => a.rep < 65).slice(0, 5).map(a => ({ name: a.name, rep: a.rep, cash: a.cash }));

  return { name: c.name, summary, fireSaleTotal, highRepBleeders, lowRepHoarders, finalSquadValueMean };
}

const BASELINE = buildBaseline();

console.log('=== Sanity: salary table sample ===');
for (const sv of [10, 30, 50, 100, 150, 200, 300, 400, 500, 750]) {
  const lines: string[] = [];
  for (const c of CANDIDATES) {
    setSalaryBracketsForTesting(c.brackets);
    lines.push(`${c.name.split(':')[0]}=€${computeSalary(sv)}M`);
  }
  console.log(`  squadValue=€${sv}M  →  ${lines.join('  ')}`);
}
resetSalaryBrackets();

console.log('\n=== Multi-candidate sim (3 seeds × 20 seasons each) ===');
const verdicts: Verdict[] = [];
for (const c of CANDIDATES) {
  const t0 = Date.now();
  const v = evaluate(c);
  console.log(`\n--- ${v.name}  (${Date.now() - t0}ms, fireSales total: ${v.fireSaleTotal}) ---`);
  console.log('Tier summaries (3-seed mean cash @ S' + (BASELINE.seasonState.seasonNumber + TARGET_SEASONS) + '):');
  for (const s of v.summary) {
    const sv = v.finalSquadValueMean.find(x => x.tier === s.tier)?.mean ?? 0;
    console.log(`  ${s.tier.padEnd(15)} n=${s.count} mean=€${s.mean.toFixed(0).padStart(5)}M, range=[${s.min.toFixed(0)}, ${s.max.toFixed(0)}], neg=${s.negCount}, neg(rep>=90)=${s.topRepNeg}, squadVal=€${sv.toFixed(0)}M`);
  }
  console.log('Worst 5 high-rep bleeders:');
  for (const b of v.highRepBleeders) console.log(`  ${b.name.padEnd(20)} rep=${b.rep} cash=€${b.cash.toFixed(0)}M`);
  console.log('Top 5 low-rep hoarders:');
  for (const h of v.lowRepHoarders) console.log(`  ${h.name.padEnd(20)} rep=${h.rep} cash=€${h.cash.toFixed(0)}M`);
  verdicts.push(v);
}

resetSalaryBrackets();

// Score: penalize tier mean cash going below -€50M, top-rep negative count,
// extreme low-rep hoarding (>€500M).
function score(v: Verdict): number {
  let p = 0;
  for (const s of v.summary) {
    if (s.mean < -50) p += Math.abs(s.mean + 50);
    if (s.mean > 800) p += (s.mean - 800);  // extreme hoarding
    p += s.topRepNeg * 50;                    // top-rep going negative is bad
  }
  // Want fire sales 0.3-1.5/season → 18-90 over 60 season-runs (3 seeds × 20)
  const expectedFireRange = [18, 90];
  if (v.fireSaleTotal < expectedFireRange[0]) p += (expectedFireRange[0] - v.fireSaleTotal) * 2;
  if (v.fireSaleTotal > expectedFireRange[1]) p += (v.fireSaleTotal - expectedFireRange[1]) * 2;
  return p;
}

console.log('\n=== Verdict ===');
const ranked = verdicts.slice().sort((a, b) => score(a) - score(b));
for (const v of ranked) {
  const elite = v.summary.find(s => s.tier === 'elite (rep≥85)');
  const top = v.summary.find(s => s.tier === 'top (75-84)');
  const mid = v.summary.find(s => s.tier === 'mid (65-74)');
  const low = v.summary.find(s => s.tier === 'low (<65)');
  console.log(
    `${v.name}: ` +
    `elite=€${elite?.mean.toFixed(0)}M (neg-rep90=${elite?.topRepNeg}), ` +
    `top=€${top?.mean.toFixed(0)}M, mid=€${mid?.mean.toFixed(0)}M, low=€${low?.mean.toFixed(0)}M, ` +
    `fires=${v.fireSaleTotal} | score=${score(v).toFixed(0)}`
  );
}

console.log(`\nWinner: ${ranked[0].name}`);

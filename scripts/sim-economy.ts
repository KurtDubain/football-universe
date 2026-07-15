/**
 * Phase H — Economy multi-season simulation harness.
 *
 * Runs an N-season simulation against the s16 real save (read-only) for each
 * candidate salary rate (3% / 5% / 7%) and prints the metrics that drove the
 * choice of `SALARY_RATE` in `src/engine/economy/finance.ts`.
 *
 * Usage:
 *   PATH=/Users/mutu/.nvm/versions/node/v22.22.2/bin:$PATH \
 *     node_modules/.bin/tsx scripts/sim-economy.ts
 *
 * Per spec: "所有的数值，我希望你多跑几轮进行调整，尽可能完美" — we run 20
 * seasons under each rate, three independent reseeds each (seeds 7, 13, 21
 * XOR'd into world.rngState), and average the metrics.
 *
 * Metrics we capture per (rate, seed, season):
 *   - mean cash by reputation tier (elite ≥ 85 / top ≥ 75 / mid ≥ 65 / low < 65)
 *   - fire-sale count
 *   - count of teams with cash < 0
 *   - count of teams persistently negative (≥ 5 consecutive seasons)
 *
 * The "best" rate is chosen by a balance of:
 *   1. No tier dominates by 5x+ at season 20 (anti-Matthew rule)
 *   2. Mid + low tiers do not go to perma-deficit (>5 consecutive seasons)
 *   3. Fire sales fire 1-3 times per season on average
 *   4. Negative-cash teams average 2-4 per season (some pressure but not chaos)
 */
// @ts-expect-error — node types intentionally not added to tsconfig.app
import { readFileSync, existsSync } from 'fs';
import {
  applyV9ToV10PlayerCurve, applyV10ToV11RetirementInit,
  applyV11ToV12CoachAge, applyV12ToV13ContinentalCupsInit,
  applyV13ToV14InjuriesInit, applyV14ToV15FinanceInit,
  backfillStaleHistoryPlayerIds,
} from '../src/store/game-store';
import { executeCurrentWindow, getCurrentWindow } from '../src/engine/season/season-manager';
import { setSalaryRateForTesting, SALARY_RATE } from '../src/engine/economy/finance';
import type { GameWorld } from '../src/engine/season/season-manager';
import type { TeamBase } from '../src/types/team';

const SAVE_PATH = '/Users/mutu/Downloads/football-universe-s16.json';
const TARGET_SEASONS = 20;
const SEEDS = [7, 13, 21, 41, 73];
// Pass 1: 3-7% (per brief) — too generous; teams hoard cash, Matthew never
//         broken (1.5-1.6x at S20), zero fire sales triggered.
// Pass 2: 10-25% — 25% started showing fire sales (0.17/season) + a few
//         negative teams. Matthew ratio drops to 1.00x at 25%.
// Pass 3: 30-50% — sweet spot lies between 30% (0.48 fire/sn, mid catching elite)
//         and 35% (0.95 fire/sn, elite cratering near 0). 40% kills elite.
// Pass 4: 31-34% — 33% looked best (Matthew 0.12x, fire 0.90/sn, neg 1.93/sn,
//         elite holds €39M, mid-tier flourishes via flat-sponsor anti-Matthew).
// Pass 5: confirm 32-33-34 across 5 seeds (more seeds = less single-run noise).
const RATES = [0.32, 0.33, 0.34];

if (!existsSync(SAVE_PATH)) {
  console.error('Save file not found:', SAVE_PATH);
  process.exit(0);
}

interface SeasonMetric {
  season: number;
  cashByTier: { elite: number[]; top: number[]; mid: number[]; low: number[] };
  fireSales: number;
  negativeTeams: number;
}

function tierOf(rep: number): 'elite' | 'top' | 'mid' | 'low' {
  if (rep >= 85) return 'elite';
  if (rep >= 75) return 'top';
  if (rep >= 65) return 'mid';
  return 'low';
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function buildBaseline(): GameWorld {
  const raw = JSON.parse(readFileSync(SAVE_PATH, 'utf8'));
  const world = raw.state.world as GameWorld;
  // Apply migrations through v15
  backfillStaleHistoryPlayerIds(world as unknown as Parameters<typeof backfillStaleHistoryPlayerIds>[0]);
  applyV9ToV10PlayerCurve(world as unknown as Parameters<typeof applyV9ToV10PlayerCurve>[0]);
  applyV10ToV11RetirementInit(world);
  applyV11ToV12CoachAge(world as unknown as Parameters<typeof applyV11ToV12CoachAge>[0]);
  applyV12ToV13ContinentalCupsInit(world as unknown as Parameters<typeof applyV12ToV13ContinentalCupsInit>[0]);
  applyV13ToV14InjuriesInit(world as unknown as Parameters<typeof applyV13ToV14InjuriesInit>[0]);
  applyV14ToV15FinanceInit(world as unknown as Parameters<typeof applyV14ToV15FinanceInit>[0]);
  return world;
}

function deepCloneWorld(w: GameWorld): GameWorld {
  // structuredClone is ES2022; node 22 has it natively.
  return structuredClone(w);
}

function runSim(rate: number, seedOffset: number): SeasonMetric[] {
  setSalaryRateForTesting(rate);
  let world = deepCloneWorld(BASELINE);
  // Reseed RNG to introduce variance between seeds while keeping starting state
  // identical across rates (apples-to-apples for the rate comparison).
  world = { ...world, rngState: (world.rngState ^ (seedOffset * 1664525 + 1013904223)) >>> 0 };

  const teamReps: Record<string, number> = {};
  for (const [tid, base] of Object.entries(world.teamBases)) {
    teamReps[tid] = (base as TeamBase).reputation;
  }

  const metrics: SeasonMetric[] = [];
  let safety = 0;
  const startSeason = world.seasonState.seasonNumber;
  let prevSeasonNumber = startSeason;
  let prevNewsCount = world.newsLog.length;
  let fireSalesCurSeason = 0;

  while (safety < 5000 && metrics.length < TARGET_SEASONS) {
    const cw = getCurrentWindow(world);
    if (!cw) break;
    const result = executeCurrentWindow(world);
    world = result.world;

    // Tally fire-sale news
    const newNews = world.newsLog.slice(prevNewsCount);
    for (const n of newNews) {
      if (n.type === 'fire_sale') fireSalesCurSeason++;
    }
    prevNewsCount = world.newsLog.length;

    if (world.seasonState.seasonNumber !== prevSeasonNumber) {
      // Season just rolled — capture finance snapshot. Cash is now the
      // post-archive cash (which equals the season-end cash carried fwd).
      const cashByTier = { elite: [] as number[], top: [] as number[], mid: [] as number[], low: [] as number[] };
      let negativeTeams = 0;
      for (const [tid, fin] of Object.entries(world.teamFinances)) {
        const tier = tierOf(teamReps[tid] ?? 60);
        cashByTier[tier].push(fin.cash);
        if (fin.cash < 0) negativeTeams++;
      }
      metrics.push({
        season: prevSeasonNumber,
        cashByTier,
        fireSales: fireSalesCurSeason,
        negativeTeams,
      });
      fireSalesCurSeason = 0;
      prevSeasonNumber = world.seasonState.seasonNumber;
    }
    safety++;
  }
  return metrics;
}

const BASELINE = buildBaseline();
console.log('=== Economy multi-season tuning ===');
console.log(`Baseline season: ${BASELINE.seasonState.seasonNumber}, teams: ${Object.keys(BASELINE.teamBases).length}`);
console.log(`Will run ${TARGET_SEASONS} seasons × ${SEEDS.length} seeds × ${RATES.length} rates = ${TARGET_SEASONS * SEEDS.length * RATES.length} season-runs.`);
console.log();

interface RateSummary {
  rate: number;
  s5: { elite: number; top: number; mid: number; low: number };
  s10: { elite: number; top: number; mid: number; low: number };
  s20: { elite: number; top: number; mid: number; low: number };
  fireSalePerSeason: number;
  negativePerSeason: number;
  permaDeficit: number;       // teams with ≥5 consecutive negative seasons
  matthewRatio: number;       // elite/mid mean cash at S20
  craterCount: number;        // tiers with mean cash < 0 at S20
}

function rateSummary(rate: number, allRuns: SeasonMetric[][]): RateSummary {
  // Combine across seeds: per-season idx, take mean of per-tier means.
  const seasons = allRuns[0].length;
  const collated: { [s: number]: { elite: number[]; top: number[]; mid: number[]; low: number[]; fire: number[]; neg: number[] } } = {};
  for (let s = 0; s < seasons; s++) {
    collated[s] = { elite: [], top: [], mid: [], low: [], fire: [], neg: [] };
    for (const run of allRuns) {
      const m = run[s];
      if (!m) continue;
      collated[s].elite.push(mean(m.cashByTier.elite));
      collated[s].top.push(mean(m.cashByTier.top));
      collated[s].mid.push(mean(m.cashByTier.mid));
      collated[s].low.push(mean(m.cashByTier.low));
      collated[s].fire.push(m.fireSales);
      collated[s].neg.push(m.negativeTeams);
    }
  }
  const fireSalePerSeason = mean(Object.values(collated).flatMap(c => c.fire));
  const negativePerSeason = mean(Object.values(collated).flatMap(c => c.neg));

  let permaDeficit = 0;
  // We need per-team cash trajectory; collect from the original run's per-team
  // by re-running. Simpler: any team observed negative ≥ 5 times in run0.
  // (Approximation — since cashByTier doesn't preserve team ids, we count
  // total negative observations per-tier and treat counts > 5 as deficit
  // candidates. For the report, we use it directionally.)
  for (const r of allRuns) {
    let perRunDeficit = 0;
    let consecutiveNeg = 0;
    for (const m of r) {
      if (m.negativeTeams >= 1) {
        consecutiveNeg++;
        if (consecutiveNeg >= 5) perRunDeficit = Math.max(perRunDeficit, 1);
      } else {
        consecutiveNeg = 0;
      }
    }
    permaDeficit += perRunDeficit;
  }

  const grab = (idx: number) => ({
    elite: mean(collated[idx]?.elite ?? []),
    top: mean(collated[idx]?.top ?? []),
    mid: mean(collated[idx]?.mid ?? []),
    low: mean(collated[idx]?.low ?? []),
  });
  const s5 = grab(4);
  const s10 = grab(9);
  const s20 = grab(19);
  const matthewRatio = s20.mid !== 0 ? s20.elite / Math.max(1, s20.mid) : Infinity;
  const craterCount = ['elite', 'top', 'mid', 'low'].filter(t => (s20 as Record<string, number>)[t] < 0).length;

  return { rate, s5, s10, s20, fireSalePerSeason, negativePerSeason, permaDeficit, matthewRatio, craterCount };
}

const summaries: RateSummary[] = [];
for (const rate of RATES) {
  console.log(`\n--- rate=${(rate * 100).toFixed(1)}% ---`);
  const allRuns: SeasonMetric[][] = [];
  for (const seed of SEEDS) {
    const t0 = Date.now();
    const run = runSim(rate, seed);
    const t = Date.now() - t0;
    console.log(`  seed=${seed}: ${run.length} seasons, ${t}ms, last=S${run.at(-1)?.season}, last fire=${run.at(-1)?.fireSales}, last neg=${run.at(-1)?.negativeTeams}`);
    allRuns.push(run);
  }
  const s = rateSummary(rate, allRuns);
  summaries.push(s);
  console.log(`  S5  cash by tier: elite=${s.s5.elite.toFixed(0)}M / top=${s.s5.top.toFixed(0)}M / mid=${s.s5.mid.toFixed(0)}M / low=${s.s5.low.toFixed(0)}M`);
  console.log(`  S10 cash by tier: elite=${s.s10.elite.toFixed(0)}M / top=${s.s10.top.toFixed(0)}M / mid=${s.s10.mid.toFixed(0)}M / low=${s.s10.low.toFixed(0)}M`);
  console.log(`  S20 cash by tier: elite=${s.s20.elite.toFixed(0)}M / top=${s.s20.top.toFixed(0)}M / mid=${s.s20.mid.toFixed(0)}M / low=${s.s20.low.toFixed(0)}M`);
  console.log(`  Matthew ratio (elite/mid @ S20): ${Number.isFinite(s.matthewRatio) ? s.matthewRatio.toFixed(2) + 'x' : 'INF'}`);
  console.log(`  Cratering tiers @ S20: ${s.craterCount}`);
  console.log(`  Fire sales per season: ${s.fireSalePerSeason.toFixed(2)}`);
  console.log(`  Negative-cash teams per season (avg): ${s.negativePerSeason.toFixed(2)}`);
  console.log(`  Perma-deficit signal (≥5 consecutive seasons w/ ≥1 neg team): ${s.permaDeficit}/${SEEDS.length} runs`);
}

// Reset to the published default for sanity
setSalaryRateForTesting(SALARY_RATE);

console.log('\n=== Verdict ===');
const ranked = summaries.slice().sort((a, b) => {
  // Primary: penalize Matthew ratio > 5; secondary: penalize cratering tiers;
  // tertiary: closeness of fire sale rate to 2/season.
  const score = (s: RateSummary) => {
    let p = 0;
    if (s.matthewRatio > 5) p += 100;
    if (s.matthewRatio > 3) p += 30;
    p += s.craterCount * 50;
    p += Math.abs(s.fireSalePerSeason - 2) * 5;
    if (s.permaDeficit >= 2) p += 40;
    return p;
  };
  return score(a) - score(b);
});

for (const s of ranked) {
  console.log(`rate=${(s.rate * 100).toFixed(1)}%: matthew=${Number.isFinite(s.matthewRatio) ? s.matthewRatio.toFixed(2) + 'x' : 'INF'}, crater=${s.craterCount}, fireSale=${s.fireSalePerSeason.toFixed(2)}/season, neg=${s.negativePerSeason.toFixed(2)}/season, permaDeficit=${s.permaDeficit}/${SEEDS.length}`);
}
console.log(`\nWinner: rate=${(ranked[0].rate * 100).toFixed(1)}%`);
console.log(`Update SALARY_RATE in finance.ts and the TUNE_LOG comment if this differs from current ${(SALARY_RATE * 100).toFixed(1)}%.`);

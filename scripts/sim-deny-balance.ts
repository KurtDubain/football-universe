/**
 * v22 deny pipeline — balance verification harness (self-contained).
 *
 * Loads a real s16 save, runs N seasons forward (deny ACTIVE) and reports
 * balance metrics per season. Self-contained migration to avoid importing
 * game-store.ts (which transitively pulls lz-string with ESM issues).
 *
 *   PATH=/Users/mutu/.nvm/versions/node/v22.22.2/bin:$PATH \
 *     node_modules/.bin/tsx scripts/sim-deny-balance.ts
 */
// @ts-expect-error — node types intentionally not added to tsconfig.app
import { readFileSync, existsSync } from 'fs';
import { executeCurrentWindow, getCurrentWindow } from '../src/engine/season/season-manager';
import type { GameWorld } from '../src/engine/season/season-manager';
import type { TeamBase } from '../src/types/team';

const SAVE_PATH = '/Users/mutu/Downloads/football-universe-s16.json';
const TARGET_SEASONS = 3;
const SEEDS = [7, 13, 21];

if (!existsSync(SAVE_PATH)) {
  console.error('No save found at', SAVE_PATH);
  process.exit(1);
}

function deepCloneWorld(w: GameWorld): GameWorld {
  return JSON.parse(JSON.stringify(w));
}

/**
 * Minimal v8 → v22 backfill. Only fills the fields needed for the sim to
 * run without crashing. Not a complete migration — for our purposes
 * (running matches and reading stats) this is enough.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function backfillToV22(w: any): GameWorld {
  // Required collections
  w.retiredPlayers = w.retiredPlayers ?? [];
  w.coachBases = w.coachBases ?? {};
  w.coachStates = w.coachStates ?? {};
  w.coachHistory = w.coachHistory ?? [];
  w.continentalCupHistory = w.continentalCupHistory ?? [];
  w.playerInjuries = w.playerInjuries ?? {};
  w.teamFinances = w.teamFinances ?? {};
  w.transferRumors = w.transferRumors ?? [];
  w.transferHistory = w.transferHistory ?? [];
  w.playerStatsHistory = w.playerStatsHistory ?? {};
  w.transferWindow = w.transferWindow ?? null;
  w.matchHistory = w.matchHistory ?? [];
  w.freeAgentPool = w.freeAgentPool ?? [];
  w.newsLog = w.newsLog ?? [];
  w.playerAwardsHistory = w.playerAwardsHistory ?? [];
  w.memorableMatches = w.memorableMatches ?? [];

  // Backfill teamFinances for any missing team
  for (const tid of Object.keys(w.teamBases ?? {})) {
    if (!w.teamFinances[tid]) {
      const base = w.teamBases[tid];
      const startCash = base.reputation >= 85 ? 150 : base.reputation >= 75 ? 80 : base.reputation >= 65 ? 40 : 20;
      w.teamFinances[tid] = { cash: startCash, totalIncome: 0, totalExpense: 0, history: [] };
    }
  }

  // Backfill PlayerSeasonStats fields for v21 + v22
  for (const k of Object.keys(w.playerStats ?? {})) {
    const s = w.playerStats[k];
    if (!s) continue;
    s.cleanSheets = s.cleanSheets ?? 0;
    s.saves = s.saves ?? 0;
    s.keyBlocks = s.keyBlocks ?? 0;
    s.bigChances = s.bigChances ?? s.goals ?? 0;
    s.keyPasses = s.keyPasses ?? s.assists ?? 0;
  }

  return w as GameWorld;
}

function loadWorld(): GameWorld {
  const raw = JSON.parse(readFileSync(SAVE_PATH, 'utf8'));
  return backfillToV22(raw.state.world);
}

interface MatchObservation {
  homeGoals: number;
  awayGoals: number;
  homeRep: number;
  awayRep: number;
  saveEvents: number;
  blockEvents: number;
  competitionType: string;
}

interface SeasonReport {
  seed: number;
  season: number;
  matchesPlayed: number;
  leagueMatches: number;
  goalsPerMatch: number;
  leagueGoalsPerMatch: number;
  saveEvents: number;
  blockEvents: number;
  denyRatePercent: number;
  scoreDistribution: Record<string, number>;
  upsetRate: number;
  topScorerGoals: number;
  topGkSaves: number;
  topDfBlocks: number;
  pointsSpread: { winner: number; last: number; gap: number };
  cashByTier: { elite: number; top: number; mid: number; low: number };
}

function tierOf(rep: number): 'elite' | 'top' | 'mid' | 'low' {
  if (rep >= 85) return 'elite';
  if (rep >= 75) return 'top';
  if (rep >= 65) return 'mid';
  return 'low';
}

function runSeed(seed: number, BASELINE: GameWorld): SeasonReport[] {
  let world = deepCloneWorld(BASELINE);
  world = { ...world, rngState: (world.rngState ^ (seed * 1664525 + 1013904223)) >>> 0 };

  const teamReps: Record<string, number> = {};
  for (const [tid, base] of Object.entries(world.teamBases)) {
    teamReps[tid] = (base as TeamBase).reputation;
  }

  const reports: SeasonReport[] = [];
  let currentSeason = world.seasonState.seasonNumber;
  let matchObservations: MatchObservation[] = [];
  // Snapshot of playerStats from the prior iteration — used so that the
  // season-end report uses the CORRECT stats (the just-completed season's),
  // not the freshly-reset stats of the new season. executeCurrentWindow
  // calls initializeNewSeason within the same call when the last window
  // fires, which zeroes playerStats before we'd get a chance to read them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let priorPlayerStats: Record<string, any> = world.playerStats ?? {};
  let priorL1: { points: number }[] = (world.league1Standings ?? []).slice();

  let safety = 0;
  while (safety < 5000 && reports.length < TARGET_SEASONS) {
    const cw = getCurrentWindow(world);
    if (!cw) break;

    // Snapshot stats BEFORE the call (so the season-end report uses them).
    priorPlayerStats = world.playerStats ?? {};
    priorL1 = (world.league1Standings ?? []).slice();

    const result = executeCurrentWindow(world);
    world = result.world;

    // The returned `results` array IS the source of truth — matches are
    // archived into world.matchHistory only at season-end, so reading from
    // matchHistory would miss intra-season matches.
    for (const mr of result.results) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const events = (mr as any).events ?? [];
      const saveCount = events.filter((e: { type: string }) => e.type === 'gk_save').length;
      const blockCount = events.filter((e: { type: string }) => e.type === 'df_block').length;
      const homeRep = (world.teamBases[mr.homeTeamId] as TeamBase | undefined)?.reputation ?? 60;
      const awayRep = (world.teamBases[mr.awayTeamId] as TeamBase | undefined)?.reputation ?? 60;
      matchObservations.push({
        homeGoals: mr.homeGoals,
        awayGoals: mr.awayGoals,
        homeRep, awayRep,
        saveEvents: saveCount,
        blockEvents: blockCount,
        competitionType: mr.competitionType,
      });
    }

    if (world.seasonState.seasonNumber !== currentSeason) {
      const leagueOnly = matchObservations.filter(m => m.competitionType === 'league');
      const totalGoals = matchObservations.reduce((a, m) => a + m.homeGoals + m.awayGoals, 0);
      const leagueGoals = leagueOnly.reduce((a, m) => a + m.homeGoals + m.awayGoals, 0);
      const totalSaves = matchObservations.reduce((a, m) => a + m.saveEvents, 0);
      const totalBlocks = matchObservations.reduce((a, m) => a + m.blockEvents, 0);
      const denyEvents = totalSaves + totalBlocks;
      const scoreDist: Record<string, number> = { '0-0': 0, '1-0/0-1': 0, '2-1/1-2': 0, '5+ goals': 0, other: 0 };
      for (const m of matchObservations) {
        const tot = m.homeGoals + m.awayGoals;
        const key = tot === 0 ? '0-0'
          : tot === 1 ? '1-0/0-1'
          : tot === 3 && Math.abs(m.homeGoals - m.awayGoals) === 1 ? '2-1/1-2'
          : tot >= 5 ? '5+ goals'
          : 'other';
        scoreDist[key]++;
      }
      let upsetable = 0, upsets = 0;
      for (const m of leagueOnly) {
        const repGap = Math.abs(m.homeRep - m.awayRep);
        if (repGap < 5) continue;
        upsetable++;
        const lowerWon = (m.homeRep < m.awayRep && m.homeGoals > m.awayGoals)
          || (m.awayRep < m.homeRep && m.awayGoals > m.homeGoals);
        if (lowerWon) upsets++;
      }
      const upsetRate = upsetable > 0 ? upsets / upsetable : 0;
      // Use the PRIOR snapshot for stats — current playerStats has been
      // reset to 0 by initializeNewSeason.
      let topScorer = 0, topGkSaves = 0, topDfBlocks = 0;
      for (const s of Object.values(priorPlayerStats)) {
        if ((s.goals ?? 0) > topScorer) topScorer = s.goals;
        if ((s.saves ?? 0) > topGkSaves) topGkSaves = s.saves;
        if ((s.keyBlocks ?? 0) > topDfBlocks) topDfBlocks = s.keyBlocks;
      }
      // Use prior L1 standings — current was just reset for new season.
      const winnerPts = priorL1[0]?.points ?? 0;
      const lastPts = priorL1[priorL1.length - 1]?.points ?? 0;
      const cashSums = { elite: 0, top: 0, mid: 0, low: 0 };
      const cashCounts = { elite: 0, top: 0, mid: 0, low: 0 };
      for (const [tid, fin] of Object.entries(world.teamFinances ?? {})) {
        const t = tierOf(teamReps[tid] ?? 60);
        cashSums[t] += (fin as { cash: number }).cash;
        cashCounts[t]++;
      }

      reports.push({
        seed,
        season: currentSeason,
        matchesPlayed: matchObservations.length,
        leagueMatches: leagueOnly.length,
        goalsPerMatch: matchObservations.length > 0 ? totalGoals / matchObservations.length : 0,
        leagueGoalsPerMatch: leagueOnly.length > 0 ? leagueGoals / leagueOnly.length : 0,
        saveEvents: totalSaves,
        blockEvents: totalBlocks,
        denyRatePercent: leagueGoals > 0 ? (denyEvents / (leagueGoals + denyEvents)) * 100 : 0,
        scoreDistribution: scoreDist,
        upsetRate,
        topScorerGoals: topScorer,
        topGkSaves,
        topDfBlocks,
        pointsSpread: { winner: winnerPts, last: lastPts, gap: winnerPts - lastPts },
        cashByTier: {
          elite: cashCounts.elite ? cashSums.elite / cashCounts.elite : 0,
          top: cashCounts.top ? cashSums.top / cashCounts.top : 0,
          mid: cashCounts.mid ? cashSums.mid / cashCounts.mid : 0,
          low: cashCounts.low ? cashSums.low / cashCounts.low : 0,
        },
      });

      matchObservations = [];
      currentSeason = world.seasonState.seasonNumber;
    }
    safety++;
  }
  return reports;
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits).padStart(7);
}

console.log('═══════════════════════════════════════════════════════════════════════════');
console.log('  v22 DENY PIPELINE — BALANCE VERIFICATION (3 seasons × 3 seeds)');
console.log('═══════════════════════════════════════════════════════════════════════════\n');

const BASELINE = loadWorld();
const allReports: SeasonReport[] = [];
for (const seed of SEEDS) {
  console.log(`── Seed ${seed} ───────────────────────────────────────────────────────────`);
  const reports = runSeed(seed, BASELINE);
  for (const r of reports) {
    allReports.push(r);
    console.log(`S${r.season}: ${r.matchesPlayed} matches | ${fmt(r.goalsPerMatch, 2)} g/all ${fmt(r.leagueGoalsPerMatch, 2)} g/league | deny ${fmt(r.denyRatePercent, 1)}% | top GK saves ${r.topGkSaves} | top DF blocks ${r.topDfBlocks} | top scorer ${r.topScorerGoals}g | L1 pts ${r.pointsSpread.winner}-${r.pointsSpread.last} (gap ${r.pointsSpread.gap}) | upsets ${(r.upsetRate * 100).toFixed(0)}%`);
  }
  console.log('');
}

const totalSeasons = allReports.length;
const avg = (selector: (r: SeasonReport) => number) =>
  allReports.reduce((a, r) => a + selector(r), 0) / totalSeasons;

console.log('═══════════════════════════════════════════════════════════════════════════');
console.log(`  AGGREGATE (${totalSeasons} season-runs)`);
console.log('═══════════════════════════════════════════════════════════════════════════\n');

console.log(`Goals/match (all):             ${fmt(avg(r => r.goalsPerMatch), 2)}`);
console.log(`Goals/match (league only):     ${fmt(avg(r => r.leagueGoalsPerMatch), 2)}`);
console.log(`Deny rate (% would-be):        ${fmt(avg(r => r.denyRatePercent), 1)}%`);
console.log(`Top scorer goals (max):        ${fmt(avg(r => r.topScorerGoals), 1)}`);
console.log(`Top GK saves (max):            ${fmt(avg(r => r.topGkSaves), 1)}`);
console.log(`Top DF blocks (max):           ${fmt(avg(r => r.topDfBlocks), 1)}`);
console.log(`L1 points spread (top-last):   ${fmt(avg(r => r.pointsSpread.gap), 1)} pt gap`);
console.log(`Upset rate (lower-rep wins):   ${fmt(avg(r => r.upsetRate) * 100, 1)}%`);

console.log('\nScore distribution (all matches):');
const aggDist: Record<string, number> = {};
for (const r of allReports) {
  for (const [k, v] of Object.entries(r.scoreDistribution)) {
    aggDist[k] = (aggDist[k] ?? 0) + v;
  }
}
let realTotalMatches = 0;
for (const r of allReports) realTotalMatches += r.matchesPlayed;
for (const [k, v] of Object.entries(aggDist)) {
  console.log(`  ${k.padEnd(12)}: ${v.toString().padStart(5)} (${((v / realTotalMatches) * 100).toFixed(1)}%)`);
}

console.log('\nCash by tier (avg across seasons):');
console.log(`  elite (rep≥85): €${fmt(avg(r => r.cashByTier.elite), 0)}M`);
console.log(`  top   (rep≥75): €${fmt(avg(r => r.cashByTier.top), 0)}M`);
console.log(`  mid   (rep≥65): €${fmt(avg(r => r.cashByTier.mid), 0)}M`);
console.log(`  low   (rep<65): €${fmt(avg(r => r.cashByTier.low), 0)}M`);

console.log('\n═══════════════════════════════════════════════════════════════════════════');
console.log('  VERDICT');
console.log('═══════════════════════════════════════════════════════════════════════════\n');

const verdict: string[] = [];
const gpm = avg(r => r.goalsPerMatch);
if (gpm < 2.0) verdict.push(`⚠ GOALS TOO LOW: ${gpm.toFixed(2)}/match`);
else if (gpm > 3.2) verdict.push(`⚠ GOALS TOO HIGH: ${gpm.toFixed(2)}/match`);
else verdict.push(`✓ Goals/match in healthy band: ${gpm.toFixed(2)}`);

const dr = avg(r => r.denyRatePercent);
if (dr < 3) verdict.push(`⚠ DENY TOO RARE: ${dr.toFixed(1)}%`);
else if (dr > 12) verdict.push(`⚠ DENY TOO COMMON: ${dr.toFixed(1)}%`);
else verdict.push(`✓ Deny rate in healthy band: ${dr.toFixed(1)}%`);

const ts = avg(r => r.topScorerGoals);
if (ts < 18) verdict.push(`⚠ TOP SCORER SUPPRESSED: ${ts.toFixed(0)} goals`);
else if (ts > 45) verdict.push(`⚠ TOP SCORER INFLATED: ${ts.toFixed(0)} goals`);
else verdict.push(`✓ Top scorer in healthy band: ${ts.toFixed(0)} goals`);

const gap = avg(r => r.pointsSpread.gap);
if (gap < 25) verdict.push(`⚠ STANDINGS TOO TIGHT: ${gap.toFixed(0)} pt gap`);
else if (gap > 80) verdict.push(`⚠ STANDINGS TOO SPREAD: ${gap.toFixed(0)} pt gap`);
else verdict.push(`✓ Standings spread normal: ${gap.toFixed(0)} pt gap`);

const upR = avg(r => r.upsetRate) * 100;
if (upR > 50) verdict.push(`⚠ TOO MANY UPSETS: ${upR.toFixed(0)}% (favourites being denied too often)`);
else verdict.push(`✓ Upset rate normal: ${upR.toFixed(0)}%`);

const midCash = avg(r => r.cashByTier.mid);
if (midCash < -20) verdict.push(`⚠ MID-TIER BLEEDING: €${midCash.toFixed(0)}M`);
else verdict.push(`✓ Mid-tier cash: €${midCash.toFixed(0)}M`);

for (const v of verdict) console.log(v);
const warnings = verdict.filter(v => v.startsWith('⚠')).length;
console.log(`\n${warnings === 0 ? '✅ ALL GREEN' : '❌ ' + warnings + ' warning(s) — investigate'}`);

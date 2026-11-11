import { executeCurrentWindow, initializeGameWorld } from '../src/engine/season/season-manager';
import type { GameWorld } from '../src/engine/season/season-manager';
import { TIER_COEFFICIENT, type LeagueTier } from '../src/engine/awards/award-weights';
import { leagueConfigs } from '../src/config/competitions';

/**
 * Golden Boot schedule-normalisation sweep.
 *
 * The top flight plays 30 rounds; tiers 2 and 3 play 14. The approved design
 * weights raw goals by a tier coefficient (1.00 / 0.90 / 0.80), which cannot
 * close a ~2.1x schedule gap. This script answers the question with numbers
 * instead of intuition: for each candidate exponent it re-selects the Golden
 * Boot from the SAME simulated seasons, so the only variable is the formula.
 *
 *   goals x (REFERENCE_ROUNDS / leagueRounds) ^ exponent x tierCoefficient
 *
 *   e = 0    approved design: raw goals, tier coefficient only
 *   e = 0.5  partial normalisation (sqrt)
 *   e = 0.75 heavier normalisation
 *   e = 1.0  full per-round rate
 *
 * Usage: SEASONS=20 npx tsx scripts/audit-golden-boot-normalisation.ts
 */

const SEASONS = Number(process.env.SEASONS ?? 20);
const SEED = Number(process.env.SEED ?? 20260722);
const EXPONENTS = [0, 0.5, 0.75, 1.0];

/** Rounds played by each tier, read from config rather than hard-coded. */
const ROUNDS_BY_TIER = leagueConfigs.reduce((acc, config) => {
  acc[config.level as LeagueTier] = config.rounds;
  return acc;
}, {} as Record<LeagueTier, number>);
const REFERENCE_ROUNDS = ROUNDS_BY_TIER[1];

interface ScorerRow {
  playerId: string;
  teamId: string;
  tier: LeagueTier;
  goals: number;
  assists: number;
  appearances: number;
}

function levelOfTeamInSeason(world: GameWorld, teamId: string, season: number): LeagueTier {
  const record = world.teamSeasonRecords?.[teamId]?.find(row => row.seasonNumber === season);
  return (record?.leagueLevel ?? 1) as LeagueTier;
}

function normalisedScore(row: ScorerRow, exponent: number): number {
  const rounds = ROUNDS_BY_TIER[row.tier];
  const schedule = (REFERENCE_ROUNDS / rounds) ** exponent;
  return row.goals * schedule * TIER_COEFFICIENT[row.tier];
}

/** Same total order as season-awards.compareCandidates, minus the uuid step. */
function pickWinner(rows: ScorerRow[], exponent: number): ScorerRow | null {
  let best: ScorerRow | null = null;
  let bestScore = -Infinity;
  for (const row of rows) {
    const score = normalisedScore(row, exponent);
    if (best === null) { best = row; bestScore = score; continue; }
    if (score > bestScore) { best = row; bestScore = score; continue; }
    if (score < bestScore) continue;
    // tiebreak chain: goals, assists, appearances
    if (row.goals !== best.goals) { if (row.goals > best.goals) { best = row; bestScore = score; } continue; }
    if (row.assists !== best.assists) { if (row.assists > best.assists) { best = row; bestScore = score; } continue; }
    if (row.appearances > best.appearances) { best = row; bestScore = score; }
  }
  return best;
}

const tierWins: Record<number, Record<LeagueTier, number>> = {};
const rawGoalsOfWinner: Record<number, number[]> = {};
for (const exponent of EXPONENTS) {
  tierWins[exponent] = { 1: 0, 2: 0, 3: 0 };
  rawGoalsOfWinner[exponent] = [];
}

/** Raw-goal leadership: how often does a lower tier already out-score the top flight? */
let rawLeaderLowerTier = 0;
let seasonsCounted = 0;
const topFlightTopGoals: number[] = [];
const lowerTierTopGoals: number[] = [];

let world = initializeGameWorld(SEED);

for (let index = 0; index < SEASONS; index += 1) {
  const season = world.seasonState.seasonNumber;
  let guard = 0;
  while (world.seasonState.seasonNumber === season && guard < 300) {
    world = executeCurrentWindow(world).world;
    guard += 1;
  }
  if (world.seasonState.seasonNumber === season) {
    throw new Error(`season ${season} did not roll over within the bounded probe`);
  }

  const rows: ScorerRow[] = [];
  for (const [playerId, entries] of Object.entries(world.playerStatsHistory ?? {})) {
    for (const entry of entries) {
      if (entry.season !== season) continue;
      if ((entry.goals ?? 0) <= 0) continue;
      rows.push({
        playerId,
        teamId: entry.teamId,
        tier: levelOfTeamInSeason(world, entry.teamId, season),
        goals: entry.goals ?? 0,
        assists: entry.assists ?? 0,
        appearances: entry.appearances ?? 0,
      });
    }
  }
  if (rows.length === 0) continue;
  seasonsCounted += 1;

  // Raw-goal leadership, independent of any coefficient.
  const rawLeader = pickWinner(rows, 0)!;
  if (rawLeader.tier !== 1) rawLeaderLowerTier += 1;

  const topFlightBest = rows.filter(r => r.tier === 1).reduce<ScorerRow | null>(
    (best, r) => (best === null || r.goals > best.goals ? r : best), null);
  const lowerBest = rows.filter(r => r.tier !== 1).reduce<ScorerRow | null>(
    (best, r) => (best === null || r.goals > best.goals ? r : best), null);
  if (topFlightBest) topFlightTopGoals.push(topFlightBest.goals);
  if (lowerBest) lowerTierTopGoals.push(lowerBest.goals);

  for (const exponent of EXPONENTS) {
    const winner = pickWinner(rows, exponent);
    if (!winner) continue;
    tierWins[exponent][winner.tier] += 1;
    rawGoalsOfWinner[exponent].push(winner.goals);
  }
}

const mean = (values: number[]) =>
  values.length > 0 ? Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(2)) : 0;

console.log(JSON.stringify({
  seed: SEED,
  seasons: seasonsCounted,
  roundsByTier: ROUNDS_BY_TIER,
  rawGoalLeadership: {
    lowerTierLedOnRawGoals: rawLeaderLowerTier,
    share: seasonsCounted > 0 ? Number((rawLeaderLowerTier / seasonsCounted).toFixed(3)) : 0,
    meanTopFlightTopScorer: mean(topFlightTopGoals),
    meanLowerTierTopScorer: mean(lowerTierTopGoals),
  },
  byExponent: EXPONENTS.map(exponent => {
    const tally = tierWins[exponent];
    const total = tally[1] + tally[2] + tally[3];
    return {
      exponent,
      effectiveL2Multiplier: Number(((REFERENCE_ROUNDS / ROUNDS_BY_TIER[2]) ** exponent * TIER_COEFFICIENT[2]).toFixed(3)),
      effectiveL3Multiplier: Number(((REFERENCE_ROUNDS / ROUNDS_BY_TIER[3]) ** exponent * TIER_COEFFICIENT[3]).toFixed(3)),
      L1: tally[1], L2: tally[2], L3: tally[3],
      lowerTierShare: total > 0 ? Number(((tally[2] + tally[3]) / total).toFixed(3)) : 0,
      meanWinnerRawGoals: mean(rawGoalsOfWinner[exponent]),
    };
  }),
}, null, 2));

console.log('');
console.log(`seed ${SEED} · ${seasonsCounted} seasons · rounds L1=${ROUNDS_BY_TIER[1]} L2=${ROUNDS_BY_TIER[2]} L3=${ROUNDS_BY_TIER[3]}`);
console.log('');
console.log('Raw-goal leadership (no coefficient at all):');
console.log(`  lower tier led on raw goals: ${rawLeaderLowerTier}/${seasonsCounted}`);
console.log(`  mean top scorer — top flight ${mean(topFlightTopGoals)} goals, lower tiers ${mean(lowerTierTopGoals)} goals`);
console.log('');
console.log('exp    L2 mult  L3 mult   L1  L2  L3  lower share  mean winner raw goals');
for (const exponent of EXPONENTS) {
  const tally = tierWins[exponent];
  const total = tally[1] + tally[2] + tally[3];
  const l2 = (REFERENCE_ROUNDS / ROUNDS_BY_TIER[2]) ** exponent * TIER_COEFFICIENT[2];
  const l3 = (REFERENCE_ROUNDS / ROUNDS_BY_TIER[3]) ** exponent * TIER_COEFFICIENT[3];
  console.log(
    `${exponent.toFixed(2)}   ${l2.toFixed(3).padStart(6)}  ${l3.toFixed(3).padStart(6)}   `
    + `${String(tally[1]).padStart(2)}  ${String(tally[2]).padStart(2)}  ${String(tally[3]).padStart(2)}  `
    + `${(total > 0 ? (tally[2] + tally[3]) / total : 0).toFixed(3).padStart(10)}  `
    + `${String(mean(rawGoalsOfWinner[exponent])).padStart(20)}`,
  );
}

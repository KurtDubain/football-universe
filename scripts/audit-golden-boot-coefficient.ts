import { executeCurrentWindow, initializeGameWorld } from '../src/engine/season/season-manager';
import type { GameWorld } from '../src/engine/season/season-manager';
import { leagueConfigs } from '../src/config/competitions';
import type { LeagueTier } from '../src/engine/awards/award-weights';

/**
 * Golden Boot: schedule normalisation and tier coefficient are SEPARATE knobs.
 *
 *   goals x (REFERENCE_ROUNDS / leagueRounds) ^ exponent x tierCoefficient
 *
 * The exponent removes a structural artefact (tiers 2/3 play 14 rounds against
 * the top flight's 30) that carries no information about player quality. The
 * coefficient expresses the actual judgement: how much a goal against weaker
 * opposition is worth. Conflating them is what made the approved 0.90 / 0.80
 * decorative — a 10% discount cannot fight a 2.1x schedule gap.
 *
 * This sweep fixes exponent = 1.0 (schedule fully neutralised) and varies the
 * coefficient, so the quality knob can be chosen against real distributions.
 *
 * Usage: SEASONS=30 npx tsx scripts/audit-golden-boot-coefficient.ts
 */

const SEASONS = Number(process.env.SEASONS ?? 30);
const SEED = Number(process.env.SEED ?? 20260722);

/** (L2, L3) coefficient pairs. L1 is 1.0 by definition. */
const COEFFICIENT_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [0.90, 0.80],
  [0.85, 0.72],
  [0.80, 0.65],
  [0.75, 0.58],
  [0.70, 0.50],
  [0.65, 0.45],
];

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

function coefficientFor(tier: LeagueTier, l2: number, l3: number): number {
  if (tier === 1) return 1.0;
  return tier === 2 ? l2 : l3;
}

function rateAdjustedScore(row: ScorerRow, l2: number, l3: number): number {
  const schedule = REFERENCE_ROUNDS / ROUNDS_BY_TIER[row.tier];
  return row.goals * schedule * coefficientFor(row.tier, l2, l3);
}

/** Mirrors season-awards.compareCandidates: score, then goals, assists, appearances. */
function pickWinner(rows: ScorerRow[], l2: number, l3: number): ScorerRow | null {
  let best: ScorerRow | null = null;
  let bestScore = -Infinity;
  for (const row of rows) {
    const score = rateAdjustedScore(row, l2, l3);
    const better = best === null
      || score > bestScore
      || (score === bestScore && (
        row.goals > best.goals
        || (row.goals === best.goals && (
          row.assists > best.assists
          || (row.assists === best.assists && row.appearances > best.appearances)
        ))
      ));
    if (better) { best = row; bestScore = score; }
  }
  return best;
}

const tally = COEFFICIENT_PAIRS.map(() => ({ 1: 0, 2: 0, 3: 0 } as Record<LeagueTier, number>));
const winnerRawGoals = COEFFICIENT_PAIRS.map(() => [] as number[]);
/** How far the winner's per-round rate sits above their own league's mean rate. */
const winnerRateEdge = COEFFICIENT_PAIRS.map(() => [] as number[]);

let seasonsCounted = 0;
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

  // Per-tier mean goals-per-round, used to express how exceptional a winner is
  // inside their own league rather than in absolute terms.
  const meanRateByTier = new Map<LeagueTier, number>();
  for (const tier of [1, 2, 3] as LeagueTier[]) {
    const tierRows = rows.filter(r => r.tier === tier);
    if (tierRows.length === 0) continue;
    const total = tierRows.reduce((sum, r) => sum + r.goals, 0);
    meanRateByTier.set(tier, total / tierRows.length / ROUNDS_BY_TIER[tier]);
  }

  COEFFICIENT_PAIRS.forEach(([l2, l3], pairIndex) => {
    const winner = pickWinner(rows, l2, l3);
    if (!winner) return;
    tally[pairIndex][winner.tier] += 1;
    winnerRawGoals[pairIndex].push(winner.goals);
    const baseline = meanRateByTier.get(winner.tier);
    if (baseline && baseline > 0) {
      const winnerRate = winner.goals / ROUNDS_BY_TIER[winner.tier];
      winnerRateEdge[pairIndex].push(winnerRate / baseline);
    }
  });
}

const mean = (values: number[]) =>
  values.length > 0 ? Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(2)) : 0;

const rowsOut = COEFFICIENT_PAIRS.map(([l2, l3], index) => {
  const counts = tally[index];
  const total = counts[1] + counts[2] + counts[3];
  return {
    L2: l2,
    L3: l3,
    L1: counts[1], tier2: counts[2], tier3: counts[3],
    lowerTierShare: total > 0 ? Number(((counts[2] + counts[3]) / total).toFixed(3)) : 0,
    meanWinnerRawGoals: mean(winnerRawGoals[index]),
    /** Winner's scoring rate as a multiple of their own league's average. */
    meanWinnerRateEdge: mean(winnerRateEdge[index]),
  };
});

console.log(JSON.stringify({ seed: SEED, seasons: seasonsCounted, exponent: 1.0, rows: rowsOut }, null, 2));

console.log('');
console.log(`seed ${SEED} · ${seasonsCounted} seasons · exponent 1.0 (schedule fully neutralised)`);
console.log('');
console.log('L2     L3      L1  L2  L3  lower share  mean winner goals  winner rate vs own league');
for (const row of rowsOut) {
  console.log(
    `${row.L2.toFixed(2)}   ${row.L3.toFixed(2)}   `
    + `${String(row.L1).padStart(2)}  ${String(row.tier2).padStart(2)}  ${String(row.tier3).padStart(2)}  `
    + `${row.lowerTierShare.toFixed(3).padStart(10)}  `
    + `${String(row.meanWinnerRawGoals).padStart(16)}  `
    + `${String(row.meanWinnerRateEdge).padStart(24)}x`,
  );
}

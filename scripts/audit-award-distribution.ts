import { executeCurrentWindow, initializeGameWorld } from '../src/engine/season/season-manager';
import type { GameWorld } from '../src/engine/season/season-manager';
import type { PlayerAwardType } from '../src/types/award';

/**
 * Award distribution audit.
 *
 * Answers the question the redesign was commissioned on: can a standout in a
 * smaller league actually reach an award, and does a title winner ever supply
 * one? Prints a per-award breakdown of winner tiers plus the Golden Boot's
 * raw-goal distribution.
 *
 * Run on the baseline checkout and on the candidate, then diff stdout.
 *
 *   SEASONS=30 npx tsx scripts/audit-award-distribution.ts
 */

const SEASONS = Number(process.env.SEASONS ?? 20);
const SEED = Number(process.env.SEED ?? 20260722);

type Tier = 1 | 2 | 3;

const AWARD_ORDER: PlayerAwardType[] = [
  'mvp', 'golden_boot', 'best_forward', 'best_midfielder',
  'best_defender', 'best_goalkeeper', 'young_player',
];

const tierTally = new Map<PlayerAwardType, Record<Tier, number>>();
const bootRawGoals: number[] = [];
const bootTiers: Tier[] = [];
let championSuppliedMvp = 0;
let seasonsWithMvp = 0;
let seasonsWithAnyLowerTierWinner = 0;

function levelOfTeamInSeason(world: GameWorld, teamId: string, season: number): Tier {
  const record = world.teamSeasonRecords?.[teamId]?.find(row => row.seasonNumber === season);
  return (record?.leagueLevel ?? 1) as Tier;
}

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

  const awards = (world.playerAwardsHistory ?? []).filter(award => award.season === season);
  if (awards.length === 0) continue;

  let lowerTierWinnerThisSeason = false;
  for (const award of awards) {
    const level = levelOfTeamInSeason(world, award.teamId, season);
    const tally = tierTally.get(award.type) ?? { 1: 0, 2: 0, 3: 0 };
    tally[level] += 1;
    tierTally.set(award.type, tally);
    if (level !== 1) lowerTierWinnerThisSeason = true;

    if (award.type === 'golden_boot') {
      bootTiers.push(level);
      const raw = Number(/^(\d+)球/.exec(award.statLabel)?.[1] ?? Number.NaN);
      if (Number.isFinite(raw)) bootRawGoals.push(raw);
    }
  }
  if (lowerTierWinnerThisSeason) seasonsWithAnyLowerTierWinner += 1;

  const champion = world.honorHistory?.find(honor => honor.seasonNumber === season)?.league1Champion;
  const mvp = awards.find(award => award.type === 'mvp');
  if (mvp && champion) {
    seasonsWithMvp += 1;
    if (mvp.teamId === champion) championSuppliedMvp += 1;
  }
}

const rows = AWARD_ORDER.map(award => {
  const tally = tierTally.get(award) ?? { 1: 0, 2: 0, 3: 0 };
  const total = tally[1] + tally[2] + tally[3];
  return {
    award,
    total,
    tier1: tally[1],
    tier2: tally[2],
    tier3: tally[3],
    lowerTierShare: total > 0 ? Number(((tally[2] + tally[3]) / total).toFixed(3)) : 0,
  };
});

const bootLowerTier = bootTiers.filter(level => level !== 1).length;
const mean = (values: number[]) =>
  values.length > 0 ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : 0;

console.log(JSON.stringify({
  seed: SEED,
  seasons: SEASONS,
  perAward: rows,
  goldenBoot: {
    winners: bootTiers.length,
    lowerTierWinners: bootLowerTier,
    lowerTierShare: bootTiers.length > 0 ? Number((bootLowerTier / bootTiers.length).toFixed(3)) : 0,
    meanRawGoals: mean(bootRawGoals),
    minRawGoals: bootRawGoals.length > 0 ? Math.min(...bootRawGoals) : null,
    maxRawGoals: bootRawGoals.length > 0 ? Math.max(...bootRawGoals) : null,
  },
  mvp: {
    seasons: seasonsWithMvp,
    fromChampion: championSuppliedMvp,
    championShare: seasonsWithMvp > 0
      ? Number((championSuppliedMvp / seasonsWithMvp).toFixed(3))
      : 0,
  },
  seasonsWithAnyLowerTierWinner,
}, null, 2));

// Human-readable summary. The Golden Boot line is the one to watch: tiers 2 and
// 3 play 14 rounds against the top flight's 30, so a 0.90 / 0.80 coefficient
// cannot close that gap on its own. If lowerTierShare stays at 0 across many
// seasons, the coefficient is decorative and schedule normalisation is needed.
console.log('');
console.log(`seed ${SEED} · ${SEASONS} seasons`);
console.log('award              total  L1  L2  L3  lower-tier share');
for (const row of rows) {
  console.log(
    `${row.award.padEnd(18)} ${String(row.total).padStart(5)}  `
    + `${String(row.tier1).padStart(2)}  ${String(row.tier2).padStart(2)}  `
    + `${String(row.tier3).padStart(2)}  ${row.lowerTierShare.toFixed(3)}`,
  );
}
console.log('');
console.log(`Golden Boot: ${bootTiers.length} winners, ${bootLowerTier} from tier 2/3, `
  + `mean ${mean(bootRawGoals)} raw goals (range ${bootRawGoals.length > 0 ? Math.min(...bootRawGoals) : '-'}–${bootRawGoals.length > 0 ? Math.max(...bootRawGoals) : '-'})`);
console.log(`MVP from the champion: ${championSuppliedMvp}/${seasonsWithMvp}`);
console.log(`Seasons with at least one tier 2/3 winner: ${seasonsWithAnyLowerTierWinner}/${SEASONS}`);

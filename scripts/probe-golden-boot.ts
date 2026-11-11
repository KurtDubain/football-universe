import { executeCurrentWindow, initializeGameWorld } from '../src/engine/season/season-manager';
import type { GameWorld } from '../src/engine/season/season-manager';
import { goldenBootBreakdown } from '../src/engine/awards/award-scoring';
import { leagueConfigs } from '../src/config/competitions';
import type { LeagueTier } from '../src/engine/awards/award-weights';

/**
 * Golden Boot sanity probe.
 *
 * Prints the engine's actual award label alongside the weighted score of the
 * best player in each tier, so a surprising winner (a 15-goal season, say) can
 * be checked against what the rest of the world scored that year rather than
 * against an assumption.
 *
 * Usage: SEASONS=30 SEED=20260722 npx tsx scripts/probe-golden-boot.ts
 */

const SEASONS = Number(process.env.SEASONS ?? 30);
const SEED = Number(process.env.SEED ?? 20260722);

const ROUNDS = leagueConfigs.reduce((acc, c) => {
  acc[c.level as LeagueTier] = c.rounds;
  return acc;
}, {} as Record<LeagueTier, number>);

function levelOf(world: GameWorld, teamId: string, season: number): LeagueTier {
  const record = world.teamSeasonRecords?.[teamId]?.find(r => r.seasonNumber === season);
  return (record?.leagueLevel ?? 1) as LeagueTier;
}

let world = initializeGameWorld(SEED);
let printed = 0;

for (let index = 0; index < SEASONS; index += 1) {
  const season = world.seasonState.seasonNumber;
  let guard = 0;
  while (world.seasonState.seasonNumber === season && guard < 300) {
    world = executeCurrentWindow(world).world;
    guard += 1;
  }
  if (world.seasonState.seasonNumber === season) throw new Error('season stuck');

  const award = (world.playerAwardsHistory ?? [])
    .find(a => a.season === season && a.type === 'golden_boot');
  if (!award) continue;

  const winnerTier = levelOf(world, award.teamId, season);
  const rawGoals = Number(/^(\d+)球/.exec(award.statLabel)?.[1] ?? NaN);

  // Best weighted score available in each tier that season, from raw history.
  const bestByTier = new Map<LeagueTier, { goals: number; score: number; name: string }>();
  for (const [, entries] of Object.entries(world.playerStatsHistory ?? {})) {
    for (const entry of entries) {
      if (entry.season !== season) continue;
      const goals = entry.goals ?? 0;
      if (goals <= 0) continue;
      const tier = levelOf(world, entry.teamId, season);
      const score = goldenBootBreakdown(goals, tier).score;
      const current = bestByTier.get(tier);
      if (!current || score > current.score) {
        bestByTier.set(tier, { goals, score, name: entry.teamShortName ?? entry.teamId });
      }
    }
  }

  // Only print the interesting ones: lower-tier winners, plus the extremes.
  const isLowerTier = winnerTier !== 1;
  const isExtreme = Number.isFinite(rawGoals) && (rawGoals <= 18 || rawGoals >= 45);
  if (!isLowerTier && !isExtreme) continue;
  if (printed >= 14) break;
  printed += 1;

  const parts = ([1, 2, 3] as LeagueTier[]).map(tier => {
    const best = bestByTier.get(tier);
    if (!best) return `L${tier}:—`;
    return `L${tier}(${ROUNDS[tier]}轮) ${best.goals}球→${best.score.toFixed(1)}`;
  }).join('  ');

  console.log(`S${String(season).padStart(2)} ${award.playerName.padEnd(6)} `
    + `[${award.teamName}] ${award.statLabel}`);
  console.log(`      各层级最佳: ${parts}`);
}

console.log('');
console.log(`(仅列出低级别获奖与极端进球数的赛季，共 ${printed} 条)`);

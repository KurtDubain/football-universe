import {
  executeCurrentWindow,
  initializeGameWorld,
} from '../src/engine/season/season-manager';
import {
  MAX_ACTIVE_STORYLINES,
  MAX_STORYLINES_PER_SEASON,
  STORYLINES_PER_TYPE_PER_SEASON,
  type StorylineOutcome,
  type StorylineType,
} from '../src/engine/season/storylines';

const seedCount = Number.parseInt(process.env.STORYLINE_AUDIT_SEEDS ?? '12', 10);
const seasonsPerSeed = Number.parseInt(process.env.STORYLINE_AUDIT_SEASONS ?? '3', 10);
if (!Number.isInteger(seedCount) || seedCount < 1 || !Number.isInteger(seasonsPerSeed) || seasonsPerSeed < 1) {
  throw new Error('Storyline audit seed and season counts must be positive integers.');
}

const storyTypes: StorylineType[] = [
  'dark_horse',
  'giant_crisis',
  'promoted_survival',
  'unbeaten_run',
  'cup_giant_killer',
];
const outcomes: StorylineOutcome[] = ['success', 'failure'];
const counts = Object.fromEntries(storyTypes.map(type => [type, 0])) as Record<StorylineType, number>;
const outcomeCounts = Object.fromEntries(storyTypes.flatMap(type => outcomes.map(outcome => (
  [`${type}:${outcome}`, 0]
)))) as Record<`${StorylineType}:${StorylineOutcome}`, number>;
const seasonTotals: number[] = [];
const violations: string[] = [];
let maxActive = 0;
const startedAt = performance.now();

for (let seedOffset = 1; seedOffset <= seedCount; seedOffset++) {
  const seed = 940000 + seedOffset;
  let world = initializeGameWorld(seed);
  const finalSeason = world.seasonState.seasonNumber + seasonsPerSeed - 1;
  while (world.seasonState.seasonNumber <= finalSeason) {
    const seasonNumber = world.seasonState.seasonNumber;
    world = executeCurrentWindow(world).world;
    const activeCount = world.activeStorylines?.length ?? 0;
    maxActive = Math.max(maxActive, activeCount);
    if (activeCount > MAX_ACTIVE_STORYLINES) {
      violations.push(`S${seasonNumber} seed ${seed}: ${activeCount} active stories`);
    }
    if (world.seasonState.seasonNumber === seasonNumber) continue;

    const stories = (world.storylineHistory ?? [])
      .filter(storyline => storyline.seasonNumber === seasonNumber);
    seasonTotals.push(stories.length);
    if (stories.length > MAX_STORYLINES_PER_SEASON) {
      violations.push(`S${seasonNumber} seed ${seed}: ${stories.length} season stories`);
    }
    for (const type of storyTypes) {
      const typeStories = stories.filter(storyline => storyline.type === type);
      if (typeStories.length > STORYLINES_PER_TYPE_PER_SEASON[type]) {
        violations.push(`S${seasonNumber} seed ${seed}: ${typeStories.length} ${type} stories`);
      }
      counts[type] += typeStories.length;
      for (const story of typeStories) {
        if (story.outcome) outcomeCounts[`${type}:${story.outcome}`]++;
      }
    }
  }
}

const totalSeasons = seasonTotals.length;
const averageStories = seasonTotals.reduce((total, count) => total + count, 0)
  / Math.max(1, totalSeasons);
if (counts.unbeaten_run < totalSeasons || counts.unbeaten_run > totalSeasons * 2) {
  violations.push(`Unbeaten story frequency ${counts.unbeaten_run}/${totalSeasons} is outside 1-2 per season.`);
}
if (counts.cup_giant_killer < Math.max(1, Math.floor(totalSeasons * 0.1))) {
  violations.push(`Cup giant-killer frequency ${counts.cup_giant_killer}/${totalSeasons} is too low.`);
}
if (averageStories < 4 || averageStories > MAX_STORYLINES_PER_SEASON) {
  violations.push(`Average story frequency ${averageStories.toFixed(2)} is outside the 4-${MAX_STORYLINES_PER_SEASON} target.`);
}
for (const type of ['dark_horse', 'giant_crisis', 'promoted_survival'] as const) {
  if (counts[type] === 0) violations.push(`Existing story family ${type} disappeared from the audit.`);
}

const report = {
  seedCount,
  seasonsPerSeed,
  totalSeasons,
  durationMs: Math.round(performance.now() - startedAt),
  counts,
  outcomeCounts,
  averageStories: Math.round(averageStories * 100) / 100,
  minStories: Math.min(...seasonTotals),
  maxStories: Math.max(...seasonTotals),
  maxActive,
  violations,
};

console.log(JSON.stringify(report, null, 2));
if (violations.length > 0) process.exitCode = 1;

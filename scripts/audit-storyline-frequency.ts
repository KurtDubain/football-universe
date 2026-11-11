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
// Assertions below encode the subtraction: a quieter engine that still speaks.
const MIN_AVERAGE_STORIES = 2;
const MAX_AVERAGE_STORIES = 5;
const MIN_SEASON_SPREAD = 2;
const MAX_CRISIS_PRESENCE = 0.7;
const MIN_DARK_HORSE_JUDGED_SHARE = 0.5;
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
const unjudgedCounts = Object.fromEntries(storyTypes.map(type => [type, 0])) as Record<StorylineType, number>;
const presence = Object.fromEntries(storyTypes.map(type => [type, 0])) as Record<StorylineType, number>;
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
      if (typeStories.length > 0) presence[type]++;
      for (const story of typeStories) {
        if (story.outcome) outcomeCounts[`${type}:${story.outcome}`]++;
        else unjudgedCounts[type]++;
      }
    }
  }
}

const totalSeasons = seasonTotals.length;
const averageStories = seasonTotals.reduce((total, count) => total + count, 0)
  / Math.max(1, totalSeasons);
const minStories = Math.min(...seasonTotals);
const maxStories = Math.max(...seasonTotals);

// The per-season cap itself is enforced per season above; the average has
// its own threshold below, so there is nothing to check here.
// Quieter is the goal, silent is a bug.
if (averageStories < MIN_AVERAGE_STORIES) {
  violations.push(`Average story frequency ${averageStories.toFixed(2)} fell below ${MIN_AVERAGE_STORIES}; the engine stopped narrating.`);
}

// The subtraction itself: the old engine emitted 7.4-7.5 stories every season.
if (averageStories > MAX_AVERAGE_STORIES) {
  violations.push(`Average story frequency ${averageStories.toFixed(2)} is back above ${MAX_AVERAGE_STORIES}; the season review is crowding again.`);
}

// Event-driven, not scheduled. A quota-bound engine produces identical
// seasons; the old one emitted 7.4-7.5 stories every single season.
if (maxStories - minStories < MIN_SEASON_SPREAD) {
  violations.push(`Season story counts span only ${minStories}-${maxStories}; stories look scheduled rather than event-driven.`);
}

// Every family must still appear somewhere in the audit.
for (const type of storyTypes) {
  if (counts[type] === 0) violations.push(`Story family ${type} disappeared from the audit.`);
}

// giant_crisis used to record a hardcoded success on 67-71% of its
// closures. It now only opens for a giant in the direct relegation places,
// so it must be genuinely occasional.
const crisisPresence = presence.giant_crisis / Math.max(1, totalSeasons);
if (crisisPresence >= MAX_CRISIS_PRESENCE) {
  violations.push(`giant_crisis appeared in ${Math.round(crisisPresence * 100)}% of seasons; a giant in the relegation places should be rare.`);
}

// A dark horse that opens should be a real one. Most must reach a season
// verdict rather than quietly stop being tracked: the old gate opened on
// noise and 85-91% of its stories died unjudged.
//
// Skipped when the family never appeared at all: the disappearance check
// above already covers that, and a share over an empty sample is just 0%.
if (counts.dark_horse > 0) {
  const darkHorseJudgedShare = (counts.dark_horse - unjudgedCounts.dark_horse)
    / counts.dark_horse;
  if (darkHorseJudgedShare < MIN_DARK_HORSE_JUDGED_SHARE) {
    violations.push(`Only ${Math.round(darkHorseJudgedShare * 100)}% of dark_horse stories reached a season verdict; the trigger is opening on noise.`);
  }
}

const report = {
  seedCount,
  seasonsPerSeed,
  totalSeasons,
  durationMs: Math.round(performance.now() - startedAt),
  counts,
  outcomeCounts,
  averageStories: Math.round(averageStories * 100) / 100,
  minStories,
  maxStories,
  presence,
  unjudgedCounts,
  maxActive,
  violations,
};

console.log(JSON.stringify(report, null, 2));
if (violations.length > 0) process.exitCode = 1;

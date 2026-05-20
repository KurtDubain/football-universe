/**
 * Standalone Node script — NOT part of the test suite.
 * Run with: PATH=/Users/mutu/.nvm/versions/node/v22.22.2/bin:$PATH \
 *   node_modules/.bin/tsx scripts/coach-retire-sim.ts
 *
 * Loads the s16 real save (read-only), applies migrations up to v12,
 * then runs handleSeasonEnd 5 times in a row to simulate 5 seasons of
 * coach lifecycle (alongside player retirement). Prints retirement
 * counts, candidate-pool consumption, and final age distribution.
 */
// @ts-expect-error — node types intentionally not added to tsconfig.app
import { readFileSync, existsSync } from 'fs';
import {
  backfillStaleHistoryPlayerIds,
  applyV9ToV10PlayerCurve,
  applyV10ToV11RetirementInit,
  applyV11ToV12CoachAge,
} from '../src/store/game-store';
import { handleSeasonEnd } from '../src/engine/season/season-end';
import { initializeNewSeason } from '../src/engine/season/season-manager';
import type { GameWorld } from '../src/engine/season/season-manager';

const SAVE_PATH = '/Users/mutu/Downloads/football-universe-s16.json';

if (!existsSync(SAVE_PATH)) {
  console.error('Save file not found:', SAVE_PATH);
  process.exit(0);
}

const raw = JSON.parse(readFileSync(SAVE_PATH, 'utf8'));
let world = raw.state.world as GameWorld;

// Run all migrations up to v12
backfillStaleHistoryPlayerIds(world as unknown as Parameters<typeof backfillStaleHistoryPlayerIds>[0]);
applyV9ToV10PlayerCurve(world as unknown as Parameters<typeof applyV9ToV10PlayerCurve>[0]);
applyV10ToV11RetirementInit(world);
applyV11ToV12CoachAge(world);

console.log('=== Initial state (post-migration) ===');
console.log(`Season: ${world.seasonState.seasonNumber}`);
console.log(`Coaches in coachBases: ${Object.keys(world.coachBases).length}`);
const initialAges = Object.values(world.coachBases).map((c) => c.age);
const ageMin = Math.min(...initialAges);
const ageMax = Math.max(...initialAges);
const ageAvg = initialAges.reduce((a, b) => a + b, 0) / initialAges.length;
console.log(`Initial coach age: min=${ageMin}, max=${ageMax}, avg=${ageAvg.toFixed(1)}`);
console.log(`Initial coach pool: ${(world.coachCandidatePool ?? []).length}`);
console.log(`Initial coachRetirementHistory: ${(world.coachRetirementHistory ?? []).length}`);

let totalRetirements = 0;
let totalFromPool = 0;
let totalFromFresh = 0;

console.log('\n=== Simulating 5 seasons ===');
for (let i = 0; i < 5; i++) {
  const beforeHistoryLen = (world.coachRetirementHistory ?? []).length;
  // The save's seasonState.completed may or may not be true. handleSeasonEnd
  // doesn't care; it just computes the season-end patch. We then call
  // initializeNewSeason to start the next season for the next iteration.
  world = handleSeasonEnd(world);
  // Find new retirees
  const newRetirees = (world.coachRetirementHistory ?? []).slice(beforeHistoryLen);
  totalRetirements += newRetirees.length;
  // Match new hires by looking at the new coaches added this pass
  // Easiest detection: look at coachChangesThisSeason filtered by reason.
  const lifecycleHires = world.coachChangesThisSeason.filter((c) => c.reason === '退休换帅');
  let fromPool = 0;
  let fromFresh = 0;
  for (const h of lifecycleHires) {
    if (h.newCoachId.startsWith('c-from-player-')) fromPool++;
    else if (h.newCoachId.startsWith('c-fresh-')) fromFresh++;
  }
  totalFromPool += fromPool;
  totalFromFresh += fromFresh;
  console.log(
    `S${world.seasonState.seasonNumber}: ` +
    `retirements=${newRetirees.length}, ` +
    `from_pool=${fromPool}, ` +
    `from_fresh=${fromFresh}, ` +
    `pool_size=${(world.coachCandidatePool ?? []).length}`
  );
  // Start next season for the next iteration
  world = initializeNewSeason(world);
}

console.log('\n=== Final report ===');
console.log(`Total coach retirements: ${totalRetirements}`);
console.log(`From pool (player→coach): ${totalFromPool}`);
console.log(`From fresh: ${totalFromFresh}`);
console.log(
  `Pool consumption ratio (of lifecycle hires): ` +
  `${(totalFromPool + totalFromFresh) > 0
    ? `${((totalFromPool / (totalFromPool + totalFromFresh)) * 100).toFixed(1)}%`
    : 'n/a'}`
);

const finalAges = Object.values(world.coachBases).map((c) => c.age);
const fAgeMin = Math.min(...finalAges);
const fAgeMax = Math.max(...finalAges);
const fAgeAvg = finalAges.reduce((a, b) => a + b, 0) / finalAges.length;
console.log(`Final coach age: min=${fAgeMin}, max=${fAgeMax}, avg=${fAgeAvg.toFixed(1)}`);

// Age histogram
const buckets: Record<string, number> = {
  '<40': 0, '40-49': 0, '50-59': 0, '60-69': 0, '70+': 0,
};
for (const a of finalAges) {
  if (a < 40) buckets['<40']++;
  else if (a < 50) buckets['40-49']++;
  else if (a < 60) buckets['50-59']++;
  else if (a < 70) buckets['60-69']++;
  else buckets['70+']++;
}
console.log(`Final age distribution: ${Object.entries(buckets).map(([k, v]) => `${k}:${v}`).join(' ')}`);

// Sample retired coach names
const retired = world.coachRetirementHistory.slice(-10);
console.log(`\nLast retirements:`);
for (const r of retired) {
  const fromTag = r.fromPlayer ? ' [出身球员]' : '';
  console.log(
    `  S${r.seasonRetired}: ${r.name} (age ${r.age}, ${r.totalSeasons} seasons, ` +
    `${r.trophies.length} trophies)${fromTag}`,
  );
}

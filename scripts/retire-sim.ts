/**
 * Standalone Node script — NOT part of the test suite.
 * Run with: PATH=/Users/mutu/.nvm/versions/node/v22.22.2/bin:$PATH \
 *   node_modules/.bin/tsx scripts/retire-sim.ts
 *
 * Loads the s16 real save (read-only), applies migration up to v11,
 * runs processRetirements once, prints a report.
 */
// @ts-expect-error — node types intentionally not added to tsconfig.app
import { readFileSync, existsSync } from 'fs';
import { applyV9ToV10PlayerCurve, applyV10ToV11RetirementInit, backfillStaleHistoryPlayerIds } from '../src/store/game-store';
import { processRetirements } from '../src/engine/players/retirement';
import { SeededRNG } from '../src/engine/match/rng';
import type { GameWorld } from '../src/engine/season/season-manager';

const SAVE_PATH = '/Users/mutu/Downloads/football-universe-s16.json';

if (!existsSync(SAVE_PATH)) {
  console.error('Save file not found:', SAVE_PATH);
  process.exit(0);
}

const raw = JSON.parse(readFileSync(SAVE_PATH, 'utf8'));
const world = raw.state.world as GameWorld & { coachCandidatePool?: unknown; retirementHistory?: unknown };

backfillStaleHistoryPlayerIds(world as unknown as Parameters<typeof backfillStaleHistoryPlayerIds>[0]);
applyV9ToV10PlayerCurve(world as unknown as Parameters<typeof applyV9ToV10PlayerCurve>[0]);
applyV10ToV11RetirementInit(world);

const total = Object.values(world.squads).flat().length;
console.log(`Total players (input): ${total}`);

const rng = new SeededRNG(world.rngState ?? world.seed ?? 42);
const result = processRetirements(world as GameWorld, rng);

const ageHist: Record<number, number> = {};
for (const r of result.retirements) ageHist[r.age] = (ageHist[r.age] ?? 0) + 1;
const ageKeys = Object.keys(ageHist).map(Number).sort((a, b) => a - b);

console.log(`Retirements: ${result.retirements.length}`);
console.log(`Age histogram: ${ageKeys.map((a) => `${a}:${ageHist[a]}`).join(' ')}`);
console.log(`Coach candidates added: ${result.candidatesAdded.length}`);
console.log(`Coach pool now: ${result.coachCandidatePool.length}`);

const squadSizes = Object.values(result.squads).map((s) => s.length);
console.log(`Squad size range: ${Math.min(...squadSizes)}..${Math.max(...squadSizes)}`);

// Sample 5 youths covering different regions
const oldCounter = (world as unknown as { nextPlayerUuidCounter?: number }).nextPlayerUuidCounter ?? 0;
const samples: { team: string; region: string; pos: string; num: number; name: string; age: number; peak: number; rating: number; gs: number }[] = [];
for (const [teamId, squad] of Object.entries(result.squads)) {
  const team = (world as GameWorld).teamBases[teamId];
  for (const y of squad) {
    if (y.age > 22) continue;
    const num = parseInt(y.uuid.replace('p-', ''));
    if (isNaN(num) || num < oldCounter) continue;
    samples.push({
      team: team?.name ?? teamId, region: team?.region ?? '?',
      pos: y.position, num: y.number, name: y.name,
      age: y.age, peak: y.peakRating, rating: y.rating, gs: y.goalScoring,
    });
  }
}
// Pick 5 spread across regions
const seen = new Set<string>();
console.log(`Sample youths (regional flavor):`);
let printed = 0;
for (const s of samples) {
  const reg = s.region.split('+')[0];
  if (seen.has(reg) && printed >= 3) continue;
  seen.add(reg);
  console.log(`  [${s.region}] ${s.team} ${s.pos} #${s.num} ${s.name} age=${s.age} peak=${s.peak} (rating=${s.rating}) gs=${s.gs}`);
  printed++;
  if (printed >= 5) break;
}

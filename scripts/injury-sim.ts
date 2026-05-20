/**
 * Phase G — injuries / suspensions sim verification.
 *
 * Loads the s16 real save (read-only), applies all migrations up to v14,
 * simulates 5 seasons, prints a report on injury / suspension counts and
 * any noticeable side-effects on title race / golden boot.
 *
 * Run with: PATH=/Users/mutu/.nvm/versions/node/v22.22.2/bin:$PATH \
 *   node_modules/.bin/tsx scripts/injury-sim.ts
 */
// @ts-expect-error — node types intentionally not added to tsconfig.app
import { readFileSync, existsSync } from 'fs';
import {
  applyV9ToV10PlayerCurve, applyV10ToV11RetirementInit,
  applyV11ToV12CoachAge, applyV12ToV13ContinentalCupsInit,
  applyV13ToV14InjuriesInit, backfillStaleHistoryPlayerIds,
} from '../src/store/game-store';
import { executeCurrentWindow, getCurrentWindow } from '../src/engine/season/season-manager';
import type { GameWorld } from '../src/engine/season/season-manager';

const SAVE_PATH = '/Users/mutu/Downloads/football-universe-s16.json';

if (!existsSync(SAVE_PATH)) {
  console.error('Save file not found:', SAVE_PATH);
  process.exit(0);
}

const raw = JSON.parse(readFileSync(SAVE_PATH, 'utf8'));
let world = raw.state.world as GameWorld;

// Apply migrations up to v14
backfillStaleHistoryPlayerIds(world as unknown as Parameters<typeof backfillStaleHistoryPlayerIds>[0]);
applyV9ToV10PlayerCurve(world as unknown as Parameters<typeof applyV9ToV10PlayerCurve>[0]);
applyV10ToV11RetirementInit(world);
applyV11ToV12CoachAge(world as unknown as Parameters<typeof applyV11ToV12CoachAge>[0]);
applyV12ToV13ContinentalCupsInit(world as unknown as Parameters<typeof applyV12ToV13ContinentalCupsInit>[0]);
applyV13ToV14InjuriesInit(world as unknown as Parameters<typeof applyV13ToV14InjuriesInit>[0]);

console.log('=== Initial state ===');
console.log(`Season: ${world.seasonState.seasonNumber}`);
console.log(`Total elapsed windows: ${world.totalElapsedWindows}`);
console.log(`Total players: ${Object.values(world.squads).flat().length}`);

interface SeasonStats {
  season: number;
  injuries: number;
  injuriesBySeverity: { minor: number; moderate: number; major: number; long_term: number };
  suspensions: number;
  emergencySquadFlags: number;
  champion: string;
  topScorer: string;
  topScorerGoals: number;
}

const seasonStats: SeasonStats[] = [];
const targetSeasons = 5;
const startSeason = world.seasonState.seasonNumber;

let prevNewsCount = world.newsLog.length;
let prevTotalElapsed = world.totalElapsedWindows ?? 0;

let safety = 0;
let curSeasonStats: SeasonStats = {
  season: startSeason,
  injuries: 0,
  injuriesBySeverity: { minor: 0, moderate: 0, major: 0, long_term: 0 },
  suspensions: 0,
  emergencySquadFlags: 0,
  champion: '',
  topScorer: '',
  topScorerGoals: 0,
};

while (safety < 500) {
  const cw = getCurrentWindow(world);
  if (!cw) break;
  const seasonNumberBefore = world.seasonState.seasonNumber;
  const result = executeCurrentWindow(world);
  world = result.world;

  // Tally injuries from news log delta
  const newNews = world.newsLog.slice(prevNewsCount);
  for (const n of newNews) {
    if (n.type === 'injury') {
      // Match on title to differentiate
      if (n.title.includes('红牌')) {
        curSeasonStats.suspensions++;
      } else {
        curSeasonStats.injuries++;
      }
    }
  }
  prevNewsCount = world.newsLog.length;

  // Track squad emergency: count cases where any team has fewer than 11 available
  // (heuristic: too many injuries simultaneously). Simple sample check.
  if (world.totalElapsedWindows !== prevTotalElapsed) {
    for (const [, sq] of Object.entries(world.squads)) {
      const cur = world.totalElapsedWindows ?? 0;
      const available = sq.filter(p =>
        (p.injuredUntilWindow ?? 0) <= cur && (p.suspendedUntilWindow ?? 0) <= cur
      );
      if (available.length < 11) {
        curSeasonStats.emergencySquadFlags++;
        break; // count once per window
      }
    }
    prevTotalElapsed = world.totalElapsedWindows ?? 0;
  }

  // Detect season transition
  if (world.seasonState.seasonNumber !== seasonNumberBefore) {
    // The season flipped. The OLD season's awards live on the previous
    // season's last honor record.
    const honor = world.honorHistory[world.honorHistory.length - 1];
    if (honor && honor.seasonNumber === seasonNumberBefore) {
      curSeasonStats.champion = world.teamBases[honor.league1Champion]?.name ?? honor.league1Champion;
    }
    // Top scorer of THE PREVIOUS season — last awards entry of that season
    const lastAwards = world.playerAwardsHistory.filter(a => a.season === seasonNumberBefore);
    const topScorerAward = lastAwards.find(a => a.type === 'golden_boot');
    if (topScorerAward) {
      curSeasonStats.topScorer = topScorerAward.playerName;
      curSeasonStats.topScorerGoals = topScorerAward.statValue ?? 0;
    }

    // Tally injuries by severity from active state at end of season
    for (const sq of Object.values(world.squads)) {
      for (const p of sq) {
        if (p.injuryHistory && p.injuryHistory.length > 0) {
          // Count only the most recent injury (this season)
          const latest = p.injuryHistory[p.injuryHistory.length - 1];
          if (latest.startSeason === seasonNumberBefore) {
            curSeasonStats.injuriesBySeverity[latest.type]++;
          }
        }
      }
    }

    seasonStats.push(curSeasonStats);
    if (seasonStats.length >= targetSeasons) break;
    curSeasonStats = {
      season: world.seasonState.seasonNumber,
      injuries: 0,
      injuriesBySeverity: { minor: 0, moderate: 0, major: 0, long_term: 0 },
      suspensions: 0,
      emergencySquadFlags: 0,
      champion: '',
      topScorer: '',
      topScorerGoals: 0,
    };
  }
  safety++;
}

console.log('\n=== Season summaries ===');
for (const s of seasonStats) {
  console.log(`S${s.season}: 伤病=${s.injuries} (M${s.injuriesBySeverity.minor}/Mo${s.injuriesBySeverity.moderate}/Ma${s.injuriesBySeverity.major}/L${s.injuriesBySeverity.long_term}), 停赛=${s.suspensions}, 紧急阵容=${s.emergencySquadFlags}, 冠军=${s.champion}, 射手王=${s.topScorer}(${s.topScorerGoals})`);
}

const totalInjuries = seasonStats.reduce((sum, s) => sum + Object.values(s.injuriesBySeverity).reduce((a, b) => a + b, 0), 0);
const totalSuspensions = seasonStats.reduce((sum, s) => sum + s.suspensions, 0);
const totalEmergency = seasonStats.reduce((sum, s) => sum + s.emergencySquadFlags, 0);

console.log(`\n=== Aggregates over ${seasonStats.length} seasons ===`);
console.log(`Total active injury entries: ${totalInjuries} (avg ${(totalInjuries / seasonStats.length).toFixed(1)}/season)`);
console.log(`Suspension news: ${totalSuspensions} (avg ${(totalSuspensions / seasonStats.length).toFixed(1)}/season)`);
console.log(`Emergency squad triggers: ${totalEmergency}`);

// Snapshot any currently-injured stars
console.log(`\n=== Active long-term injuries at end ===`);
let longTermActive = 0;
const cur = world.totalElapsedWindows ?? 0;
for (const sq of Object.values(world.squads)) {
  for (const p of sq) {
    if ((p.injuredUntilWindow ?? 0) > cur) {
      const last = p.injuryHistory?.[p.injuryHistory.length - 1];
      if (last?.type === 'long_term' || last?.type === 'major') {
        longTermActive++;
      }
    }
  }
}
console.log(`Long-term + major active injuries persisting into next season: ${longTermActive}`);

console.log(`\nFinal totalElapsedWindows: ${world.totalElapsedWindows}`);

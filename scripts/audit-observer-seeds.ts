import { OBSERVER_SEED_CANDIDATES } from '../src/config/observer-experience';
import {
  executeCurrentWindow,
  getCurrentWindow,
  initializeGameWorld,
} from '../src/engine/season/season-manager';
import { isUpset } from '../src/engine/season/helpers';
import { computeFixtureImportance } from '../src/engine/season/match-importance';

interface SeedAudit {
  seed: number;
  score: number;
  upsetCount: number;
  closeMatchCount: number;
  naturallyFocusedWindows: number;
  averageGoals: number;
}

function auditSeed(seed: number): SeedAudit {
  let world = initializeGameWorld(seed);
  let upsetCount = 0;
  let closeMatchCount = 0;
  let naturallyFocusedWindows = 0;
  let totalGoals = 0;
  let matchCount = 0;

  for (let index = 0; index < 6; index++) {
    const window = getCurrentWindow(world);
    if (!window) break;
    const highestNaturalImportance = Math.max(
      0,
      ...window.fixtures.map(fixture => computeFixtureImportance(fixture, world, []).score),
    );
    if (highestNaturalImportance >= 4) naturallyFocusedWindows++;

    const execution = executeCurrentWindow(world);
    for (const result of execution.results) {
      const home = world.teamBases[result.homeTeamId];
      const away = world.teamBases[result.awayTeamId];
      if (home && away && isUpset(home, away, result)) upsetCount++;
      if (result.prediction
        && Math.abs(result.prediction.homeWinPct - result.prediction.awayWinPct) <= 12) {
        closeMatchCount++;
      }
      totalGoals += result.homeGoals + result.awayGoals
        + (result.etHomeGoals ?? 0) + (result.etAwayGoals ?? 0);
      matchCount++;
    }
    world = execution.world;
  }

  return {
    seed,
    score: upsetCount * 5 + closeMatchCount + naturallyFocusedWindows * 3,
    upsetCount,
    closeMatchCount,
    naturallyFocusedWindows,
    averageGoals: Math.round(totalGoals / Math.max(1, matchCount) * 100) / 100,
  };
}

const audits = OBSERVER_SEED_CANDIDATES
  .map(auditSeed)
  .sort((a, b) => b.score - a.score || a.seed - b.seed);

console.log(JSON.stringify({ selected: audits[0], candidates: audits }, null, 2));

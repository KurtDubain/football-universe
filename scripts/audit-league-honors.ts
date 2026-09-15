import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { initializeGameWorld, executeCurrentWindow } from '../src/engine/season/season-manager';

// Run this same probe on the baseline checkout and the candidate; compare stdout.
const report = [];
let world = initializeGameWorld(20260709);
for (let season = 1; season <= 5; season++) {
  let windows = 0;
  while (world.seasonState.seasonNumber === season && windows++ < 100) world = executeCurrentWindow(world).world;
  assert.equal(world.seasonState.seasonNumber, season + 1, 'season rollover must finish within the bounded probe');
  const fields = ['rngState', 'teamBases', 'teamStates', 'coachBases', 'coachStates', 'squads',
    'playerStats', 'teamFinances', 'seasonState', 'league1Standings', 'league2Standings',
    'league3Standings', 'matchHistory', 'transferHistory', 'leagueCup', 'superCup', 'worldCup',
    'continentalCups', 'nextPlayerUuidCounter', 'nextCoachIdCounter'] as const;
  report.push({ season, rng: world.rngState, hashes: Object.fromEntries(fields.map(field => [field,
    createHash('sha256').update(JSON.stringify(world[field])).digest('hex')])) });
}
console.log(JSON.stringify(report, null, 2));

import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as Engine from '../src/engine/season/season-manager';

// Run against the baseline archive and this checkout. Only focus display metadata is excluded.
const engine = await import(pathToFileURL(resolve(process.env.PARITY_ENGINE_ROOT ?? '.', 'src/engine/season/season-manager.ts')).href) as typeof Engine;
let world = engine.initializeGameWorld(20260709);
const report = [];
for (let season = 1; season <= 5; season++) {
  let windows = 0;
  while (world.seasonState.seasonNumber === season && windows++ < 100) world = engine.executeCurrentWindow(world).world;
  assert.equal(world.seasonState.seasonNumber, season + 1);
  const fields = ['rngState', 'teamStates', 'coachBases', 'coachStates', 'squads', 'playerStats',
    'teamFinances', 'seasonState', 'league1Standings', 'league2Standings', 'league3Standings',
    'matchHistory', 'transferHistory', 'leagueCup', 'superCup', 'worldCup', 'continentalCups',
    'nextPlayerUuidCounter', 'nextCoachIdCounter', 'playerAwardsHistory'] as const;
  report.push({ season, hashes: Object.fromEntries(fields.map(key => [key, createHash('sha256')
    .update(JSON.stringify(world[key], (field, value) => field === 'featuredPlayers' ? undefined : value)).digest('hex')])) });
}
console.log(JSON.stringify(report, null, 2));

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { executeCurrentWindow, getCurrentWindow, initializeGameWorld, type GameWorld } from '../src/engine/season/season-manager';
import { validateWorldData } from '../src/engine/validation/world-data';
import { LONG_SAVE_TARGET_BYTES, LONG_SAVE_TARGET_SEASON } from '../src/store/save-budget';
import { archiveCompletedMatchDetails, boundWorldStorageMetadata } from '../src/store/save-compaction';
import { createPersistedSaveEnvelope, measureWorldSaveSize, type SaveSizeReport } from '../src/store/save-size';
import { SAVE_STORAGE_KEY } from '../src/store/save-constants';
import {
  MATCH_HISTORY_SEASONS,
  PLAYER_AWARDS_SEASONS,
  PLAYER_STATS_HISTORY_SEASONS,
  TEAM_SEASON_RECORDS_PER_TEAM,
  TRANSFER_HISTORY_SEASONS,
} from '../src/engine/season/storage-limits';

const baseUrl = (process.env.LONG_SAVE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const reportPath = process.env.LONG_SAVE_REPORT ?? '/tmp/football-long-save-audit.json';
const seed = Number(process.env.LONG_SAVE_SEED ?? 20260716);
const checkpointSeasons = [1, 50, 100, LONG_SAVE_TARGET_SEASON];
const require = createRequire(import.meta.url);
const { compressToUTF16 } = require('lz-string') as { compressToUTF16: (value: string) => string };

interface Checkpoint {
  season: number;
  save: string;
  report: SaveSizeReport;
}

interface BrowserCheckpointResult {
  season: number;
  actualStorageBytes: number;
  reloadDigestMatches: boolean;
  advanceDigestMatches: boolean;
  errors: number;
  warnings: number;
  warningCodes: string[];
}

interface CleanupEvidence {
  archivedResults: number;
  removedEvents: number;
  removedMatchdaySnapshots: number;
  rawBytesBefore: number;
  rawBytesAfter: number;
  compressedBytesBefore: number;
  compressedBytesAfter: number;
}

function digestWorld(world: GameWorld): string {
  return createHash('sha256').update(JSON.stringify(world)).digest('hex');
}

function parseWorld(save: string): GameWorld {
  return JSON.parse(save).state.world as GameWorld;
}

function advanceLikeStore(source: GameWorld): GameWorld {
  const result = executeCurrentWindow(source, { favoriteTeamIds: [] });
  let coins = result.world.coins ?? 1000;
  for (const bet of result.world.bets ?? []) {
    const matchResult = result.results.find((row) => row.fixtureId === bet.fixtureId);
    if (!matchResult) continue;
    const home = matchResult.homeGoals + (matchResult.etHomeGoals ?? 0);
    const away = matchResult.awayGoals + (matchResult.etAwayGoals ?? 0);
    const outcome = home > away ? 'home' : away > home ? 'away' : 'draw';
    if (outcome === bet.outcome) coins += Math.round(bet.amount * bet.odds);
  }
  return boundWorldStorageMetadata({ ...result.world, coins, bets: [] });
}

function assertHistoryCaps(world: GameWorld): string[] {
  const failures: string[] = [];
  const matchSeasons = new Set((world.matchHistory ?? []).map((entry) => entry.season)).size;
  const transferSeasons = new Set((world.transferHistory ?? []).map((entry) => entry.season)).size;
  const awardSeasons = new Set((world.playerAwardsHistory ?? []).map((entry) => entry.season)).size;
  const maxPlayerSeasons = Math.max(0, ...Object.values(world.playerStatsHistory ?? {})
    .map((rows) => new Set(rows.map((row) => row.season)).size));
  const maxTeamRecords = Math.max(0, ...Object.values(world.teamSeasonRecords ?? {}).map((rows) => rows.length));
  if (matchSeasons > MATCH_HISTORY_SEASONS) failures.push(`match history seasons ${matchSeasons}`);
  if (transferSeasons > TRANSFER_HISTORY_SEASONS) failures.push(`transfer history seasons ${transferSeasons}`);
  if (awardSeasons > PLAYER_AWARDS_SEASONS) failures.push(`award seasons ${awardSeasons}`);
  if (maxPlayerSeasons > PLAYER_STATS_HISTORY_SEASONS) failures.push(`player history seasons ${maxPlayerSeasons}`);
  if (maxTeamRecords > TEAM_SEASON_RECORDS_PER_TEAM) failures.push(`team records ${maxTeamRecords}`);
  return failures;
}

async function waitForAudit(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as typeof window & {
    __gameStore?: unknown;
    __gameAudit?: unknown;
  }).__gameStore && (window as typeof window & { __gameAudit?: unknown }).__gameAudit));
}

async function verifyCheckpointInBrowser(page: Page, checkpoint: Checkpoint): Promise<BrowserCheckpointResult> {
  const actualStorageBytes = await page.evaluate(({ save, key }) => {
    const audit = (window as typeof window & {
      __gameAudit?: { importSave: (text: string) => void };
    }).__gameAudit;
    if (!audit) throw new Error('Audit bridge unavailable');
    audit.importSave(save);
    return (localStorage.getItem(key)?.length ?? 0) * 2;
  }, { save: checkpoint.save, key: SAVE_STORAGE_KEY });

  await page.reload({ waitUntil: 'networkidle' });
  await waitForAudit(page);
  const reloadedSave = await page.evaluate(() => {
    const audit = (window as typeof window & {
      __gameAudit?: { exportSave: () => string };
    }).__gameAudit;
    if (!audit) throw new Error('Audit bridge unavailable');
    return audit.exportSave();
  });
  const reloadedWorld = parseWorld(reloadedSave);
  const validation = validateWorldData(reloadedWorld);
  const originalWorld = parseWorld(checkpoint.save);
  const reloadDigestMatches = digestWorld(reloadedWorld) === digestWorld(originalWorld);
  const expectedAfterAdvance = advanceLikeStore(originalWorld);

  await page.evaluate(async () => {
    const store = (window as typeof window & {
      __gameStore?: { getState: () => { advanceWindow: () => Promise<void> } };
    }).__gameStore;
    if (!store) throw new Error('Audit store unavailable');
    await store.getState().advanceWindow();
  });
  const advancedSave = await page.evaluate(() => {
    const audit = (window as typeof window & {
      __gameAudit?: { exportSave: () => string };
    }).__gameAudit;
    if (!audit) throw new Error('Audit bridge unavailable');
    return audit.exportSave();
  });
  const advancedWorld = parseWorld(advancedSave);

  return {
    season: checkpoint.season,
    actualStorageBytes,
    reloadDigestMatches,
    advanceDigestMatches: digestWorld(advancedWorld) === digestWorld(expectedAfterAdvance),
    errors: validation.errors.length,
    warnings: validation.warnings.length,
    warningCodes: [...new Set(validation.warnings.map((issue) => issue.code))],
  };
}

let world = initializeGameWorld(seed);
let advances = 0;
let rolloverErrors = 0;
let rolloverWarnings = 0;
const checkpoints: Checkpoint[] = [];

while (world.seasonState.seasonNumber <= LONG_SAVE_TARGET_SEASON && advances < 10_000) {
  const season = world.seasonState.seasonNumber;
  const window = getCurrentWindow(world);
  if (!window) throw new Error(`No current window at season ${season}`);
  if (window.type === 'season_end' && checkpointSeasons.includes(season)) {
    checkpoints.push({
      season,
      save: JSON.stringify(createPersistedSaveEnvelope(world)),
      report: measureWorldSaveSize(world, 'season-end', compressToUTF16),
    });
  }
  world = advanceLikeStore(world);
  advances++;
  if (world.seasonState.seasonNumber !== season) {
    const validation = validateWorldData(world);
    rolloverErrors += validation.errors.length;
    rolloverWarnings += validation.warnings.length;
  }
}

if (checkpoints.length !== checkpointSeasons.length) {
  throw new Error(`Expected ${checkpointSeasons.length} checkpoints, found ${checkpoints.length}`);
}

const capFailures = assertHistoryCaps(world);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const browserErrors: string[] = [];
page.on('pageerror', (error) => browserErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') browserErrors.push(message.text());
});

let browserCheckpoints: BrowserCheckpointResult[] = [];
try {
  await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean((window as typeof window & { __gameAudit?: unknown }).__gameAudit));
  browserCheckpoints = [];
  for (const checkpoint of checkpoints) {
    browserCheckpoints.push(await verifyCheckpointInBrowser(page, checkpoint));
  }
} finally {
  await browser.close();
}

const target = checkpoints.find((checkpoint) => checkpoint.season === LONG_SAVE_TARGET_SEASON)!;
const targetWorld = parseWorld(target.save);
const cleanup = archiveCompletedMatchDetails(targetWorld);
const cleanupBefore = measureWorldSaveSize(targetWorld, 'cleanup-before', compressToUTF16);
const cleanupAfter = measureWorldSaveSize(cleanup.world, 'cleanup-after', compressToUTF16);
const cleanupEvidence: CleanupEvidence = {
  archivedResults: cleanup.archivedResults,
  removedEvents: cleanup.removedEvents,
  removedMatchdaySnapshots: cleanup.removedMatchdaySnapshots,
  rawBytesBefore: cleanupBefore.total.rawBytes,
  rawBytesAfter: cleanupAfter.total.rawBytes,
  compressedBytesBefore: cleanupBefore.total.compressedBytes,
  compressedBytesAfter: cleanupAfter.total.compressedBytes,
};
const passed = rolloverErrors === 0
  && rolloverWarnings === 0
  && capFailures.length === 0
  && target.report.total.compressedBytes < LONG_SAVE_TARGET_BYTES
  && cleanupEvidence.archivedResults > 0
  && cleanupEvidence.rawBytesAfter < cleanupEvidence.rawBytesBefore
  && cleanupEvidence.compressedBytesAfter < cleanupEvidence.compressedBytesBefore
  && browserErrors.length === 0
  && browserCheckpoints.every((checkpoint) => (
    checkpoint.actualStorageBytes < LONG_SAVE_TARGET_BYTES
    && checkpoint.reloadDigestMatches
    && checkpoint.advanceDigestMatches
    && checkpoint.errors === 0
    && checkpoint.warnings === 0
  ));

const output = {
  passed,
  seed,
  advances,
  completedSeasons: world.seasonState.seasonNumber - 1,
  rolloverErrors,
  rolloverWarnings,
  capFailures,
  budgetBytes: LONG_SAVE_TARGET_BYTES,
  checkpoints: checkpoints.map(({ season, report }) => ({ season, report })),
  cleanupEvidence,
  browserCheckpoints,
  browserErrors,
};
writeFileSync(reportPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
if (!passed) process.exitCode = 1;

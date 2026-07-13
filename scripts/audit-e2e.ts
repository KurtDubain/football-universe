/** Current-schema browser and data-chain audit. */
import { chromium, type ConsoleMessage } from 'playwright';
import { writeFileSync } from 'node:fs';
import { validateWorldData } from '../src/engine/validation/world-data';
import type { GameWorld } from '../src/engine/season/season-manager';

const baseUrl = process.env.AUDIT_URL ?? 'http://localhost:5173';
const targetSeasons = Number(process.env.AUDIT_SEASONS ?? 10);
const seed = Number(process.env.AUDIT_SEED ?? 20260713);
const reportPath = process.env.AUDIT_REPORT ?? '/tmp/football-current-audit.json';

type SeasonResult = {
  season: number;
  windows: number;
  errors: number;
  warnings: number;
  issueCodes: string[];
};

function relevantConsoleMessage(message: ConsoleMessage): string | null {
  if (!['error', 'warning'].includes(message.type())) return null;
  const text = message.text();
  if (text.includes('[vite]') || text.includes('React DevTools') || text.includes('favicon')) return null;
  return `${message.type()}: ${text}`;
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    const relevant = relevantConsoleMessage(message);
    if (relevant) runtimeErrors.push(relevant);
  });

  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean((window as typeof window & { __gameStore?: unknown }).__gameStore));
    await page.evaluate(`window.__gameStore.getState().newGame(${seed})`);
    await page.waitForFunction(() => Boolean((window as typeof window & { __gameStore?: { getState(): { world?: unknown } } }).__gameStore?.getState().world));

    const initialSeason = await page.evaluate(`window.__gameStore.getState().world.seasonState.seasonNumber`) as number;
    const results: SeasonResult[] = [];
    let advances = 0;
    const maxAdvances = targetSeasons * 120;

    while (results.length < targetSeasons && advances < maxAdvances) {
      const before = await page.evaluate(`window.__gameStore.getState().world.seasonState.seasonNumber`) as number;
      await page.evaluate(`window.__gameStore.getState().advanceWindow()`);
      advances++;
      const after = await page.evaluate(`window.__gameStore.getState().world.seasonState.seasonNumber`) as number;
      if (after === before) continue;

      const world = await page.evaluate(`window.__gameStore.getState().world`) as GameWorld;
      const validation = validateWorldData(world);
      results.push({
        season: before,
        windows: world.totalElapsedWindows,
        errors: validation.errors.length,
        warnings: validation.warnings.length,
        issueCodes: [...new Set(validation.issues.map(issue => issue.code))],
      });
    }

    const ids = await page.evaluate(`(() => {
      const world = window.__gameStore.getState().world;
      const teamId = Object.keys(world.teamBases)[0];
      const playerId = world.squads[teamId][0].uuid;
      const coachId = Object.keys(world.coachBases)[0];
      return { teamId, playerId, coachId };
    })()`) as { teamId: string; playerId: string; coachId: string };

    const routes = [
      '/', '/calendar', '/league/1', '/cup/league_cup', '/teams', '/players',
      `/player/${ids.playerId}`, `/team/${ids.teamId}`, '/coaches', `/coach/${ids.coachId}`,
      '/history', '/chronicle', '/legends', '/transfers', '/memorable', '/search',
      '/compare', '/settings',
    ];
    const routeResults: Array<{ route: string; ok: boolean; textLength: number }> = [];
    for (const route of routes) {
      const beforeErrors = runtimeErrors.length;
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
      const textLength = (await page.locator('body').innerText()).trim().length;
      routeResults.push({ route, ok: textLength > 20 && runtimeErrors.length === beforeErrors, textLength });
    }

    const failedData = results.filter(result => result.errors > 0 || result.warnings > 0);
    const failedRoutes = routeResults.filter(result => !result.ok);
    const report = {
      schema: 'current-only',
      seed,
      initialSeason,
      targetSeasons,
      completedSeasons: results.length,
      advances,
      results,
      routes: routeResults,
      runtimeErrors,
      passed: results.length === targetSeasons
        && failedData.length === 0
        && failedRoutes.length === 0
        && runtimeErrors.length === 0,
    };
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

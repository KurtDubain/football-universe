/** Deterministic current-schema browser, persistence, data, and UX audit. */
import { chromium, type BrowserContext, type ConsoleMessage, type Page } from 'playwright';
import { writeFileSync } from 'node:fs';
import { validateWorldData } from '../src/engine/validation/world-data';
import type { GameWorld } from '../src/engine/season/season-manager';

const baseUrl = (process.env.AUDIT_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
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

type AuditStoreState = {
  world: GameWorld | null;
  newGame: (seed: number) => void;
  advanceWindow: () => void;
};

type BrowserAuditWindow = Window & {
  __gameStore?: { getState: () => AuditStoreState };
  __gameAudit?: { exportSave: () => string; importSave: (text: string) => void };
};

type ViewportName = 'mobile' | 'desktop';

type RouteResult = {
  route: string;
  viewport: ViewportName;
  ok: boolean;
  textLength: number;
  horizontalOverflow: boolean;
  clippedLabels: string[];
  undersizedPrimaryTargets: string[];
};

function relevantConsoleMessage(message: ConsoleMessage): string | null {
  if (!['error', 'warning'].includes(message.type())) return null;
  const text = message.text();
  if (text.includes('[vite]') || text.includes('React DevTools') || text.includes('favicon')) return null;
  return `${message.type()}: ${text}`;
}

function attachRuntimeErrorCapture(page: Page, runtimeErrors: string[]): void {
  page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    const relevant = relevantConsoleMessage(message);
    if (relevant) runtimeErrors.push(relevant);
  });
}

async function waitForAuditStore(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const auditWindow = window as BrowserAuditWindow;
    return Boolean(auditWindow.__gameStore?.getState().world && auditWindow.__gameAudit);
  });
}

async function inspectRoute(
  page: Page,
  route: string,
  viewport: ViewportName,
  runtimeErrors: string[],
): Promise<RouteResult> {
  await page.setViewportSize(viewport === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  const beforeErrors = runtimeErrors.length;
  await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });

  const metrics = await page.evaluate((isMobile) => {
    const root = document.documentElement;
    const labels = [...document.querySelectorAll<HTMLElement>('button,a,[role="button"],h1,h2,h3')]
      .filter(element => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = getComputedStyle(element);
        const constrainsInlineText = style.whiteSpace === 'nowrap'
          || style.overflowX === 'hidden'
          || style.overflowX === 'clip';
        return constrainsInlineText
          && element.scrollWidth > element.clientWidth + 2
          && style.textOverflow !== 'ellipsis';
      })
      .map(element => (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80))
      .filter(Boolean)
      .slice(0, 10);

    const primaryPattern = /^(开始新游戏|推进|开始模拟)/;
    const undersized = isMobile
      ? [...document.querySelectorAll<HTMLElement>('button,[role="button"]')]
        .filter(element => primaryPattern.test((element.textContent ?? '').trim()))
        .filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.width < 44 || rect.height < 44;
        })
        .map(element => (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80))
      : [];

    return {
      textLength: (document.body.innerText ?? '').trim().length,
      horizontalOverflow: root.scrollWidth > window.innerWidth + 1,
      clippedLabels: labels,
      undersizedPrimaryTargets: undersized,
    };
  }, viewport === 'mobile');

  return {
    route,
    viewport,
    ...metrics,
    ok: metrics.textLength > 20
      && !metrics.horizontalOverflow
      && metrics.clippedLabels.length === 0
      && metrics.undersizedPrimaryTargets.length === 0
      && runtimeErrors.length === beforeErrors,
  };
}

async function verifyOfflineRevisit(page: Page, context: BrowserContext): Promise<boolean> {
  await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'networkidle' });
  await page.goto(`${baseUrl}/history`, { waitUntil: 'networkidle' });
  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
    return (await page.locator('body').innerText()).trim().length > 20;
  } catch {
    return false;
  } finally {
    await context.setOffline(false);
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const runtimeErrors: string[] = [];
  attachRuntimeErrorCapture(page, runtimeErrors);

  try {
    await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
    const coldLoad = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      const scripts = performance.getEntriesByType('resource')
        .filter(resource => resource.name.endsWith('.js')) as PerformanceResourceTiming[];
      return {
        domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
        loadMs: Math.round(navigation.loadEventEnd),
        scriptTransferBytes: scripts.reduce((sum, resource) => sum + resource.transferSize, 0),
        scriptRequests: scripts.length,
      };
    });

    await page.waitForFunction(() => Boolean((window as BrowserAuditWindow).__gameStore));
    await page.evaluate((gameSeed) => {
      (window as BrowserAuditWindow).__gameStore?.getState().newGame(gameSeed);
    }, seed);
    await waitForAuditStore(page);

    const initialSeason = await page.evaluate(() => (
      window as BrowserAuditWindow
    ).__gameStore?.getState().world?.seasonState.seasonNumber ?? 0);
    const results: SeasonResult[] = [];
    let advances = 0;
    const maxAdvances = targetSeasons * 120;

    while (results.length < targetSeasons && advances < maxAdvances) {
      const before = await page.evaluate(() => (
        window as BrowserAuditWindow
      ).__gameStore?.getState().world?.seasonState.seasonNumber ?? 0);
      await page.evaluate(() => (window as BrowserAuditWindow).__gameStore?.getState().advanceWindow());
      advances++;
      const after = await page.evaluate(() => (
        window as BrowserAuditWindow
      ).__gameStore?.getState().world?.seasonState.seasonNumber ?? 0);
      if (after === before) continue;

      const world = await page.evaluate(() => (
        window as BrowserAuditWindow
      ).__gameStore?.getState().world) as GameWorld;
      const validation = validateWorldData(world);
      results.push({
        season: before,
        windows: world.totalElapsedWindows,
        errors: validation.errors.length,
        warnings: validation.warnings.length,
        issueCodes: [...new Set(validation.issues.map(issue => issue.code))],
      });
    }

    const beforeSave = await page.evaluate(() => {
      const world = (window as BrowserAuditWindow).__gameStore?.getState().world;
      return { seed: world?.seed, season: world?.seasonState.seasonNumber, windows: world?.totalElapsedWindows };
    });
    const exportedSave = await page.evaluate(() => (window as BrowserAuditWindow).__gameAudit?.exportSave() ?? '');
    await page.evaluate((save) => (window as BrowserAuditWindow).__gameAudit?.importSave(save), exportedSave);
    await page.reload({ waitUntil: 'networkidle' });
    await waitForAuditStore(page);
    const afterSave = await page.evaluate(() => {
      const world = (window as BrowserAuditWindow).__gameStore?.getState().world;
      return { seed: world?.seed, season: world?.seasonState.seasonNumber, windows: world?.totalElapsedWindows };
    });
    const saveRoundTrip = exportedSave.startsWith('{') && JSON.stringify(beforeSave) === JSON.stringify(afterSave);

    const ids = await page.evaluate(() => {
      const world = (window as BrowserAuditWindow).__gameStore?.getState().world;
      if (!world) return null;
      const teamId = Object.keys(world.teamBases)[0];
      return {
        teamId,
        playerId: world.squads[teamId][0].uuid,
        coachId: Object.keys(world.coachBases)[0],
      };
    });
    if (!ids) throw new Error('Audit world did not provide route entity ids');

    const allRoutes = [
      '/', '/calendar', '/league/1', '/cup/league_cup', '/teams', '/players',
      `/player/${ids.playerId}`, `/team/${ids.teamId}`, '/coaches', `/coach/${ids.coachId}`,
      '/history', '/chronicle', '/legends', '/transfers', '/memorable', '/search',
      '/compare', '/settings',
    ];
    const keyRoutes = ['/', '/players', `/player/${ids.playerId}`, '/teams', `/team/${ids.teamId}`, '/history', '/settings'];
    const routeResults: RouteResult[] = [];
    for (const route of allRoutes) routeResults.push(await inspectRoute(page, route, 'mobile', runtimeErrors));
    for (const route of keyRoutes) routeResults.push(await inspectRoute(page, route, 'desktop', runtimeErrors));

    await page.goto(`${baseUrl}/players`, { waitUntil: 'networkidle' });
    await page.goto(`${baseUrl}/teams`, { waitUntil: 'networkidle' });
    await page.goBack({ waitUntil: 'networkidle' });
    const backNavigation = new URL(page.url()).pathname === '/players';

    await page.goto(`${baseUrl}/team/${ids.teamId}`, { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    const deepLinkRefresh = new URL(page.url()).pathname === `/team/${ids.teamId}`
      && (await page.locator('body').innerText()).trim().length > 20;

    const offlineRevisit = await verifyOfflineRevisit(page, context);
    const failedData = results.filter(result => result.errors > 0 || result.warnings > 0);
    const failedRoutes = routeResults.filter(result => !result.ok);
    const report = {
      schema: 'current-only',
      seed,
      initialSeason,
      targetSeasons,
      completedSeasons: results.length,
      advances,
      coldLoad,
      saveRoundTrip,
      backNavigation,
      deepLinkRefresh,
      offlineRevisit,
      results,
      routes: routeResults,
      runtimeErrors,
      passed: results.length === targetSeasons
        && failedData.length === 0
        && failedRoutes.length === 0
        && runtimeErrors.length === 0
        && saveRoundTrip
        && backNavigation
        && deepLinkRefresh
        && offlineRevisit,
    };
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  writeFileSync(reportPath, `${JSON.stringify({ passed: false, fatalError: message }, null, 2)}\n`);
  console.error(error);
  process.exitCode = 1;
});

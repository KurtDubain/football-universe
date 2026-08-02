import { chromium, type ConsoleMessage, type Page } from 'playwright';
import {
  executeCurrentWindow,
  getCurrentWindow,
  initializeGameWorld,
  type GameWorld,
} from '../src/engine/season/season-manager';
import {
  appendObserverSeasonTrajectory,
  buildObserverSeasonTrajectory,
} from '../src/engine/observation/season-trajectory';
import { buildObservationTheme } from '../src/engine/observation/observation-theme';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const seed = Number(process.env.VERIFY_SEED ?? 20260731);
const checkpoints = [40, 100, 150];

type AuditWindow = Window & {
  __gameStore?: {
    getState: () => { world: GameWorld | null };
    setState: (patch: {
      world: GameWorld;
      initialized: boolean;
      favoriteTeamId: string;
      favoriteTeamIds: string[];
    }) => void;
  };
};

function captureError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
}

function advanceObservedWorld(world: GameWorld, favoriteTeamId: string): GameWorld {
  const window = getCurrentWindow(world);
  const theme = window?.type === 'season_end'
    ? buildObservationTheme(world, favoriteTeamId, 'auto')
    : null;
  const trajectory = window?.type === 'season_end'
    ? buildObserverSeasonTrajectory(world, favoriteTeamId, theme)
    : null;
  const result = executeCurrentWindow(world, { favoriteTeamIds: [favoriteTeamId] });
  return appendObserverSeasonTrajectory(result.world, trajectory);
}

function completeFirstSeason(): { world: GameWorld; favoriteTeamId: string } {
  let world = initializeGameWorld(seed);
  const favoriteTeamId = Object.keys(world.teamBases)[0];
  let advances = 0;
  while (world.seasonState.seasonNumber === 1 && advances < 200) {
    world = advanceObservedWorld(world, favoriteTeamId);
    advances++;
  }
  if (world.seasonState.seasonNumber !== 2) {
    throw new Error(`Could not complete first season after ${advances} advances`);
  }
  return { world, favoriteTeamId };
}

function syntheticLongHistory(source: GameWorld, seasons: number): GameWorld {
  const honor = source.honorHistory.at(-1);
  if (!honor) throw new Error('Completed world has no honor record');
  const honorHistory = Array.from({ length: seasons }, (_, index) => ({
    ...honor,
    seasonNumber: index + 1,
    promoted: honor.promoted.map(entry => ({ ...entry })),
    relegated: honor.relegated.map(entry => ({ ...entry })),
    coachChanges: honor.coachChanges.map(entry => ({ ...entry })),
  }));
  const minRecordSeason = Math.max(1, seasons - 39);
  const teamSeasonRecords = Object.fromEntries(
    Object.entries(source.teamSeasonRecords).map(([teamId, records]) => {
      const record = records.at(-1);
      return [teamId, record
        ? Array.from({ length: seasons - minRecordSeason + 1 }, (_, index) => ({
          ...record,
          seasonNumber: minRecordSeason + index,
        }))
        : []];
    }),
  );
  const teamTrophies = Object.fromEntries(
    Object.entries(source.teamTrophies).map(([teamId, trophies]) => [
      teamId,
      Array.from({ length: seasons }, (_, index) =>
        trophies.map(trophy => ({ ...trophy, seasonNumber: index + 1 })),
      ).flat(),
    ]),
  );
  const trajectory = source.observerSeasonTrajectories?.at(-1);
  const observerSeasonTrajectories = trajectory
    ? Array.from({ length: Math.min(40, seasons) }, (_, index) => ({
      ...trajectory,
      seasonNumber: seasons - Math.min(40, seasons) + index + 1,
      checkpoints: trajectory.checkpoints.map(checkpoint => ({ ...checkpoint })),
      destinyDeviation: trajectory.destinyDeviation
        ? { ...trajectory.destinyDeviation }
        : undefined,
      judgment: trajectory.judgment ? { ...trajectory.judgment } : undefined,
      theme: trajectory.theme ? { ...trajectory.theme } : undefined,
    }))
    : [];
  const sourceAwards = source.playerAwardsHistory.filter(award => award.season === 1);
  const playerAwardsHistory = Array.from({ length: Math.min(50, seasons) }, (_, index) =>
    sourceAwards.map(award => ({
      ...award,
      season: seasons - Math.min(50, seasons) + index + 1,
    })),
  ).flat();

  return {
    ...source,
    seasonState: {
      ...source.seasonState,
      seasonNumber: seasons + 1,
    },
    honorHistory,
    teamSeasonRecords,
    teamTrophies,
    observerSeasonTrajectories,
    playerAwardsHistory,
  };
}

async function installWorld(page: Page, world: GameWorld, favoriteTeamId: string): Promise<void> {
  await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean((window as AuditWindow).__gameStore));
  await page.evaluate(({ nextWorld, teamId }) => {
    const store = (window as AuditWindow).__gameStore;
    if (!store) throw new Error('Audit store unavailable');
    store.setState({
      world: nextWorld,
      initialized: true,
      favoriteTeamId: teamId,
      favoriteTeamIds: [teamId],
    });
  }, { nextWorld: world, teamId: favoriteTeamId });
}

async function verifySummaryInteraction(
  page: Page,
  viewport: string,
): Promise<Record<string, unknown>> {
  await page.goto(`${baseUrl}/history?audit=1`, { waitUntil: 'networkidle' });
  const firstRow = page.getByTestId('season-history-row').first();
  await firstRow.waitFor({ state: 'visible' });
  await firstRow.getByTestId('season-history-toggle').click();
  const summary = firstRow.getByTestId('season-history-summary');
  await summary.waitFor({ state: 'visible' });
  const eventCount = await summary.locator('[data-event-type]').count();
  if (eventCount < 3 || eventCount > 7) {
    throw new Error(`${viewport}: expected 3-7 events, found ${eventCount}`);
  }
  if (await firstRow.getByTestId('season-detail').count() !== 0) {
    throw new Error(`${viewport}: full detail rendered before request`);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 1) throw new Error(`${viewport}: history overflow ${overflow}px`);
  const screenshot = `/tmp/football-history-summary-${viewport}.png`;
  await summary.scrollIntoViewIfNeeded();
  await page.screenshot({ path: screenshot, animations: 'disabled', fullPage: false });
  await firstRow.getByTestId('toggle-season-detail').click();
  await firstRow.getByTestId('season-detail').waitFor({ state: 'visible' });

  const entityLinks = await summary.locator('a[data-link-kind]').evaluateAll(links =>
    links.map(link => ({
      kind: link.getAttribute('data-link-kind') ?? '',
      href: link.getAttribute('href') ?? '',
    })),
  );
  const verifiedHrefs: Record<string, string> = {};
  for (const kind of ['team', 'player', 'coach']) {
    const href = entityLinks.find(link => link.kind === kind)?.href;
    if (!href) throw new Error(`${viewport}: summary has no ${kind} link`);
    await page.goto(`${baseUrl}${href}${href.includes('?') ? '&' : '?'}audit=1`, {
      waitUntil: 'networkidle',
    });
    if ((await page.locator('body').innerText()).trim().length < 20) {
      throw new Error(`${viewport}: ${kind} link opened an empty route`);
    }
    verifiedHrefs[kind] = href;
  }

  return { eventCount, overflow, verifiedHrefs, screenshot };
}

async function measureLongHistory(
  page: Page,
  world: GameWorld,
  favoriteTeamId: string,
  seasons: number,
): Promise<Record<string, number>> {
  await installWorld(page, world, favoriteTeamId);
  const routeStart = performance.now();
  await page.goto(`${baseUrl}/history?audit=1`, { waitUntil: 'networkidle' });
  await page.getByTestId('season-history-row').first().waitFor({ state: 'visible' });
  const routeMs = performance.now() - routeStart;
  const defaultRows = await page.getByTestId('season-history-row').count();
  if (defaultRows !== 10) throw new Error(`S${seasons}: default rendered ${defaultRows} rows`);

  const allStart = performance.now();
  await page.getByTestId('season-history-range').selectOption('all');
  await page.waitForFunction(
    target => document.querySelectorAll('[data-testid="season-history-row"]').length === target,
    seasons,
  );
  const allRowsMs = performance.now() - allStart;

  const scrollStart = performance.now();
  await page.evaluate(async () => {
    const main = document.querySelector<HTMLElement>('.app-route-content');
    if (!main) throw new Error('Route scroller missing');
    main.scrollTop = main.scrollHeight;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  });
  const scrollMs = performance.now() - scrollStart;

  await page.getByTestId('season-history-range').selectOption('recent40');
  await page.waitForFunction(() =>
    document.querySelectorAll('[data-testid="season-history-row"]').length === 40,
  );
  const recentRows = await page.getByTestId('season-history-row').count();
  if (recentRows !== 40) throw new Error(`S${seasons}: recent filter rendered ${recentRows} rows`);

  const summaryStart = performance.now();
  const row = page.getByTestId('season-history-row').first();
  await row.getByTestId('season-history-toggle').click();
  await row.getByTestId('season-history-summary').waitFor({ state: 'visible' });
  const summaryMs = performance.now() - summaryStart;

  const budgets = { routeMs: 2_000, allRowsMs: 1_000, scrollMs: 500, summaryMs: 500 };
  const metrics = { routeMs, allRowsMs, scrollMs, summaryMs };
  for (const [key, budget] of Object.entries(budgets)) {
    if (metrics[key as keyof typeof metrics] > budget) {
      throw new Error(`S${seasons}: ${key} ${metrics[key as keyof typeof metrics].toFixed(1)}ms > ${budget}ms`);
    }
  }
  return Object.fromEntries(
    Object.entries(metrics).map(([key, value]) => [key, Math.round(value * 10) / 10]),
  );
}

async function main(): Promise<void> {
  const completed = completeFirstSeason();
  const browser = await chromium.launch({ headless: true });
  const errors: string[] = [];
  const reports: Record<string, unknown>[] = [];
  try {
    for (const viewport of [
      { name: 'mobile-320', width: 320, height: 568, isMobile: true, hasTouch: true },
      { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
    ]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch,
      });
      const page = await context.newPage();
      page.on('console', message => captureError(message, errors));
      page.on('pageerror', error => errors.push(error.message));
      await installWorld(page, completed.world, completed.favoriteTeamId);
      reports.push({
        viewport: `${viewport.width}x${viewport.height}`,
        ...await verifySummaryInteraction(page, viewport.name),
      });
      await context.close();
    }

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on('console', message => captureError(message, errors));
    page.on('pageerror', error => errors.push(error.message));
    const performanceReports: Record<string, number>[] = [];
    for (const seasons of checkpoints) {
      performanceReports.push({
        seasons,
        ...await measureLongHistory(
          page,
          syntheticLongHistory(completed.world, seasons),
          completed.favoriteTeamId,
          seasons,
        ),
      });
    }
    await context.close();

    if (errors.length > 0) throw new Error(`Runtime errors: ${errors.join(' | ')}`);
    console.log(JSON.stringify({ passed: true, reports, performanceReports }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

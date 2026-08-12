import { chromium, type ConsoleMessage, type Page } from 'playwright';
import { getTeamCoachId } from '../src/engine/coaches/coach-lookup';
import { buildPlayerNarrativeThread, buildTeamNarrativeThread } from '../src/engine/observation/narrative-threads';
import {
  executeCurrentWindow,
  initializeGameWorld,
  type GameWorld,
} from '../src/engine/season/season-manager';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const viewports = [
  { name: 'compact', width: 320, height: 568, isMobile: true, hasTouch: true },
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'wide-mobile', width: 430, height: 932, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
] as const;

type AuditWindow = Window & {
  __gameStore?: {
    getState: () => unknown;
    setState: (patch: Record<string, unknown>) => void;
  };
};

function captureError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
}

function preparedWorld(): {
  world: GameWorld;
  teamId: string;
  playerId: string;
  coachId: string;
} {
  let world = initializeGameWorld(20260824);
  let advances = 0;
  while ((world.seasonState.seasonNumber < 2 || world.seasonState.currentWindowIndex < 12) && advances < 160) {
    world = executeCurrentWindow(world).world;
    advances++;
  }
  if (world.seasonState.seasonNumber !== 2) throw new Error('Could not prepare a completed season.');

  const teamId = Object.keys(world.teamBases).find(id => Boolean(buildTeamNarrativeThread(world, id)));
  const playerId = Object.values(world.squads).flat()
    .map(player => player.uuid)
    .find(id => Boolean(buildPlayerNarrativeThread(world, id)));
  if (!teamId || !playerId) throw new Error('Prepared world has no canonical narrative thread.');
  const coachId = getTeamCoachId(world.coachStates, teamId)
    ?? Object.keys(world.coachStates).find(id => Boolean(world.coachStates[id].currentTeamId));
  if (!coachId) throw new Error('Prepared world has no active coach.');
  return { world, teamId, playerId, coachId };
}

async function installWorld(
  page: Page,
  fixture: ReturnType<typeof preparedWorld>,
): Promise<void> {
  await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean((window as AuditWindow).__gameStore));
  await page.evaluate(({ nextWorld, teamId, playerId }) => {
    const store = (window as AuditWindow).__gameStore;
    if (!store) throw new Error('Audit store unavailable');
    store.setState({
      world: nextWorld,
      initialized: true,
      favoriteTeamId: teamId,
      favoriteTeamIds: [teamId],
      favoritePlayerIds: [playerId],
      narrativeMemory: [],
      lastResults: [],
      lastNews: [],
      lastObservationSettlements: [],
      lastWorldResponse: null,
      isAdvancing: false,
      advanceError: null,
    });
  }, { nextWorld: fixture.world, teamId: fixture.teamId, playerId: fixture.playerId });
  await page.getByTestId('dashboard').waitFor({ state: 'visible' });
}

async function assertNoOverflow(page: Page, label: string): Promise<number> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`${label}: horizontal overflow ${overflow}px`);
  return overflow;
}

async function verifyRouteThread(page: Page, route: string, label: string): Promise<void> {
  await page.goto(`${baseUrl}${route}?audit=1`, { waitUntil: 'networkidle' });
  if (route.startsWith('/team/')) await page.getByRole('tab', { name: '历史', exact: true }).click();
  const thread = page.getByTestId('entity-narrative-thread');
  await thread.waitFor({ state: 'visible', timeout: 10_000 });
  const details = thread.locator('details');
  if (await details.count()) {
    if (await details.first().evaluate(element => element.hasAttribute('open'))) {
      throw new Error(`${label}: detail thread started expanded`);
    }
    await details.first().locator('summary').click();
  }
  await assertNoOverflow(page, label);
}

async function main(): Promise<void> {
  const fixture = preparedWorld();
  const browser = await chromium.launch({ headless: true });
  const reports: unknown[] = [];
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch,
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('console', message => captureError(message, errors));
      page.on('pageerror', error => errors.push(error.message));
      await installWorld(page, fixture);

      await page.getByRole('tab', { name: '比赛日' }).click();
      const pulse = page.getByTestId('world-pulse');
      await pulse.waitFor({ state: 'visible' });
      const later = pulse.getByTestId('narrative-later');
      const laterCount = await later.count();
      if (laterCount !== 1) throw new Error(`${viewport.name}: expected one Later surface, found ${laterCount}`);
      if (await later.evaluate(element => element.hasAttribute('open'))) {
        throw new Error(`${viewport.name}: Later started expanded`);
      }
      await later.locator('summary').click();
      const more = pulse.getByTestId('more-world-signals');
      const moreCount = await more.count();
      if (moreCount !== 1) throw new Error(`${viewport.name}: expected one More surface, found ${moreCount}`);
      if (await more.evaluate(element => element.hasAttribute('open'))) {
        throw new Error(`${viewport.name}: More started expanded`);
      }
      await more.locator('summary').click();
      const featureCount = await pulse.getByTestId('narrative-feature').count();
      const signalCount = await pulse.locator('[data-testid="narrative-signals"] > div').count();
      if (featureCount > 1 || signalCount > 2) {
        throw new Error(`${viewport.name}: attention budget exceeded ${featureCount}+${signalCount}`);
      }
      const pulseOverflow = await assertNoOverflow(page, `${viewport.name} pulse`);
      const screenshot = `/tmp/football-narrative-director-${viewport.name}.png`;
      await pulse.scrollIntoViewIfNeeded();
      await page.screenshot({ path: screenshot, animations: 'disabled' });

      await page.getByRole('tab', { name: '总览' }).click();
      const overview = page.getByTestId('season-narrative-overview');
      await overview.waitFor({ state: 'visible' });
      const overviewText = (await overview.textContent()) ?? '';
      if (!overviewText.includes('赛季版图') || !overviewText.includes('主要观察')) {
        throw new Error(`${viewport.name}: season overview lacks its core context`);
      }
      const overviewOverflow = await assertNoOverflow(page, `${viewport.name} overview`);

      await verifyRouteThread(page, `/team/${fixture.teamId}`, `${viewport.name} team thread`);
      await verifyRouteThread(page, `/player/${fixture.playerId}`, `${viewport.name} player thread`);
      await verifyRouteThread(page, `/coach/${fixture.coachId}`, `${viewport.name} coach thread`);

      await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
      const reviewTab = page.getByRole('tab', { name: /S1(?:回顾|档案)/ });
      await reviewTab.waitFor({ state: 'visible' });
      await reviewTab.click();
      await page.getByTestId('season-storylines').waitFor({ state: 'visible' });
      const reviewOverflow = await assertNoOverflow(page, `${viewport.name} season review`);

      await page.goto(`${baseUrl}/history?audit=1`, { waitUntil: 'networkidle' });
      const historyRow = page.getByTestId('season-history-row').first();
      await historyRow.waitFor({ state: 'visible' });
      await historyRow.getByTestId('season-history-toggle').click();
      const history = historyRow.getByTestId('season-history-summary');
      await history.waitFor({ state: 'visible' });
      if (await history.locator('[data-event-type="story"]').count() < 1) {
        throw new Error(`${viewport.name}: resolved story is missing from History`);
      }
      const historyOverflow = await assertNoOverflow(page, `${viewport.name} history`);
      if (errors.length > 0) throw new Error(`${viewport.name}: ${errors.join(' | ')}`);

      reports.push({
        viewport: `${viewport.width}x${viewport.height}`,
        featureCount,
        signalCount,
        later: laterCount,
        more: moreCount,
        pulseOverflow,
        overviewOverflow,
        reviewOverflow,
        historyOverflow,
        screenshot,
      });
      await context.close();
    }
    console.log(JSON.stringify({ passed: true, fixture: {
      season: fixture.world.seasonState.seasonNumber,
      teamId: fixture.teamId,
      playerId: fixture.playerId,
      coachId: fixture.coachId,
    }, reports }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

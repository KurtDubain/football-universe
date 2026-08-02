import { chromium, type ConsoleMessage, type Page } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const seed = 20260720;
const viewports = [
  { name: 'compact-mobile', width: 320, height: 568, isMobile: true, hasTouch: true },
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
] as const;

type AuditStore = {
  getState: () => {
    isAdvancing: boolean;
    lastNews: unknown[];
    world: {
      seasonState: { seasonNumber: number; calendar: Array<{ type: string }> };
      teamBases: Record<string, { name: string }>;
      squads: Record<string, Array<{ uuid: string; rating: number; injuredUntilWindow?: number }>>;
      totalElapsedWindows: number;
      worldCup: null | {
        groups: Array<{
          fixtures: Array<{ isNeutralVenue?: boolean }>;
        }>;
      };
    };
    newGame: (seed: number) => void;
    advanceWindow: () => Promise<void>;
    advanceUntil: (target: 'season_end') => Promise<void>;
  };
  setState: (patch: unknown) => void;
};

function collectConsoleError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
}

async function initializeGame(page: Page): Promise<{ teamId: string; teamName: string }> {
  await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean((window as typeof window & { __gameStore?: unknown }).__gameStore));
  return page.evaluate((gameSeed) => {
    const store = (window as typeof window & { __gameStore?: AuditStore }).__gameStore;
    if (!store) throw new Error('Audit store unavailable');
    store.getState().newGame(gameSeed);
    const state = store.getState();
    const teamId = Object.keys(state.world.teamBases)[0];
    return { teamId, teamName: state.world.teamBases[teamId].name };
  }, seed);
}

async function assertNoOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) throw new Error(`${label}: horizontal overflow ${overflow}px`);
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const results: unknown[] = [];
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch,
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('console', message => collectConsoleError(message, errors));
      page.on('pageerror', error => errors.push(error.message));
      const fixture = await initializeGame(page);

      await page.goto(`${baseUrl}/history?audit=1`, { waitUntil: 'networkidle' });
      for (const tabName of ['赛季历史', '俱乐部积分', '趣味数据', '荣誉殿堂', '名帅殿堂']) {
        const tab = page.getByRole('tab', { name: tabName, exact: true });
        await tab.click();
        const box = await tab.boundingBox();
        if (!box || box.x < -1 || box.x + box.width > viewport.width + 1) {
          throw new Error(`${viewport.name}: active History tab ${tabName} is outside the viewport`);
        }
      }
      await page.getByRole('tab', { name: '俱乐部积分', exact: true }).click();
      const coefficientRows = await page.getByTestId('club-coefficient-row').count();
      if (coefficientRows !== 32) throw new Error(`${viewport.name}: expected 32 coefficient rows, got ${coefficientRows}`);
      await page.getByText(/完成首个赛季后开始累计/).waitFor({ state: 'visible' });
      if (!viewport.isMobile) {
        await page.getByText('暂无赛季积分').first().waitFor({ state: 'visible' });
      }
      await assertNoOverflow(page, `${viewport.name} coefficient`);
      await page.screenshot({ path: `/tmp/football-coefficient-${viewport.name}.png`, animations: 'disabled' });

      await page.evaluate((teamId) => {
        const store = (window as typeof window & { __gameStore?: AuditStore }).__gameStore;
        if (!store) throw new Error('Audit store unavailable');
        const state = store.getState();
        const squad = state.world.squads[teamId];
        const star = [...squad].sort((a, b) => b.rating - a.rating)[0];
        store.setState({
          world: {
            ...state.world,
            squads: {
              ...state.world.squads,
              [teamId]: squad.map(player => player.uuid === star.uuid
                ? { ...player, injuredUntilWindow: state.world.totalElapsedWindows + 20 }
                : player),
            },
          },
        });
      }, fixture.teamId);
      await page.goto(`${baseUrl}/team/${fixture.teamId}?audit=1`, { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: '阵容', exact: true }).click();
      await page.getByText(/当前损失/).waitFor({ state: 'visible' });
      const boostText = await page.getByText(/当前损失/).textContent();
      await assertNoOverflow(page, `${viewport.name} squad boost`);
      await page.screenshot({ path: `/tmp/football-squad-boost-${viewport.name}.png`, animations: 'disabled' });

      await page.goto(`${baseUrl}/settings?audit=1`, { waitUntil: 'networkidle' });
      await page.getByText('v4.24.0', { exact: true }).first().waitFor({ state: 'visible' });
      await page.getByText('洲际荣誉更稀有，中立场不再偏向任何一边', { exact: true })
        .waitFor({ state: 'visible' });
      await page.getByText(/洲际杯改为第5赛季起每6季举办一次/).waitFor({ state: 'visible' });
      await assertNoOverflow(page, `${viewport.name} changelog`);
      await page.getByText('洲际荣誉更稀有，中立场不再偏向任何一边', { exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({ path: `/tmp/football-changelog-${viewport.name}.png`, animations: 'disabled' });

      await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
      await page.getByTestId('dashboard-advance').click();
      await page.waitForFunction(() => {
        const store = (window as typeof window & { __gameStore?: AuditStore }).__gameStore;
        const state = store?.getState();
        return Boolean(state && !state.isAdvancing && state.lastNews.length > 0);
      });
      const ticker = page.locator('button[aria-controls="global-news-list"]');
      await ticker.waitFor({ state: 'visible' });
      await ticker.focus();
      await page.keyboard.press('Enter');
      if (await ticker.getAttribute('aria-expanded') !== 'true') {
        throw new Error(`${viewport.name}: news ticker did not open from the keyboard`);
      }
      await page.locator('#global-news-list button').first().focus();
      await page.keyboard.press('Enter');
      if (await ticker.getAttribute('aria-expanded') !== 'false') {
        throw new Error(`${viewport.name}: news item did not close the ticker from the keyboard`);
      }
      await page.screenshot({ path: `/tmp/football-news-${viewport.name}.png`, animations: 'disabled' });

      const worldCupAudit = await page.evaluate(async () => {
        const store = (window as typeof window & { __gameStore?: AuditStore }).__gameStore;
        if (!store) throw new Error('Audit store unavailable');
        let safety = 0;
        while (
          (
            store.getState().world.seasonState.seasonNumber < 4
            || !store.getState().world.worldCup
          )
          && safety < 240
        ) {
          await store.getState().advanceWindow();
          safety += 1;
        }
        const world = store.getState().world;
        const groupFixtures = world.worldCup?.groups.flatMap(group => group.fixtures) ?? [];
        return {
          season: world.seasonState.seasonNumber,
          groupWindows: world.seasonState.calendar.filter(window => window.type === 'world_cup_group').length,
          knockoutWindows: world.seasonState.calendar.filter(window => window.type === 'world_cup').length,
          groupFixtures: groupFixtures.length,
          allNeutral: groupFixtures.every(fixture => fixture.isNeutralVenue === true),
        };
      });
      if (
        worldCupAudit.season !== 4
        || worldCupAudit.groupWindows !== 3
        || worldCupAudit.knockoutWindows !== 4
        || worldCupAudit.groupFixtures !== 48
        || !worldCupAudit.allNeutral
      ) {
        throw new Error(`${viewport.name}: invalid world cup format ${JSON.stringify(worldCupAudit)}`);
      }
      await page.goto(`${baseUrl}/cup/world_cup?audit=1`, { waitUntil: 'networkidle' });
      await page.getByText(/32 队 · 四年一届/).waitFor({ state: 'visible' });
      await page.locator('summary').filter({ hasText: '赛事规则' }).click();
      await page.getByText(/中立场单循环3轮/).waitFor({ state: 'visible' });
      await page.getByText('A 组', { exact: true }).waitFor({ state: 'visible' });
      await assertNoOverflow(page, `${viewport.name} world cup`);
      await page.screenshot({ path: `/tmp/football-world-cup-${viewport.name}.png`, animations: 'disabled' });

      const seasonAfterAdvance = await page.evaluate(async () => {
        const store = (window as typeof window & { __gameStore?: AuditStore }).__gameStore;
        if (!store) throw new Error('Audit store unavailable');
        let safety = 0;
        while (store.getState().world.seasonState.seasonNumber < 5 && safety < 300) {
          await store.getState().advanceWindow();
          safety += 1;
        }
        return store.getState().world.seasonState.seasonNumber;
      });
      if (seasonAfterAdvance !== 5) {
        throw new Error(`${viewport.name}: expected season 5, got season ${seasonAfterAdvance}`);
      }
      const cupWindows = await page.evaluate(() => {
        const store = (window as typeof window & { __gameStore?: AuditStore }).__gameStore;
        return store?.getState().world.seasonState.calendar.filter(window => window.type === 'continental_cup').length;
      });
      if (cupWindows !== 5) throw new Error(`${viewport.name}: expected five continental windows, got ${cupWindows}`);
      await page.goto(`${baseUrl}/cup/mainland_cup?audit=1`, { waitUntil: 'networkidle' });
      await page.getByText(/大陆地区 · 8 队 · 六年一届/).waitFor({ state: 'visible' });
      await page.getByText('A 组', { exact: true }).waitFor({ state: 'visible' });
      await page.getByText('B 组', { exact: true }).waitFor({ state: 'visible' });
      await assertNoOverflow(page, `${viewport.name} continental cup`);
      await page.screenshot({ path: `/tmp/football-continental-${viewport.name}.png`, animations: 'disabled' });

      if (errors.length > 0) throw new Error(`${viewport.name}: ${errors.join(' | ')}`);
      results.push({ viewport: `${viewport.width}x${viewport.height}`, coefficientRows, boostText, cupWindows });
      await context.close();
    }
    console.log(JSON.stringify({ passed: true, results }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

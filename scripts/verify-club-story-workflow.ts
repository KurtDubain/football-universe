import { chromium, type ConsoleMessage, type Page } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const seed = 20260720;
const viewports = [
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
      await page.getByText('v4.8.0', { exact: true }).first().waitFor({ state: 'visible' });
      await page.getByText('俱乐部脉络', { exact: true }).waitFor({ state: 'visible' });
      await page.getByText(/重做球员阵容加成/).waitFor({ state: 'visible' });
      await assertNoOverflow(page, `${viewport.name} changelog`);
      await page.getByText('俱乐部脉络', { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `/tmp/football-changelog-${viewport.name}.png`, animations: 'disabled' });

      await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: '开始模拟', exact: true }).click();
      await page.waitForFunction(() => {
        const store = (window as typeof window & { __gameStore?: AuditStore }).__gameStore;
        const state = store?.getState();
        return Boolean(state && !state.isAdvancing && state.lastNews.length > 0);
      });
      await page.getByText(/头条|关注|简讯/).first().waitFor({ state: 'visible' });
      await page.screenshot({ path: `/tmp/football-news-${viewport.name}.png`, animations: 'disabled' });

      await page.evaluate(async () => {
        const store = (window as typeof window & { __gameStore?: AuditStore }).__gameStore;
        if (!store) throw new Error('Audit store unavailable');
        await store.getState().advanceUntil('season_end');
        await store.getState().advanceWindow();
      });
      await page.waitForFunction(() => {
        const store = (window as typeof window & { __gameStore?: AuditStore }).__gameStore;
        return store?.getState().world.seasonState.seasonNumber === 2;
      });
      const cupWindows = await page.evaluate(() => {
        const store = (window as typeof window & { __gameStore?: AuditStore }).__gameStore;
        return store?.getState().world.seasonState.calendar.filter(window => window.type === 'continental_cup').length;
      });
      if (cupWindows !== 3) throw new Error(`${viewport.name}: expected three continental windows, got ${cupWindows}`);
      await page.goto(`${baseUrl}/cup/mainland_cup?audit=1`, { waitUntil: 'networkidle' });
      await page.getByText(/每四个赛季举办一次/).waitFor({ state: 'visible' });
      await page.getByText('大陆地区 · 8队', { exact: true }).waitFor({ state: 'visible' });
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

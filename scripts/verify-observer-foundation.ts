import { chromium, type ConsoleMessage, type Page } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const viewports = [
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
] as const;

type AuditResult = {
  fixtureId: string;
  homeGoals: number;
  awayGoals: number;
  etHomeGoals?: number;
  etAwayGoals?: number;
  penalties: boolean;
  penaltyHome?: number;
  penaltyAway?: number;
};

type AuditStore = {
  getState: () => {
    isAdvancing: boolean;
    world: {
      coins: number;
      bets: unknown[];
      rngState: number;
      godHandUsed: boolean;
      godHandHistory?: Array<{ teamId: string; type: 'boost' | 'nerf' }>;
      newsLog: Array<{ type: string }>;
      teamBases: Record<string, { name: string }>;
      seasonState: {
        currentWindowIndex: number;
        calendar: Array<{ fixtures: Array<{ id: string }>; results: AuditResult[] }>;
      };
    };
    newGame: (seed: number) => void;
    placeBet: (fixtureId: string, outcome: 'home', amount: number, odds: number) => void;
    batchAdvance: (count: number) => Promise<void>;
  };
};

function captureConsoleError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
}

function resolveOutcome(result: AuditResult): 'home' | 'draw' | 'away' {
  const home = result.homeGoals + (result.etHomeGoals ?? 0);
  const away = result.awayGoals + (result.etAwayGoals ?? 0);
  if (home > away) return 'home';
  if (away > home) return 'away';
  if (result.penalties && result.penaltyHome != null && result.penaltyAway != null) {
    return result.penaltyHome > result.penaltyAway ? 'home' : 'away';
  }
  return 'draw';
}

async function getStore(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as typeof window & { __gameStore?: unknown }).__gameStore));
}

async function assertNoOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) throw new Error(`${label}: horizontal overflow ${overflow}px`);
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const verification: unknown[] = [];
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch,
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('console', message => captureConsoleError(message, errors));
      page.on('pageerror', error => errors.push(error.message));

      await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
      await getStore(page);
      const settlement = await page.evaluate(async () => {
        const store = (window as typeof window & { __gameStore?: AuditStore }).__gameStore;
        if (!store) throw new Error('Audit store unavailable');
        store.getState().newGame(20260722);
        const state = store.getState();
        const fixtureId = state.world.seasonState.calendar[0].fixtures[0].id;
        store.getState().placeBet(fixtureId, 'home', 50, 2);
        await store.getState().batchAdvance(2);
        const updated = store.getState().world;
        const result = updated.seasonState.calendar[0].results.find(entry => entry.fixtureId === fixtureId);
        if (!result) throw new Error('First fixture result missing after batch advance');
        return { fixtureId, result, coins: updated.coins, pendingBets: updated.bets.length };
      });
      const expectedCoins = resolveOutcome(settlement.result) === 'home' ? 1050 : 950;
      if (settlement.coins !== expectedCoins || settlement.pendingBets !== 0) {
        throw new Error(`${viewport.name}: invalid batch settlement ${JSON.stringify(settlement)}`);
      }

      await page.evaluate(() => {
        const store = (window as typeof window & { __gameStore?: AuditStore }).__gameStore;
        if (!store) throw new Error('Audit store unavailable');
        store.getState().newGame(20260722);
      });
      await page.waitForTimeout(800);
      await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
      await getStore(page);
      await page.getByTestId('dashboard').waitFor({ state: 'visible' });
      await page.getByRole('button', { name: '总览', exact: true }).click();
      const experimentButton = page.getByRole('button', { name: /命运实验/ });
      await experimentButton.scrollIntoViewIfNeeded();
      await experimentButton.click();
      await page.getByText(/可选的永久干预/).waitFor({ state: 'visible' });
      const panel = page.getByTestId('god-hand-panel');
      await panel.locator('select').selectOption({ index: 1 });
      await page.screenshot({
        path: `/tmp/football-observer-foundation-${viewport.name}-confirm.png`,
        animations: 'disabled',
        fullPage: true,
      });
      await panel.getByRole('button', { name: '确认干预', exact: true }).click();
      const intervention = await page.evaluate(() => {
        const store = (window as typeof window & { __gameStore?: AuditStore }).__gameStore;
        if (!store) throw new Error('Audit store unavailable');
        const world = store.getState().world;
        return {
          used: world.godHandUsed,
          history: world.godHandHistory ?? [],
          latestNewsType: world.newsLog.at(-1)?.type,
        };
      });
      if (!intervention.used || intervention.history.length !== 1 || intervention.latestNewsType !== 'intervention') {
        throw new Error(`${viewport.name}: intervention was not recorded ${JSON.stringify(intervention)}`);
      }

      await page.goto(`${baseUrl}/history?audit=1`, { waitUntil: 'networkidle' });
      await page.getByTestId('intervention-history').waitFor({ state: 'visible' });
      await page.getByText('命运干预档案', { exact: true }).waitFor({ state: 'visible' });
      await page.getByText('获得祝福', { exact: true }).waitFor({ state: 'visible' });
      await assertNoOverflow(page, `${viewport.name} intervention history`);
      await page.screenshot({
        path: `/tmp/football-observer-foundation-${viewport.name}-history.png`,
        animations: 'disabled',
        fullPage: true,
      });

      if (errors.length > 0) throw new Error(`${viewport.name}: runtime errors ${errors.join(' | ')}`);
      verification.push({
        viewport: `${viewport.width}x${viewport.height}`,
        settlement: { actual: resolveOutcome(settlement.result), coins: settlement.coins },
        interventionCount: intervention.history.length,
      });
      await context.close();
    }
    console.log(JSON.stringify({ passed: true, verification }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

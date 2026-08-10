import { chromium, type ConsoleMessage } from 'playwright';
import { FREE_MARKET_TEAM_ID } from '../src/engine/transfers/transfer-application';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const viewports = [
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
] as const;

type AuditStore = {
  getState: () => {
    world: {
      teamBases: Record<string, unknown>;
      seasonState: { seasonNumber: number; currentWindowIndex: number };
      transferHistory: Array<{ fromTeamId: string; toTeamId: string }>;
      transferWindow?: { status: string } | null;
    };
    lastWorldResponse: {
      id: string;
      mode: string;
      advancedWindows: number;
      seasonChanged: boolean;
      nextSeason: number;
    } | null;
    newGame: (seed: number) => Promise<void>;
    setFavoriteTeams: (ids: string[]) => void;
    advanceWindow: () => Promise<boolean>;
    batchAdvance: (count: number) => Promise<boolean>;
    advanceUntil: (type: 'season_end') => Promise<boolean>;
    closeTransferWindow: (autoResolveRest: boolean) => void;
  };
  setState: (state: { advanceError: string | null }) => void;
};

type AuditWindow = Window & { __gameStore?: AuditStore };

function captureConsoleError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
}

async function main(): Promise<void> {
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
      page.on('console', message => captureConsoleError(message, errors));
      page.on('pageerror', error => errors.push(error.message));

      await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => Boolean((window as AuditWindow).__gameStore));
      await page.evaluate(async () => {
        const store = (window as AuditWindow).__gameStore!;
        await store.getState().newGame(20260713);
        const teamIds = Object.keys(store.getState().world.teamBases);
        store.getState().setFavoriteTeams(teamIds.slice(0, 2));
      });
      await page.getByTestId('dashboard').waitFor();

      await page.getByTestId('dashboard-advance').click();
      const response = page.getByTestId('world-response');
      await response.waitFor({ timeout: 15_000 });
      await page.getByText('本次世界回应', { exact: true }).waitFor();
      if (await page.getByTestId('full-report').count() !== 0) {
        throw new Error(`${viewport.name}: full report should start collapsed`);
      }
      const singleId = await page.evaluate(() => (
        window as AuditWindow
      ).__gameStore!.getState().lastWorldResponse?.id);
      const singleLayout = await page.evaluate(() => {
        const node = document.querySelector('[data-testid="world-response"]');
        const rect = node?.getBoundingClientRect();
        return {
          responseHeight: rect?.height ?? 0,
          responseTop: rect?.top ?? 0,
          overflow: document.documentElement.scrollWidth - innerWidth,
        };
      });
      if (singleLayout.responseHeight > viewport.height * 0.8) {
        throw new Error(`${viewport.name}: compact response is too tall ${singleLayout.responseHeight}px`);
      }
      if (singleLayout.overflow > 1) {
        throw new Error(`${viewport.name}: horizontal overflow ${singleLayout.overflow}px`);
      }
      await page.screenshot({
        path: `/tmp/football-world-response-${viewport.name}-single.png`,
        animations: 'disabled',
        fullPage: false,
      });

      await page.getByTestId('toggle-full-report').click();
      await page.getByTestId('full-report').waitFor();
      await page.getByTestId('toggle-full-report').click();
      if (await page.getByTestId('full-report').count() !== 0) {
        throw new Error(`${viewport.name}: full report did not collapse`);
      }

      await page.evaluate(() => {
        (window as AuditWindow).__gameStore!.getState().setFavoriteTeams([]);
      });
      await page.getByRole('button', { name: '打开快进菜单' }).click();
      await page.getByRole('button', { name: '推进 5 轮', exact: true }).click();
      await page.waitForFunction((previousId) => {
        const responseState = (window as AuditWindow).__gameStore?.getState().lastWorldResponse;
        return responseState?.id !== previousId && responseState?.mode === 'batch';
      }, singleId);
      await page.getByText('快速推进 5轮', { exact: false }).waitFor();
      const batchState = await page.evaluate(() => (
        window as AuditWindow
      ).__gameStore!.getState().lastWorldResponse);
      if (batchState?.advancedWindows !== 5) {
        throw new Error(`${viewport.name}: expected five advanced windows ${JSON.stringify(batchState)}`);
      }
      if (await page.getByTestId('world-response-match').count() > 3) {
        throw new Error(`${viewport.name}: response rendered too many featured matches`);
      }
      if (await page.locator('[data-testid="world-response-changes"] > *').count() > 3) {
        throw new Error(`${viewport.name}: response rendered too many changes`);
      }
      await page.screenshot({
        path: `/tmp/football-world-response-${viewport.name}-batch.png`,
        animations: 'disabled',
        fullPage: false,
      });

      await page.evaluate(() => {
        const store = (window as AuditWindow).__gameStore!;
        store.getState().setFavoriteTeams(Object.keys(store.getState().world.teamBases).slice(0, 2));
      });
      const seasonAdvanced = await page.evaluate(() => (
        window as AuditWindow
      ).__gameStore!.getState().advanceUntil('season_end'));
      if (!seasonAdvanced) throw new Error(`${viewport.name}: season-end advance did not run`);
      await page.waitForFunction(() => (
        window as AuditWindow
      ).__gameStore?.getState().lastWorldResponse?.mode === 'season_end');
      if (new URL(page.url()).pathname !== '/') {
        throw new Error(`${viewport.name}: season response was redirected away from Dashboard`);
      }
      const beforeRollover = await page.evaluate(() => {
        const world = (window as AuditWindow).__gameStore!.getState().world;
        return {
          seasonNumber: world.seasonState.seasonNumber,
          currentWindowIndex: world.seasonState.currentWindowIndex,
        };
      });
      const rolloverAdvanced = await page.evaluate(() => (
        window as AuditWindow
      ).__gameStore!.getState().batchAdvance(10));
      if (!rolloverAdvanced) throw new Error(`${viewport.name}: season rollover did not run`);
      await page.waitForFunction(() => (
        window as AuditWindow
      ).__gameStore?.getState().lastWorldResponse?.seasonChanged === true);
      const afterRollover = await page.evaluate(() => {
        const state = (window as AuditWindow).__gameStore!.getState();
        return {
          seasonNumber: state.world.seasonState.seasonNumber,
          currentWindowIndex: state.world.seasonState.currentWindowIndex,
          response: state.lastWorldResponse,
        };
      });
      if (
        afterRollover.seasonNumber !== beforeRollover.seasonNumber + 1
        || afterRollover.currentWindowIndex !== 0
        || afterRollover.response?.advancedWindows !== 1
      ) {
        throw new Error(`${viewport.name}: fixed batch crossed the season boundary ${JSON.stringify({ beforeRollover, afterRollover })}`);
      }
      await page.getByTestId('season-boundary-summary').waitFor();
      const seasonBoundaryScreenshot = `/tmp/football-world-response-${viewport.name}-season-boundary.png`;
      await page.screenshot({ path: seasonBoundaryScreenshot, animations: 'disabled', fullPage: false });
      await page.getByTestId('open-season-review').click();
      await page.getByTestId('season-champion-hero').waitFor();
      const transferWindowOpen = await page.evaluate(() => (
        window as AuditWindow
      ).__gameStore!.getState().world.transferWindow?.status === 'open');
      if (transferWindowOpen) {
        await page.getByText(/第\d+赛季转会窗口/).waitFor();
        await page.evaluate(() => (
          window as AuditWindow
        ).__gameStore!.getState().closeTransferWindow(false));
      }

      const freeMarketMoves = await page.evaluate((freeMarketId) => (
        window as AuditWindow
      ).__gameStore!.getState().world.transferHistory.filter(record => (
        record.fromTeamId === freeMarketId || record.toTeamId === freeMarketId
      )).length, FREE_MARKET_TEAM_ID);
      if (freeMarketMoves === 0) throw new Error(`${viewport.name}: deterministic season produced no free-market move`);
      await page.goto(`${baseUrl}/transfers?audit=1`, { waitUntil: 'networkidle' });
      if (await page.getByTestId('free-market-endpoint').count() < freeMarketMoves) {
        throw new Error(`${viewport.name}: free-market records did not render as endpoints`);
      }
      if (await page.locator(`a[href*="${FREE_MARKET_TEAM_ID}"]`).count() !== 0) {
        throw new Error(`${viewport.name}: free market still renders as a team link`);
      }
      const transferScreenshot = `/tmp/football-world-response-${viewport.name}-transfers.png`;
      await page.screenshot({ path: transferScreenshot, animations: 'disabled', fullPage: false });

      await page.goto(`${baseUrl}/teams?audit=1`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: '推进', exact: true }).click();
      await page.waitForURL(url => url.pathname === '/');
      await page.getByTestId('world-response').waitFor();

      await page.evaluate(() => {
        (window as AuditWindow).__gameStore!.setState({ advanceError: '本次推进没有完成：验证错误反馈' });
      });
      const errorAlert = page.getByRole('alert');
      await errorAlert.getByText(/验证错误反馈/).waitFor();
      await errorAlert.getByRole('button', { name: '关闭推进错误提示' }).click();
      await errorAlert.waitFor({ state: 'detached' });

      if (errors.length > 0) throw new Error(`${viewport.name}: runtime errors ${errors.join(' | ')}`);
      reports.push({
        viewport: `${viewport.width}x${viewport.height}`,
        singleLayout,
        batchState: batchState ? {
          id: batchState.id,
          mode: batchState.mode,
          advancedWindows: batchState.advancedWindows,
        } : null,
        seasonBoundary: afterRollover,
        transferWindowOpen,
        freeMarketMoves,
        featuredMatches: await page.getByTestId('world-response-match').count(),
        runtimeErrors: errors.length,
        seasonBoundaryScreenshot,
        transferScreenshot,
      });
      await context.close();
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ passed: true, reports }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

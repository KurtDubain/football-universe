import { chromium, type ConsoleMessage } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const viewports = [
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
] as const;

type AuditStore = {
  getState: () => {
    world: { teamBases: Record<string, unknown> };
    lastWorldResponse: { id: string; mode: string; advancedWindows: number } | null;
    newGame: (seed: number) => void;
    setFavoriteTeams: (ids: string[]) => void;
    advanceWindow: () => Promise<boolean>;
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
      await page.evaluate(() => {
        const store = (window as AuditWindow).__gameStore!;
        store.getState().newGame(20260713);
        const teamIds = Object.keys(store.getState().world.teamBases);
        store.getState().setFavoriteTeams(teamIds.slice(0, 2));
      });
      await page.getByTestId('dashboard').waitFor();

      await page.getByRole('button', { name: '开始模拟', exact: true }).click();
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

      await page.getByRole('button', { name: '打开快进菜单' }).click();
      await page.getByRole('button', { name: '快进 5 步', exact: true }).click();
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
      const rolloverAdvanced = await page.evaluate(() => (
        window as AuditWindow
      ).__gameStore!.getState().advanceWindow());
      if (!rolloverAdvanced) throw new Error(`${viewport.name}: season rollover did not run`);
      await page.getByRole('link', { name: '处理转会窗口' }).waitFor();
      await page.evaluate(() => (
        window as AuditWindow
      ).__gameStore!.getState().closeTransferWindow(false));

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
        featuredMatches: await page.getByTestId('world-response-match').count(),
        runtimeErrors: errors.length,
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

import { chromium, type ConsoleMessage } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const viewports = [
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
] as const;

type AuditState = {
  world: {
    honorHistory: Array<{ seasonNumber: number }>;
    playerStatsHistory: Record<string, Array<{ season: number }>>;
    seasonState: {
      seasonNumber: number;
      currentWindowIndex: number;
      calendar: Array<{ completed: boolean }>;
    };
    teamBases: Record<string, unknown>;
  };
  advanceTick: number;
  isAdvancing: boolean;
  lastWorldResponse: {
    mode: string;
    advancedWindows: number;
    seasonChanged: boolean;
  } | null;
  newGame: (seed: number) => Promise<void>;
  setFavoriteTeams: (ids: string[]) => void;
};

type AuditWindow = Window & {
  __gameStore?: {
    getState: () => AuditState;
  };
};

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
        await store.getState().newGame(20260717);
        const teamIds = Object.keys(store.getState().world.teamBases);
        store.getState().setFavoriteTeams(teamIds.slice(0, 2));
      });
      await page.getByTestId('dashboard').waitFor();

      const fixtureToggles = page.getByTestId('fixture-group-toggle');
      const fixtureGroupCount = await fixtureToggles.count();
      if (fixtureGroupCount < 2) {
        throw new Error(`${viewport.name}: expected multiple fixture groups, got ${fixtureGroupCount}`);
      }
      const initialExpandedGroups = await page.getByTestId('fixture-group-content').count();
      if (initialExpandedGroups !== 1) {
        throw new Error(`${viewport.name}: expected one initially expanded fixture group, got ${initialExpandedGroups}`);
      }
      const collapsedToggle = page.locator('[data-testid="fixture-group-toggle"][aria-expanded="false"]').first();
      await collapsedToggle.click();
      if (await page.getByTestId('fixture-group-content').count() !== 2) {
        throw new Error(`${viewport.name}: expanding a second fixture group did not mount its content`);
      }
      await page.screenshot({
        path: `/tmp/football-season-flow-${viewport.name}-fixtures.png`,
        animations: 'disabled',
      });

      await page.goto(`${baseUrl}/league/1?audit=1`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => Boolean((window as AuditWindow).__gameStore));
      await page.getByRole('button', { name: '打开快进菜单' }).click();
      const menu = page.getByTestId('advance-menu');
      const stayToggle = page.getByTestId('stay-on-current-view-toggle');
      await stayToggle.check();
      if (!(await stayToggle.isChecked())) {
        throw new Error(`${viewport.name}: stay-on-current-view toggle did not turn on`);
      }
      const menuLayout = await menu.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
          horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
        };
      });
      if (menuLayout.left < 0 || menuLayout.right > menuLayout.viewportWidth + 1) {
        throw new Error(`${viewport.name}: advance menu escaped viewport ${JSON.stringify(menuLayout)}`);
      }
      if (menuLayout.height > menuLayout.viewportHeight || menuLayout.horizontalOverflow > 1) {
        throw new Error(`${viewport.name}: advance menu overflow ${JSON.stringify(menuLayout)}`);
      }
      await page.getByRole('button', { name: '打开快进菜单' }).click();

      const beforeStayAdvance = await page.evaluate(() => {
        const state = (window as AuditWindow).__gameStore!.getState();
        return { tick: state.advanceTick, index: state.world.seasonState.currentWindowIndex };
      });
      await page.getByTestId('header-advance').click();
      await page.waitForFunction((tick) => {
        const state = (window as AuditWindow).__gameStore?.getState();
        return Boolean(state && !state.isAdvancing && state.advanceTick > tick);
      }, beforeStayAdvance.tick);
      if (new URL(page.url()).pathname !== '/league/1') {
        throw new Error(`${viewport.name}: enabled stay preference navigated away from league`);
      }

      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForFunction(() => Boolean((window as AuditWindow).__gameStore));
      await page.getByRole('button', { name: '打开快进菜单' }).click();
      if (!(await page.getByTestId('stay-on-current-view-toggle').isChecked())) {
        throw new Error(`${viewport.name}: stay preference did not persist across reload`);
      }
      await page.getByTestId('skip-current-season').click();
      const confirmation = page.getByTestId('skip-season-confirmation');
      await confirmation.waitFor();
      await confirmation.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `/tmp/football-season-flow-${viewport.name}-skip-confirmation.png`,
        animations: 'disabled',
      });

      const startingSeason = await page.evaluate(() => (
        (window as AuditWindow).__gameStore!.getState().world.seasonState.seasonNumber
      ));
      await page.getByTestId('confirm-skip-current-season').click();
      await page.waitForFunction((season) => {
        const state = (window as AuditWindow).__gameStore?.getState();
        return Boolean(
          state
          && !state.isAdvancing
          && state.world.seasonState.seasonNumber === season + 1
          && state.lastWorldResponse?.mode === 'skip_season',
        );
      }, startingSeason, { timeout: 90_000 });

      const skipped = await page.evaluate((season) => {
        const state = (window as AuditWindow).__gameStore!.getState();
        const current = state.world.seasonState.calendar[state.world.seasonState.currentWindowIndex];
        const hasPlayerHistory = Object.values(state.world.playerStatsHistory)
          .some(entries => entries.some(entry => entry.season === season));
        return {
          season: state.world.seasonState.seasonNumber,
          currentWindowIndex: state.world.seasonState.currentWindowIndex,
          currentWindowCompleted: current?.completed ?? true,
          hasHonor: state.world.honorHistory.some(entry => entry.seasonNumber === season),
          hasPlayerHistory,
          response: state.lastWorldResponse
            ? {
                mode: state.lastWorldResponse.mode,
                advancedWindows: state.lastWorldResponse.advancedWindows,
                seasonChanged: state.lastWorldResponse.seasonChanged,
              }
            : null,
        };
      }, startingSeason);
      if (
        skipped.currentWindowIndex !== 0
        || skipped.currentWindowCompleted
        || !skipped.hasHonor
        || !skipped.hasPlayerHistory
        || !skipped.response?.seasonChanged
        || skipped.response.advancedWindows <= 0
      ) {
        throw new Error(`${viewport.name}: incomplete season skip ${JSON.stringify(skipped)}`);
      }
      if (new URL(page.url()).pathname !== '/league/1') {
        throw new Error(`${viewport.name}: season skip ignored enabled stay preference`);
      }

      await page.getByRole('button', { name: '打开快进菜单' }).click();
      await page.getByTestId('stay-on-current-view-toggle').uncheck();
      await page.getByRole('button', { name: '打开快进菜单' }).click();
      const tickBeforeReturn = await page.evaluate(() => (
        (window as AuditWindow).__gameStore!.getState().advanceTick
      ));
      await page.getByTestId('header-advance').click();
      await page.waitForFunction((tick) => {
        const state = (window as AuditWindow).__gameStore?.getState();
        return Boolean(state && !state.isAdvancing && state.advanceTick > tick && location.pathname === '/');
      }, tickBeforeReturn);
      await page.getByTestId('dashboard').waitFor();
      const selectedTab = (await page.locator('[role="tab"][aria-selected="true"]').first().textContent()) ?? '';
      if (!selectedTab.includes('战报')) {
        throw new Error(`${viewport.name}: disabled stay preference did not return to latest report`);
      }

      await page.getByRole('tab', { name: '比赛日' }).click();
      await page.getByRole('button', { name: '打开快进菜单' }).click();
      const dashboardStayToggle = page.getByTestId('stay-on-current-view-toggle');
      await dashboardStayToggle.check();
      await dashboardStayToggle.uncheck();
      await page.getByRole('button', { name: '打开快进菜单' }).click();
      await page.waitForTimeout(50);
      const tabAfterPreferenceOnly = (
        await page.locator('[role="tab"][aria-selected="true"]').first().textContent()
      ) ?? '';
      if (!tabAfterPreferenceOnly.includes('比赛日')) {
        throw new Error(`${viewport.name}: changing advance preference replayed an old advance`);
      }

      if (errors.length > 0) {
        throw new Error(`${viewport.name}: runtime errors ${errors.join(' | ')}`);
      }
      reports.push({
        viewport: `${viewport.width}x${viewport.height}`,
        fixtureGroupCount,
        initialExpandedGroups,
        stayAdvance: {
          fromWindow: beforeStayAdvance.index,
          route: '/league/1',
          persisted: true,
        },
        seasonSkip: skipped,
        returnTab: selectedTab.trim(),
        preferenceToggleStableTab: tabAfterPreferenceOnly.trim(),
        menuLayout,
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

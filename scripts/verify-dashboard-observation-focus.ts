import { chromium, type ConsoleMessage } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const viewports = [
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
] as const;

type AuditState = {
  world: {
    teamBases: Record<string, unknown>;
    observationRecord?: { total: number };
    seasonState: { currentWindowIndex: number };
  };
  newGame: (seed: number) => void;
  setFavoriteTeams: (ids: string[]) => void;
  setObservationThemePreference: (preference: 'dark_horse_challenge') => void;
};

type AuditWindow = Window & {
  __gameStore?: { getState: () => AuditState };
};

function captureError(message: ConsoleMessage, errors: string[]): void {
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
      page.on('console', message => captureError(message, errors));
      page.on('pageerror', error => errors.push(error.message));

      await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => Boolean((window as AuditWindow).__gameStore));
      const initial = await page.evaluate(() => {
        const store = (window as AuditWindow).__gameStore;
        if (!store) throw new Error('Audit store unavailable');
        store.getState().newGame(20260718);
        const ids = Object.keys(store.getState().world.teamBases).slice(0, 3);
        store.getState().setFavoriteTeams(ids);
        store.getState().setObservationThemePreference('dark_horse_challenge');
        return {
          favorites: ids,
          windowIndex: store.getState().world.seasonState.currentWindowIndex,
        };
      });

      const runway = page.getByTestId('observation-runway');
      await runway.waitFor({ state: 'visible' });
      const focus = runway.getByTestId('focus-matches');
      const judgment = runway.getByRole('button', { name: /做出本轮观察判断/ });
      const advance = runway.getByRole('button', { name: '开始模拟', exact: true });
      const secondaryFocus = focus.locator('[data-secondary="true"]');
      await focus.getByText(/关键球员/).first().waitFor();
      const collapsedLayout = await page.evaluate(() => {
        const runwayElement = document.querySelector<HTMLElement>('[data-testid="observation-runway"]');
        const themeElement = runwayElement?.querySelector<HTMLElement>('[data-testid="observation-theme"]');
        const focusElement = runwayElement?.querySelector<HTMLElement>('[data-testid="focus-matches"]');
        const judgmentElement = runwayElement?.querySelector<HTMLElement>('[aria-label^="做出本轮观察判断"]');
        const advanceElement = runwayElement?.querySelector<HTMLElement>('[data-testid="dashboard-advance"]');
        const secondaryElement = focusElement?.querySelector<HTMLElement>('[data-secondary="true"]');
        const themeRect = themeElement?.getBoundingClientRect();
        const focusRect = focusElement?.getBoundingClientRect();
        const judgmentRect = judgmentElement?.getBoundingClientRect();
        const advanceRect = advanceElement?.getBoundingClientRect();
        const secondaryRect = secondaryElement?.getBoundingClientRect();
        return {
          primaryActions: document.querySelectorAll('[aria-label="开始模拟"]').length,
          runwayContainsAll: Boolean(
            runwayElement
            && themeElement
            && focusElement
            && judgmentElement
            && advanceElement
          ),
          themeTop: themeRect?.top ?? Number.POSITIVE_INFINITY,
          focusTop: focusRect?.top ?? Number.POSITIVE_INFINITY,
          judgmentTop: judgmentRect?.top ?? Number.POSITIVE_INFINITY,
          advanceTop: advanceRect?.top ?? Number.POSITIVE_INFINITY,
          advanceBottom: advanceRect?.bottom ?? Number.POSITIVE_INFINITY,
          judgmentHeight: judgmentRect?.height ?? 0,
          advanceHeight: advanceRect?.height ?? 0,
          secondaryHeight: secondaryRect?.height ?? 0,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      if (!collapsedLayout.runwayContainsAll || collapsedLayout.primaryActions !== 1) {
        throw new Error(`${viewport.name}: observation controls are not unified ${JSON.stringify(collapsedLayout)}`);
      }
      if (
        collapsedLayout.themeTop >= collapsedLayout.focusTop
        || collapsedLayout.focusTop >= collapsedLayout.judgmentTop
        || Math.abs(collapsedLayout.judgmentTop - collapsedLayout.advanceTop) > 1
      ) {
        throw new Error(`${viewport.name}: invalid observation sequence ${JSON.stringify(collapsedLayout)}`);
      }
      if (collapsedLayout.judgmentHeight < 44 || collapsedLayout.advanceHeight < 44) {
        throw new Error(`${viewport.name}: undersized observation action ${JSON.stringify(collapsedLayout)}`);
      }
      if (viewport.isMobile && collapsedLayout.advanceBottom > viewport.height + 1) {
        throw new Error(`${viewport.name}: primary action is below the first viewport ${collapsedLayout.advanceBottom}`);
      }
      if (viewport.isMobile && collapsedLayout.secondaryHeight > 48) {
        throw new Error(`${viewport.name}: secondary focus did not compact ${collapsedLayout.secondaryHeight}`);
      }
      if (!viewport.isMobile && collapsedLayout.secondaryHeight < 60) {
        throw new Error(`${viewport.name}: desktop secondary focus lost its full context`);
      }
      if (collapsedLayout.overflow > 1) {
        throw new Error(`${viewport.name}: horizontal overflow ${collapsedLayout.overflow}px`);
      }

      await page.screenshot({
        path: `/tmp/football-dashboard-focus-${viewport.name}-collapsed.png`,
        animations: 'disabled',
      });

      await secondaryFocus.click();
      await page.getByRole('dialog').waitFor();
      await page.getByRole('button', { name: '关闭比赛详情' }).click();

      await judgment.click();
      const expandedPanel = runway.getByTestId('observation-panel');
      await expandedPanel.waitFor();
      if (await page.getByRole('button', { name: '开始模拟', exact: true }).count() !== 1) {
        throw new Error(`${viewport.name}: expanding judgment duplicated the advance action`);
      }
      await expandedPanel.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `/tmp/football-dashboard-focus-${viewport.name}-judgment.png`,
        animations: 'disabled',
      });
      await runway.getByRole('button', { name: /主胜/ }).click();
      await runway.getByRole('button', { name: /本轮已判断：主胜/ }).waitFor();

      await advance.click();
      await page.getByTestId('world-response').waitFor({ timeout: 15_000 });
      await page.getByTestId('observation-settlement').waitFor({ timeout: 15_000 });
      const resultsNextAction = page.getByTestId('results-next-action');
      await resultsNextAction.waitFor();
      if (
        await page.getByRole('button', { name: '开始模拟', exact: true }).count() !== 1
        || (await resultsNextAction.getByRole('button', { name: '开始模拟', exact: true }).boundingBox())?.height !== 44
      ) {
        throw new Error(`${viewport.name}: results did not preserve one 44px continuation action`);
      }
      await page.screenshot({
        path: `/tmp/football-dashboard-focus-${viewport.name}-results.png`,
        animations: 'disabled',
      });
      const settled = await page.evaluate(() => {
        const state = (window as AuditWindow).__gameStore?.getState();
        if (!state) throw new Error('Audit store unavailable after advance');
        return {
          windowIndex: state.world.seasonState.currentWindowIndex,
          judgments: state.world.observationRecord?.total ?? 0,
        };
      });
      if (settled.windowIndex !== initial.windowIndex + 1 || settled.judgments !== 1) {
        throw new Error(`${viewport.name}: unified advance did not settle one window ${JSON.stringify(settled)}`);
      }
      if (errors.length > 0) throw new Error(`${viewport.name}: runtime errors ${errors.join(' | ')}`);

      reports.push({
        viewport: `${viewport.width}x${viewport.height}`,
        favorites: initial.favorites,
        collapsedLayout,
        settled,
        runtimeErrors: errors.length,
      });
      await context.close();
    }
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({ passed: true, reports }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

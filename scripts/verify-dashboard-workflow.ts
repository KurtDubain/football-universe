import { chromium, type ConsoleMessage } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');

const viewports = [
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
] as const;

function captureConsoleError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
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
      page.on('console', message => captureConsoleError(message, errors));
      page.on('pageerror', error => errors.push(error.message));

      await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => Boolean((window as typeof window & { __gameStore?: unknown }).__gameStore));
      const favorites = await page.evaluate(() => {
        type AuditState = {
          world: { teamBases: Record<string, unknown> };
          newGame: (seed: number) => void;
          setFavoriteTeams: (ids: string[]) => void;
        };
        const store = (window as typeof window & {
          __gameStore?: { getState: () => AuditState };
        }).__gameStore;
        if (!store) throw new Error('Audit store unavailable');
        store.getState().newGame(20260718);
        const ids = Object.keys(store.getState().world.teamBases).slice(0, 3);
        store.getState().setFavoriteTeams(ids);
        return ids;
      });

      await page.getByTestId('dashboard').waitFor({ state: 'visible' });
      await page.getByTestId('focus-matches').waitFor({ state: 'visible' });
      const primaryAdvance = page.getByRole('button', { name: '开始模拟', exact: true });
      const primaryCount = await primaryAdvance.count();
      const hierarchy = await page.evaluate(() => {
        const favorite = document.querySelector('[data-testid="favorite-team-summaries"]');
        const focus = document.querySelector('[data-testid="focus-matches"]');
        const matchdayTab = [...document.querySelectorAll('button')]
          .find(button => button.textContent?.trim() === '比赛日');
        return {
          favoriteTop: favorite?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
          tabsTop: matchdayTab?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
          focusTop: focus?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
          focusInFirstViewport: (focus?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY) < innerHeight,
        };
      });
      const noticeCount = await page.locator('[data-testid="secondary-match-notices"] > div').count();

      await page.screenshot({
        path: `/tmp/football-dashboard-${viewport.name}-matchday.png`,
        animations: 'disabled',
      });
      await primaryAdvance.click();
      const favoriteHeading = page.getByText('我的球队本轮赛果');
      await favoriteHeading.waitFor({ state: 'visible', timeout: 10_000 });
      const favoriteHeadingBox = await favoriteHeading.boundingBox();
      const sequenceBox = await page.getByTestId('result-sequence').boundingBox();
      const skip = page.getByTestId('skip-result-animation');
      const skipBox = await skip.boundingBox();
      await skip.click();
      const displayedResults = await page.locator('[aria-label^="查看 "][aria-label$=" 战报"]').count();
      const expectedResults = await page.evaluate(() => {
        const store = (window as typeof window & {
          __gameStore?: { getState: () => { lastResults: unknown[] } };
        }).__gameStore;
        return store?.getState().lastResults.length ?? 0;
      });
      await page.screenshot({
        path: `/tmp/football-dashboard-${viewport.name}-results.png`,
        animations: 'disabled',
      });

      if (primaryCount !== 1) throw new Error(`${viewport.name}: found ${primaryCount} primary advance actions`);
      if (!(hierarchy.favoriteTop < hierarchy.tabsTop && hierarchy.tabsTop < hierarchy.focusTop)) {
        throw new Error(`${viewport.name}: invalid dashboard hierarchy ${JSON.stringify(hierarchy)}`);
      }
      if (viewport.isMobile && !hierarchy.focusInFirstViewport) throw new Error('mobile: focus matches are below the first viewport');
      if (noticeCount > 2) throw new Error(`${viewport.name}: found ${noticeCount} secondary notices`);
      if (!skipBox || skipBox.height < 44) throw new Error(`${viewport.name}: skip target is undersized`);
      if (!favoriteHeadingBox || !sequenceBox || favoriteHeadingBox.y >= sequenceBox.y) {
        throw new Error(`${viewport.name}: favorite results are not pinned above the sequence`);
      }
      if (displayedResults !== expectedResults) {
        throw new Error(`${viewport.name}: displayed ${displayedResults}/${expectedResults} results after skip`);
      }
      if (errors.length > 0) throw new Error(`${viewport.name}: runtime errors: ${errors.join(' | ')}`);

      results.push({
        viewport: `${viewport.width}x${viewport.height}`,
        favorites,
        primaryCount,
        hierarchy,
        noticeCount,
        skipHeight: skipBox.height,
        displayedResults,
        expectedResults,
      });
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

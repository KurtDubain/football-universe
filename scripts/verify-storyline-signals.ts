import { chromium, type ConsoleMessage } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const viewports = [
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
] as const;

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
      await page.waitForFunction(() => Boolean((window as typeof window & { __gameStore?: unknown }).__gameStore));
      await page.evaluate(async () => {
        type AuditState = {
          world: { teamBases: Record<string, { expectation: number }> };
          newGame: (seed: number) => void;
          setFavoriteTeams: (ids: string[]) => void;
          batchAdvance: (count: number) => Promise<void>;
          advanceUntil: (type: 'cup' | 'season_end') => Promise<void>;
          advanceWindow: () => Promise<void>;
        };
        const store = (window as typeof window & {
          __gameStore?: { getState: () => AuditState };
        }).__gameStore;
        if (!store) throw new Error('Audit store unavailable');
        store.getState().newGame(20260718);
        const primary = Object.entries(store.getState().world.teamBases)
          .find(([, team]) => team.expectation <= 3)?.[0];
        if (primary) store.getState().setFavoriteTeams([primary]);
        await store.getState().batchAdvance(12);
      });

      await page.getByRole('tab', { name: '比赛日' }).click();
      const signals = page.getByTestId('storyline-signals');
      await signals.waitFor({ state: 'visible', timeout: 10_000 });
      const storyRows = signals.locator('section > div.divide-y > div');
      const storyCount = await storyRows.count();
      const text = (await signals.textContent()) ?? '';
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (storyCount < 1 || storyCount > 2) throw new Error(`${viewport.name}: found ${storyCount} storyline rows`);
      if (!text.includes('下一观察：') || !text.includes('来自积分榜与历史记录')) {
        throw new Error(`${viewport.name}: storyline evidence hierarchy is incomplete`);
      }
      for (const invented of ['管理层', '球迷', '更衣室', '下课传闻']) {
        if (text.includes(invented)) throw new Error(`${viewport.name}: storyline includes unsupported copy "${invented}"`);
      }
      const relationCount = await page.getByText(/黑马试金石|危机转折战|保级关键战/).count();
      if (relationCount < 1) throw new Error(`${viewport.name}: active storyline is not connected to a focus fixture`);
      if (overflow > 1) throw new Error(`${viewport.name}: page overflows by ${overflow}px`);
      if (errors.length > 0) throw new Error(`${viewport.name}: runtime errors: ${errors.join(' | ')}`);

      await signals.scrollIntoViewIfNeeded();
      const screenshot = `/tmp/football-storyline-signals-${viewport.name}.png`;
      await page.screenshot({ path: screenshot, animations: 'disabled' });

      await page.evaluate(async () => {
        const store = (window as typeof window & {
          __gameStore?: {
            getState: () => {
              advanceUntil: (type: 'cup' | 'season_end') => Promise<void>;
              advanceWindow: () => Promise<void>;
              closeTransferWindow: (autoResolveRest: boolean) => void;
            };
          };
        }).__gameStore;
        if (!store) throw new Error('Audit store unavailable');
        await store.getState().advanceUntil('season_end');
        await store.getState().advanceWindow();
        store.getState().closeTransferWindow(true);
        window.history.pushState({}, '', '/?audit=1');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await page.getByTestId('dashboard').waitFor({ state: 'visible', timeout: 20_000 });
      const reviewTab = page.getByRole('tab', { name: /S1(?:回顾|档案)/ });
      await reviewTab.waitFor({ state: 'visible', timeout: 20_000 });
      await page.evaluate(() => {
        const button = [...document.querySelectorAll('button')]
          .find(candidate => /S1(?:回顾|档案)/.test(candidate.textContent ?? ''));
        if (!(button instanceof HTMLButtonElement)) throw new Error('Season review tab unavailable');
        button.click();
      });
      const seasonStories = page.getByTestId('season-storylines');
      await seasonStories.waitFor({ state: 'visible', timeout: 10_000 });
      const seasonStoryCount = await seasonStories.locator('div.grid > div').count();
      const seasonText = (await seasonStories.textContent()) ?? '';
      if (
        seasonStoryCount < 1
        || seasonStoryCount > 8
        || !seasonText.includes('赛季故事结局')
        || !/兑现|回落|化解|延续|保级|降级/.test(seasonText)
      ) {
        throw new Error(`${viewport.name}: season story endings are incomplete`);
      }
      const reviewOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (reviewOverflow > 1) throw new Error(`${viewport.name}: season review overflows by ${reviewOverflow}px`);
      const reviewScreenshot = `/tmp/football-storyline-review-${viewport.name}.png`;
      await seasonStories.scrollIntoViewIfNeeded();
      await page.screenshot({ path: reviewScreenshot, animations: 'disabled' });
      if (errors.length > 0) throw new Error(`${viewport.name}: runtime errors: ${errors.join(' | ')}`);

      reports.push({
        viewport: `${viewport.width}x${viewport.height}`,
        storyCount,
        text: text.replace(/\s+/g, ' ').trim(),
        relationCount,
        seasonStoryCount,
        seasonText: seasonText.replace(/\s+/g, ' ').trim(),
        overflow,
        reviewOverflow,
        screenshot,
        reviewScreenshot,
      });
      await context.close();
    }
    console.log(JSON.stringify({ passed: true, reports }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

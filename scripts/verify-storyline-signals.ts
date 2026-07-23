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

      await page.getByRole('button', { name: '比赛日' }).click();
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
      if (overflow > 1) throw new Error(`${viewport.name}: page overflows by ${overflow}px`);
      if (errors.length > 0) throw new Error(`${viewport.name}: runtime errors: ${errors.join(' | ')}`);

      await signals.scrollIntoViewIfNeeded();
      const screenshot = `/tmp/football-storyline-signals-${viewport.name}.png`;
      await page.screenshot({ path: screenshot, animations: 'disabled' });
      reports.push({
        viewport: `${viewport.width}x${viewport.height}`,
        storyCount,
        text: text.replace(/\s+/g, ' ').trim(),
        overflow,
        screenshot,
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

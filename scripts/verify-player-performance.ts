import { chromium, type ConsoleMessage, type Page } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const seed = 20260808;
const viewports = [
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
] as const;

function captureConsoleError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
}

async function initializeSeason(page: Page): Promise<void> {
  await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean((window as typeof window & { __gameStore?: unknown }).__gameStore));
  await page.evaluate((gameSeed) => {
    type AuditState = {
      newGame: (seed: number) => void;
      advanceWindow: () => Promise<void>;
      isAdvancing: boolean;
    };
    const store = (window as typeof window & { __gameStore?: { getState: () => AuditState } }).__gameStore;
    if (!store) throw new Error('Audit store unavailable');
    store.getState().newGame(gameSeed);
  }, seed);

  for (let index = 0; index < 12; index++) {
    await page.evaluate(async () => {
      type AuditState = { advanceWindow: () => Promise<void> };
      const store = (window as typeof window & { __gameStore?: { getState: () => AuditState } }).__gameStore;
      if (!store) throw new Error('Audit store unavailable while advancing');
      await store.getState().advanceWindow();
    });
  }
}

async function bodyOverflow(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
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

      await initializeSeason(page);
      await page.goto(`${baseUrl}/players?audit=1`, { waitUntil: 'networkidle' });

      const overallTab = page.getByRole('tab', { name: '综合榜', exact: true });
      await overallTab.waitFor({ state: 'visible' });
      if (await overallTab.getAttribute('aria-selected') !== 'true') {
        throw new Error(`${viewport.name}: 综合榜不是默认榜单`);
      }

      const rows = page.getByTestId('player-directory-row');
      const rowCount = await rows.count();
      if (rowCount < 20) throw new Error(`${viewport.name}: 综合榜仅有 ${rowCount} 行`);

      const firstRow = rows.first();
      const firstRowText = (await firstRow.textContent()) ?? '';
      if (!/\d+\.\d/.test(firstRowText) || !/高可信|中可信|低可信/.test(firstRowText)) {
        throw new Error(`${viewport.name}: 综合榜首行缺少评分或可信度`);
      }

      const listOverflow = await bodyOverflow(page);
      if (listOverflow > 1) throw new Error(`${viewport.name}: 综合榜横向溢出 ${listOverflow}px`);
      const listScreenshot = `/tmp/football-player-overall-${viewport.name}.png`;
      await page.screenshot({ path: listScreenshot, animations: 'disabled', fullPage: false });

      await Promise.all([
        page.waitForURL(url => url.pathname.startsWith('/player/')),
        firstRow.press('Enter'),
      ]);
      await page.getByText('赛季综合评分', { exact: true }).waitFor({ state: 'visible' });
      await page.getByText('位置表现', { exact: true }).waitFor({ state: 'visible' });
      await page.getByText('出勤可靠性', { exact: true }).waitFor({ state: 'visible' });
      await page.getByText(/综合第\d+\/\d+/).waitFor({ state: 'visible' });

      const detailText = (await page.locator('body').textContent()) ?? '';
      for (const label of ['出场', '分钟', '赛事强度', '基础能力']) {
        if (!detailText.includes(label)) throw new Error(`${viewport.name}: 球员详情缺少 ${label}`);
      }
      const detailOverflow = await bodyOverflow(page);
      if (detailOverflow > 1) throw new Error(`${viewport.name}: 球员详情横向溢出 ${detailOverflow}px`);
      if (errors.length > 0) throw new Error(`${viewport.name}: 运行错误: ${errors.join(' | ')}`);

      const detailScreenshot = `/tmp/football-player-score-${viewport.name}.png`;
      await page.screenshot({ path: detailScreenshot, animations: 'disabled', fullPage: false });
      results.push({
        viewport: `${viewport.width}x${viewport.height}`,
        rowCount,
        listOverflow,
        detailOverflow,
        listScreenshot,
        detailScreenshot,
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

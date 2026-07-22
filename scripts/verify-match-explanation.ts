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
      await page.evaluate(() => {
        const store = (window as typeof window & {
          __gameStore?: { getState: () => { newGame: (seed: number) => void } };
        }).__gameStore;
        store?.getState().newGame(20260718);
      });
      await page.getByTestId('focus-matches').waitFor({ state: 'visible' });
      await page.locator('[data-testid="focus-matches"] > div [role="button"]').first().click();

      const preDialog = page.getByRole('dialog', { name: '赛前预测' });
      await preDialog.waitFor({ state: 'visible' });
      const factors = preDialog.getByTestId('match-factors');
      await factors.waitFor({ state: 'visible' });
      const factorRows = await factors.locator(':scope > div.divide-y > div').count();
      const preOverflow = await preDialog.evaluate(element => element.scrollWidth - element.clientWidth);
      await page.screenshot({
        path: `/tmp/football-match-explanation-${viewport.name}-pre.png`,
        animations: 'disabled',
      });
      if (factorRows < 1 || factorRows > 3) throw new Error(`${viewport.name}: found ${factorRows} public factors`);
      if (preOverflow > 1) throw new Error(`${viewport.name}: pre-match dialog overflows by ${preOverflow}px`);
      await preDialog.getByRole('button', { name: '关闭比赛详情' }).click();

      await page.getByRole('button', { name: '开始模拟', exact: true }).click();
      const skip = page.getByTestId('skip-result-animation');
      await skip.waitFor({ state: 'visible', timeout: 10_000 });
      await skip.click();
      const resultButton = page.locator('button[aria-label^="查看 "][aria-label$=" 战报"]').first();
      await resultButton.click();

      const postDialog = page.getByRole('dialog', { name: '比赛详情' });
      await postDialog.waitFor({ state: 'visible' });
      const deviation = postDialog.getByTestId('destiny-deviation');
      const turningPoints = postDialog.getByTestId('turning-points');
      await deviation.waitFor({ state: 'visible' });
      await turningPoints.waitFor({ state: 'visible' });
      const postOverflow = await postDialog.evaluate(element => element.scrollWidth - element.clientWidth);
      const closeSize = await postDialog.getByRole('button', { name: '关闭比赛详情' }).evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      await page.screenshot({
        path: `/tmp/football-match-explanation-${viewport.name}-post.png`,
        animations: 'disabled',
      });

      if (postOverflow > 1) throw new Error(`${viewport.name}: post-match dialog overflows by ${postOverflow}px`);
      if (closeSize.width < 44 || closeSize.height < 44) throw new Error(`${viewport.name}: close target is undersized`);
      if (errors.length > 0) throw new Error(`${viewport.name}: runtime errors: ${errors.join(' | ')}`);
      reports.push({
        viewport: `${viewport.width}x${viewport.height}`,
        factorRows,
        preOverflow,
        postOverflow,
        closeSize,
        deviation: (await deviation.textContent())?.trim(),
        turningPoints: (await turningPoints.textContent())?.trim(),
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

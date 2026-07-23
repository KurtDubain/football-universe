import { chromium, type ConsoleMessage } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const viewports = [
  { name: 'mobile-320', width: 320, height: 568, isMobile: true, hasTouch: true },
  { name: 'mobile-390', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'mobile-430', width: 430, height: 932, isMobile: true, hasTouch: true },
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
        localStorage.setItem('floating-btn', '1');
        localStorage.removeItem('floating-advance-position-v2');
      });
      await page.goto(`${baseUrl}/teams?audit=1`, { waitUntil: 'networkidle' });

      const button = page.getByTestId('floating-advance');
      const initial = await button.boundingBox();
      if (!initial) throw new Error(`${viewport.name}: floating button has no box`);
      const before = await page.evaluate(() => {
        const store = (window as typeof window & {
          __gameStore?: { getState: () => { world: { seasonState: { currentWindowIndex: number } } } };
        }).__gameStore;
        return store?.getState().world.seasonState.currentWindowIndex;
      });
      const bottomGap = viewport.height - initial.y - initial.height;
      if (initial.width < 48 || initial.height < 48) {
        throw new Error(`${viewport.name}: undersized floating action ${initial.width}x${initial.height}`);
      }
      if (viewport.isMobile && (initial.width > 64 || bottomGap < 120)) {
        throw new Error(`${viewport.name}: mobile default is obstructive ${JSON.stringify({ initial, bottomGap })}`);
      }

      await page.mouse.move(initial.x + initial.width / 2, initial.y + initial.height / 2);
      await page.mouse.down();
      await page.mouse.move(40, Math.round(viewport.height * 0.43), { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(80);
      const dragged = await button.boundingBox();
      const afterDrag = await page.evaluate(() => {
        const store = (window as typeof window & {
          __gameStore?: { getState: () => { world: { seasonState: { currentWindowIndex: number } } } };
        }).__gameStore;
        return store?.getState().world.seasonState.currentWindowIndex;
      });
      if (!dragged || before !== afterDrag) throw new Error(`${viewport.name}: drag triggered an advance`);
      const storedPosition = await page.evaluate(() => localStorage.getItem('floating-advance-position-v2'));
      if (!storedPosition) throw new Error(`${viewport.name}: dragged position was not stored`);

      await page.reload({ waitUntil: 'networkidle' });
      const restored = await page.getByTestId('floating-advance').boundingBox();
      if (!restored || Math.abs(restored.x - dragged.x) > 1 || Math.abs(restored.y - dragged.y) > 1) {
        throw new Error(`${viewport.name}: position did not survive reload`);
      }

      await page.getByTestId('floating-advance').click();
      await page.waitForURL(url => url.pathname === '/');
      await page.getByTestId('result-sequence').waitFor({ state: 'visible', timeout: 10_000 });
      const afterTap = await page.evaluate(() => {
        const store = (window as typeof window & {
          __gameStore?: { getState: () => { world: { seasonState: { currentWindowIndex: number } } } };
        }).__gameStore;
        return store?.getState().world.seasonState.currentWindowIndex;
      });
      if (afterTap !== before! + 1) throw new Error(`${viewport.name}: tap advanced ${afterTap! - before!} windows`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) throw new Error(`${viewport.name}: page overflows by ${overflow}px`);
      if (errors.length > 0) throw new Error(`${viewport.name}: runtime errors: ${errors.join(' | ')}`);

      const screenshot = `/tmp/football-floating-advance-${viewport.name}.png`;
      await page.screenshot({ path: screenshot, animations: 'disabled' });
      reports.push({
        viewport: `${viewport.width}x${viewport.height}`,
        initial,
        bottomGap,
        dragged,
        restored,
        before,
        afterDrag,
        afterTap,
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

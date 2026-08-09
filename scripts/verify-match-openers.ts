import { statSync } from 'node:fs';
import { chromium, type ConsoleMessage, type Page } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const variants = [
  {
    query: 'domestic',
    kind: 'domestic_cup',
    file: 'match-opener-domestic-cup-v1',
    label: '杯赛之夜 · 比分未揭晓',
  },
  {
    query: 'continental',
    kind: 'continental',
    file: 'match-opener-continental-v1',
    label: '洲际之夜 · 比分未揭晓',
  },
  {
    query: 'world',
    kind: 'world',
    file: 'match-opener-world-v1',
    label: '环球赛场 · 比分未揭晓',
  },
] as const;

function captureError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
}

async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const results: Array<Record<string, unknown>> = [];
  try {
    for (const viewport of [
      { name: 'mobile', width: 390, height: 844 },
      { name: 'desktop', width: 1440, height: 900 },
    ] as const) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.name === 'mobile',
        hasTouch: viewport.name === 'mobile',
      });
      for (const variant of variants) {
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('console', message => captureError(message, errors));
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(
          `${baseUrl}/scripts/fixtures/animation-preview.html?featured=1&competition=${variant.query}`,
          { waitUntil: 'domcontentloaded' },
        );
        const opener = page.getByTestId('key-match-opener');
        await opener.waitFor({ state: 'visible' });
        const artwork = opener.getByTestId('key-match-opener-art');
        await artwork.waitFor({ state: 'visible' });
        await page.waitForFunction(() => {
          const image = document.querySelector('[data-testid="key-match-opener-art"]') as HTMLImageElement | null;
          return Boolean(image?.complete && image.naturalWidth > 0);
        });
        await page.waitForTimeout(380);
        const metrics = await opener.evaluate((element, expectedLabel) => {
          const image = element.querySelector('[data-testid="key-match-opener-art"]') as HTMLImageElement | null;
          const skip = element.querySelector('button[aria-label="跳过转播开场"]');
          const openerRect = element.getBoundingClientRect();
          const skipRect = skip?.getBoundingClientRect();
          return {
            kind: element.getAttribute('data-opener-kind'),
            labelFound: element.textContent?.includes(expectedLabel) ?? false,
            source: image?.currentSrc ?? '',
            naturalWidth: image?.naturalWidth ?? 0,
            naturalHeight: image?.naturalHeight ?? 0,
            openerRect: openerRect.toJSON(),
            skipRect: skipRect?.toJSON(),
          };
        }, variant.label);
        if (
          metrics.kind !== variant.kind
          || !metrics.labelFound
          || !metrics.source.includes(variant.file)
          || metrics.naturalWidth !== 1440
          || metrics.naturalHeight !== 630
          || !metrics.skipRect
          || metrics.skipRect.width < 44
          || metrics.skipRect.height < 44
          || await overflow(page) > 1
          || errors.length > 0
        ) {
          throw new Error(`${viewport.name}/${variant.kind} opener failed: ${JSON.stringify({ metrics, errors })}`);
        }
        const screenshot = `/tmp/football-match-opener-${variant.kind}-${viewport.name}.png`;
        await page.screenshot({ path: screenshot, animations: 'disabled' });
        results.push({ viewport: viewport.name, ...metrics, screenshot });
        await page.close();
      }
      await context.close();
    }

    const fallbackContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await fallbackContext.route('**/*match-opener-world-v1*.webp', route => route.abort());
    const fallbackPage = await fallbackContext.newPage();
    await fallbackPage.goto(
      `${baseUrl}/scripts/fixtures/animation-preview.html?featured=1&competition=world`,
      { waitUntil: 'domcontentloaded' },
    );
    const fallbackOpener = fallbackPage.getByTestId('key-match-opener');
    await fallbackOpener.waitFor({ state: 'visible' });
    await fallbackPage.waitForTimeout(200);
    if (
      await fallbackOpener.getByTestId('key-match-opener-art').count() !== 0
      || !(await fallbackOpener.textContent())?.includes('环球赛场 · 比分未揭晓')
      || await overflow(fallbackPage) > 1
    ) {
      throw new Error('Failed opener artwork did not preserve the live text slate');
    }
    await fallbackContext.close();

    const assetBytes = Object.fromEntries(variants.map(variant => [
      variant.kind,
      statSync(`src/assets/visual/${variant.file}.webp`).size,
    ]));
    console.log(JSON.stringify({ passed: true, assetBytes, fallback: true, results }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

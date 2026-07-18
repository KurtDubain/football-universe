import { chromium, type ConsoleMessage, type Page } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');

const routes = [
  { path: '/league/1', name: 'league' },
  { path: '/teams', name: 'teams' },
  { path: '/players', name: 'players' },
  { path: '/history', name: 'history' },
  { path: '/transfers', name: 'transfers' },
] as const;

const viewports = [
  { width: 320, height: 568, label: 'mobile-compact' },
  { width: 390, height: 844, label: 'mobile' },
  { width: 1440, height: 900, label: 'desktop' },
] as const;

interface RouteMetrics {
  route: string;
  viewport: string;
  bodyOverflow: number;
  titleFontSize: number;
  minimumTabHeight: number | null;
  maximumPanelRadius: number | null;
}

function captureConsoleError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
}

async function initializeGame(page: Page): Promise<void> {
  await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean((window as typeof window & { __gameStore?: unknown }).__gameStore));
  await page.evaluate(() => {
    const store = (window as typeof window & {
      __gameStore?: { getState: () => { newGame: (seed: number) => void } };
    }).__gameStore;
    store?.getState().newGame(20260718);
  });
  await page.locator('main').waitFor({ state: 'visible' });
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  const results: RouteMetrics[] = [];

  page.on('console', message => captureConsoleError(message, errors));
  page.on('pageerror', error => errors.push(error.message));

  try {
    await initializeGame(page);

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      for (const route of routes) {
        await page.goto(`${baseUrl}${route.path}?audit=1`, { waitUntil: 'networkidle' });
        const shell = page.locator('[data-ui="page-shell"]');
        await shell.waitFor({ state: 'visible' });

        const metrics = await page.evaluate(() => {
          const title = document.querySelector<HTMLElement>('[data-ui="page-header"] h1');
          const tabs = Array.from(document.querySelectorAll<HTMLElement>('[data-ui="segmented-control"] [role="tab"]'));
          const panels = Array.from(document.querySelectorAll<HTMLElement>('[data-ui="panel"]'));
          return {
            bodyOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
            titleFontSize: title ? Number.parseFloat(getComputedStyle(title).fontSize) : 0,
            minimumTabHeight: tabs.length > 0
              ? Math.min(...tabs.map(tab => tab.getBoundingClientRect().height))
              : null,
            maximumPanelRadius: panels.length > 0
              ? Math.max(...panels.map(panel => Number.parseFloat(getComputedStyle(panel).borderRadius)))
              : null,
          };
        });

        if (metrics.bodyOverflow > 1) {
          throw new Error(`${viewport.label} ${route.path}: body overflow ${metrics.bodyOverflow}px`);
        }
        if (metrics.titleFontSize < 20) {
          throw new Error(`${viewport.label} ${route.path}: title is only ${metrics.titleFontSize}px`);
        }
        if (viewport.width < 640 && metrics.minimumTabHeight !== null && metrics.minimumTabHeight < 44) {
          throw new Error(`${viewport.label} ${route.path}: tab height ${metrics.minimumTabHeight}px`);
        }
        if (metrics.maximumPanelRadius !== null && metrics.maximumPanelRadius > 8.1) {
          throw new Error(`${viewport.label} ${route.path}: panel radius ${metrics.maximumPanelRadius}px`);
        }

        const tabs = page.locator('[data-ui="segmented-control"] [role="tab"]');
        if (await tabs.count() > 1) {
          const lastTab = tabs.last();
          await lastTab.click();
          if (await lastTab.getAttribute('aria-selected') !== 'true') {
            throw new Error(`${viewport.label} ${route.path}: selected tab state did not update`);
          }
        }

        const shouldCapture = (
          (viewport.label === 'mobile-compact' && route.name === 'history')
          || (viewport.label === 'mobile' && ['teams', 'players', 'transfers'].includes(route.name))
          || (viewport.label === 'desktop' && route.name === 'league')
        );
        if (shouldCapture) {
          await page.screenshot({
            path: `/tmp/football-ui-${viewport.label}-${route.name}.png`,
            fullPage: false,
            animations: 'disabled',
          });
        }

        results.push({ route: route.path, viewport: viewport.label, ...metrics });
      }
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/teams?audit=1`, { waitUntil: 'networkidle' });
    await page.locator('[data-ui="page-shell"]').waitFor({ state: 'visible' });
    const largeTextMetrics = await page.evaluate(() => {
      document.documentElement.style.fontSize = '20px';
      const title = document.querySelector<HTMLElement>('[data-ui="page-header"] h1');
      return new Promise<{ bodyOverflow: number; titleHeight: number }>(resolve => {
        requestAnimationFrame(() => resolve({
          bodyOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
          titleHeight: title?.getBoundingClientRect().height ?? 0,
        }));
      });
    });
    if (largeTextMetrics.bodyOverflow > 1 || largeTextMetrics.titleHeight < 24) {
      throw new Error(`large text: invalid layout ${JSON.stringify(largeTextMetrics)}`);
    }
    await page.screenshot({
      path: '/tmp/football-ui-mobile-large-text-teams.png',
      fullPage: false,
      animations: 'disabled',
    });
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });

    const rootTokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return ['--surface-page', '--surface-panel', '--surface-floating', '--action', '--competition-gold']
        .map(token => [token, style.getPropertyValue(token).trim()]);
    });
    if (rootTokens.some(([, value]) => !value)) throw new Error('One or more semantic tokens are missing');
    if (errors.length > 0) throw new Error(`Runtime errors: ${errors.join(' | ')}`);

    console.log(JSON.stringify({ results, largeTextMetrics, rootTokens, screenshots: [
      '/tmp/football-ui-mobile-compact-history.png',
      '/tmp/football-ui-mobile-teams.png',
      '/tmp/football-ui-mobile-players.png',
      '/tmp/football-ui-mobile-transfers.png',
      '/tmp/football-ui-desktop-league.png',
      '/tmp/football-ui-mobile-large-text-teams.png',
    ] }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

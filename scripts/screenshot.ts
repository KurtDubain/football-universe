import { chromium, type ConsoleMessage, type Page } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const baseUrl = (process.env.SCREENSHOT_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const outputDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots');

type ScreenshotAuditState = {
  advanceWindow: () => Promise<boolean>;
  advanceUntil: (type: 'cup' | 'season_end') => Promise<boolean>;
};

type ScreenshotAuditWindow = Window & {
  __gameStore?: { getState: () => ScreenshotAuditState };
};

function captureConsoleError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
}

async function openRoute(page: Page, route: string): Promise<void> {
  await page.goto(`${baseUrl}${route}${route.includes('?') ? '&' : '?'}audit=1`, {
    waitUntil: 'networkidle',
  });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector<HTMLElement>('main.app-route-content')?.scrollTo(0, 0);
    document.querySelector<HTMLElement>('aside nav')?.scrollTo(0, 0);
  });
}

async function capture(page: Page, fileName: string): Promise<void> {
  await page.screenshot({
    path: path.join(outputDirectory, fileName),
    type: 'jpeg',
    quality: 88,
    animations: 'disabled',
    fullPage: false,
  });
}

async function main(): Promise<void> {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', message => captureConsoleError(message, errors));
  page.on('pageerror', error => errors.push(error.message));

  try {
    await openRoute(page, '/');
    await page.getByRole('heading', { name: '开始观察' }).waitFor();
    await capture(page, '01-welcome.jpg');

    await page.getByRole('button', { name: '开始观察' }).click();
    await page.getByTestId('dashboard').waitFor();
    await capture(page, '02-dashboard-initial.jpg');

    await page.evaluate(async () => {
      const store = (window as ScreenshotAuditWindow).__gameStore;
      if (!store) throw new Error('Screenshot audit store unavailable');
      for (let index = 0; index < 10; index += 1) {
        if (!await store.getState().advanceWindow()) break;
      }
    });
    await page.getByTestId('dashboard').waitFor();
    await capture(page, '03-dashboard-midseason.jpg');

    const midSeasonRoutes: Array<[string, string]> = [
      ['/league/1', '04-league.jpg'],
      ['/cup/league_cup', '05-cup-bracket.jpg'],
      ['/cup/super_cup', '06-super-cup.jpg'],
      ['/teams', '07-teams.jpg'],
    ];
    for (const [route, fileName] of midSeasonRoutes) {
      await openRoute(page, route);
      await capture(page, fileName);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await openRoute(page, '/');
    await page.getByTestId('dashboard').waitFor();
    await capture(page, '10-mobile.jpg');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(async () => {
      const store = (window as ScreenshotAuditWindow).__gameStore;
      if (!store) throw new Error('Screenshot audit store unavailable');
      if (!await store.getState().advanceUntil('season_end')) {
        throw new Error('Could not reach the season-end screenshot state');
      }
      if (!await store.getState().advanceWindow()) {
        throw new Error('Could not finalize the screenshot season');
      }
    });
    for (const [route, fileName] of [
      ['/history', '08-history.jpg'],
      ['/chronicle', '09-chronicle.jpg'],
    ] as const) {
      await openRoute(page, route);
      await capture(page, fileName);
    }

    if (errors.length > 0) {
      throw new Error(`Screenshot run emitted runtime errors: ${errors.join(' | ')}`);
    }
    console.log(`Updated 10 documentation screenshots from ${baseUrl}`);
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

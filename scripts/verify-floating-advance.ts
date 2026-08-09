import { chromium, type ConsoleMessage } from 'playwright';
import { RECOMMENDED_EXPERIENCE_SEED } from '../src/config/observer-experience';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const viewports = [
  { name: 'mobile-320', width: 320, height: 568, isMobile: true, hasTouch: true },
  { name: 'mobile-390', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'mobile-430', width: 430, height: 932, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
] as const;

type AuditIds = {
  teamId: string;
  playerId: string;
  coachId: string;
};

function captureError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
}

async function verifyRouteCoverage(
  page: import('playwright').Page,
  viewport: (typeof viewports)[number],
  ids: AuditIds,
): Promise<string[]> {
  const paths = [
    '/',
    '/calendar',
    '/league/1',
    '/league/2',
    '/league/3',
    '/cup/league_cup',
    '/cup/super_cup',
    '/cup/world_cup',
    '/cup/mainland_cup',
    '/cup/southern_cup',
    '/cup/eastern_cup',
    '/teams',
    `/team/${ids.teamId}`,
    '/coaches',
    `/coach/${ids.coachId}`,
    '/players',
    `/player/${ids.playerId}`,
    '/history',
    '/chronicle',
    '/legends',
    '/transfers',
    '/market',
    '/memorable',
    '/search',
    '/compare',
    '/team-editor',
    '/settings',
  ];

  for (const path of paths) {
    await page.goto(`${baseUrl}${path}?audit=1`, { waitUntil: 'networkidle' });
    const floating = page.getByTestId('floating-advance');
    if (await floating.count() !== 1) {
      throw new Error(`${viewport.name} ${path}: expected one responsive floating control`);
    }

    if (viewport.isMobile) {
      if (await floating.isVisible()) {
        throw new Error(`${viewport.name} ${path}: desktop shortcut covered mobile content`);
      }
      const actualPath = new URL(page.url()).pathname;
      const mobileAction = actualPath === '/'
        ? page.getByTestId('dashboard-advance').first()
        : page.getByTestId('header-advance');
      if (!await mobileAction.isVisible()) {
        throw new Error(`${viewport.name} ${path}: mobile advance action is unavailable`);
      }
      continue;
    }

    const box = await floating.boundingBox();
    if (!box) throw new Error(`${viewport.name} ${path}: desktop floating control is not visible`);
    const contentBox = await page.locator('.app-route-content').boundingBox();
    if (!contentBox) throw new Error(`${viewport.name} ${path}: route content has no box`);
    const margin = 11;
    if (
      box.x < contentBox.x + margin
      || box.y < contentBox.y + margin
      || box.x + box.width > contentBox.x + contentBox.width - margin
      || box.y + box.height > contentBox.y + contentBox.height - margin
    ) {
      throw new Error(`${viewport.name} ${path}: desktop shortcut escaped the content area`);
    }
  }
  return paths;
}

async function currentWindowIndex(page: import('playwright').Page): Promise<number | undefined> {
  return page.evaluate(() => {
    const store = (window as typeof window & {
      __gameStore?: { getState: () => { world: { seasonState: { currentWindowIndex: number } } } };
    }).__gameStore;
    return store?.getState().world.seasonState.currentWindowIndex;
  });
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
      const ids = await page.evaluate((seed) => {
        const store = (window as typeof window & {
          __gameStore?: {
            getState: () => {
              newGame: (nextSeed: number) => void;
              world: {
                teamBases: Record<string, unknown>;
                coachBases: Record<string, unknown>;
                squads: Record<string, Array<{ uuid: string }>>;
              };
            };
          };
        }).__gameStore;
        store?.getState().newGame(seed);
        const world = store!.getState().world;
        const teamId = Object.keys(world.teamBases)[0];
        localStorage.removeItem('floating-advance-position-v2');
        localStorage.removeItem('floating-btn');
        return {
          teamId,
          playerId: world.squads[teamId][0].uuid,
          coachId: Object.keys(world.coachBases)[0],
        };
      }, RECOMMENDED_EXPERIENCE_SEED);
      await page.reload({ waitUntil: 'networkidle' });

      const before = await currentWindowIndex(page);
      const floating = page.getByTestId('floating-advance');
      let initial: Awaited<ReturnType<typeof floating.boundingBox>> = null;
      let dragged: Awaited<ReturnType<typeof floating.boundingBox>> = null;
      let restored: Awaited<ReturnType<typeof floating.boundingBox>> = null;

      if (viewport.isMobile) {
        if (await floating.isVisible()) throw new Error(`${viewport.name}: floating shortcut is visible`);
        if (!await page.getByTestId('dashboard-advance').first().isVisible()) {
          throw new Error(`${viewport.name}: Dashboard has no primary advance action`);
        }
      } else {
        initial = await floating.boundingBox();
        if (!initial || initial.width < 88 || initial.height < 44) {
          throw new Error(`${viewport.name}: desktop shortcut is missing or undersized`);
        }

        await page.evaluate(() => localStorage.setItem('floating-btn', '0'));
        await page.reload({ waitUntil: 'networkidle' });
        if (await page.getByTestId('floating-advance').count() !== 0) {
          throw new Error(`${viewport.name}: explicit hidden preference was ignored`);
        }
        await page.evaluate(() => localStorage.setItem('floating-btn', '1'));
        await page.goto(`${baseUrl}/teams?audit=1`, { waitUntil: 'networkidle' });

        const draggable = page.getByTestId('floating-advance');
        const box = await draggable.boundingBox();
        if (!box) throw new Error(`${viewport.name}: shortcut missing after re-enable`);
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(240, Math.round(viewport.height * 0.43), { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(80);
        dragged = await draggable.boundingBox();
        if (!dragged || before !== await currentWindowIndex(page)) {
          throw new Error(`${viewport.name}: drag triggered an advance`);
        }
        if (!await page.evaluate(() => localStorage.getItem('floating-advance-position-v2'))) {
          throw new Error(`${viewport.name}: dragged position was not stored`);
        }

        await page.reload({ waitUntil: 'networkidle' });
        restored = await page.getByTestId('floating-advance').boundingBox();
        if (!restored || Math.abs(restored.x - dragged.x) > 1 || Math.abs(restored.y - dragged.y) > 1) {
          throw new Error(`${viewport.name}: desktop position did not survive reload`);
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(80);
        if (await page.getByTestId('floating-advance').isVisible()) {
          throw new Error(`${viewport.name}: shortcut stayed visible below the mobile breakpoint`);
        }
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.waitForTimeout(80);
      }

      const coveredRoutes = await verifyRouteCoverage(page, viewport, ids);
      await page.goto(`${baseUrl}/teams?audit=1`, { waitUntil: 'networkidle' });
      const advanceAction = viewport.isMobile
        ? page.getByTestId('header-advance')
        : page.getByTestId('floating-advance');
      await advanceAction.click();
      await page.waitForURL(url => url.pathname === '/');
      if (viewport.isMobile && await page.getByTestId('floating-advance').isVisible()) {
        throw new Error(`${viewport.name}: shortcut reappeared after navigation`);
      }
      await page.getByTestId('toggle-full-report').click();
      await page.getByTestId('result-sequence').waitFor({ state: 'visible', timeout: 10_000 });
      const afterTap = await currentWindowIndex(page);
      if (afterTap !== before! + 1) {
        throw new Error(`${viewport.name}: advance action moved ${afterTap! - before!} windows`);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) throw new Error(`${viewport.name}: page overflows by ${overflow}px`);
      if (errors.length > 0) throw new Error(`${viewport.name}: runtime errors: ${errors.join(' | ')}`);

      const screenshot = `/tmp/football-floating-advance-${viewport.name}.png`;
      await page.screenshot({ path: screenshot, animations: 'disabled' });
      reports.push({
        viewport: `${viewport.width}x${viewport.height}`,
        mobileUsesContextAction: viewport.isMobile,
        initial,
        dragged,
        restored,
        coveredRoutes,
        before,
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

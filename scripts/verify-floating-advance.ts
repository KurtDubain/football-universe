import { chromium, type ConsoleMessage } from 'playwright';
import { RECOMMENDED_EXPERIENCE_SEED } from '../src/config/observer-experience';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const viewports = [
  { name: 'mobile-320', width: 320, height: 568, isMobile: true, hasTouch: true },
  { name: 'mobile-390', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'mobile-430', width: 430, height: 932, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
] as const;
const requestedViewport = process.env.VERIFY_VIEWPORT;

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
      throw new Error(`${viewport.name} ${path}: expected one persistent floating control`);
    }
    const box = await floating.boundingBox();
    if (!box) throw new Error(`${viewport.name} ${path}: floating control is not visible`);
    const presentation = await floating.evaluate(element => {
      const styles = getComputedStyle(element);
      return { position: styles.position, display: styles.display, zIndex: Number(styles.zIndex) };
    });
    if (presentation.position !== 'fixed' || presentation.display === 'none' || presentation.zIndex < 100) {
      throw new Error(`${viewport.name} ${path}: floating control lost overlay presentation ${JSON.stringify(presentation)}`);
    }
    const margin = 10;
    if (
      box.x < margin
      || box.y < margin
      || box.x + box.width > viewport.width - margin
      || box.y + box.height > viewport.height - margin
    ) {
      throw new Error(`${viewport.name} ${path}: floating control escaped the visual viewport`);
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
    const selectedViewports = requestedViewport
      ? viewports.filter(viewport => viewport.name === requestedViewport)
      : viewports;
    if (selectedViewports.length === 0) throw new Error(`Unknown viewport: ${requestedViewport}`);
    for (const viewport of selectedViewports) {
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
      const ids = await page.evaluate(async (seed) => {
        const store = (window as typeof window & {
          __gameStore?: {
            getState: () => {
              newGame: (nextSeed: number) => Promise<void>;
              world: {
                teamBases: Record<string, unknown>;
                coachBases: Record<string, unknown>;
                squads: Record<string, Array<{ uuid: string }>>;
              };
            };
          };
        }).__gameStore;
        await store?.getState().newGame(seed);
        const world = store!.getState().world;
        const teamId = Object.keys(world.teamBases)[0];
        localStorage.removeItem('floating-advance-position-v2');
        localStorage.setItem('floating-btn', '0');
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
      const initialPresentation = await page.evaluate(() => {
        const control = document.querySelector<HTMLElement>('[data-testid="floating-advance"]');
        const content = document.querySelector<HTMLElement>('.app-route-content');
        if (!control || !content) return null;
        const styles = getComputedStyle(control);
        return {
          position: styles.position,
          display: styles.display,
          contentPaddingBottom: Number.parseFloat(getComputedStyle(content).paddingBottom),
        };
      });
      initial = await floating.boundingBox();
      const minimumWidth = viewport.isMobile ? 44 : 88;
      if (!initial || initial.width < minimumWidth || initial.height < 44) {
        throw new Error(`${viewport.name}: persistent shortcut is missing or undersized`);
      }
      if (!initialPresentation || initialPresentation.position !== 'fixed' || initialPresentation.display === 'none') {
        throw new Error(`${viewport.name}: shortcut is not a fixed overlay`);
      }
      const expectedPadding = viewport.isMobile ? 12 : 20;
      if (Math.abs(initialPresentation.contentPaddingBottom - expectedPadding) > 1) {
        throw new Error(`${viewport.name}: route content still reserves space for the floating control`);
      }

      if (!viewport.isMobile) {
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
        const compact = await page.getByTestId('floating-advance').boundingBox();
        if (!compact || compact.width > 52 || compact.height < 44) {
          throw new Error(`${viewport.name}: shortcut disappeared or failed to compact below the mobile breakpoint`);
        }
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.waitForTimeout(80);
      }

      const coveredRoutes = await verifyRouteCoverage(page, viewport, ids);
      await page.goto(`${baseUrl}/teams?audit=1`, { waitUntil: 'networkidle' });
      const advanceAction = page.getByTestId('floating-advance');
      await advanceAction.click();
      await page.waitForURL(url => url.pathname === '/');
      if (!await page.getByTestId('floating-advance').isVisible()) {
        throw new Error(`${viewport.name}: shortcut disappeared after navigation`);
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
        persistentOverlay: true,
        initial,
        initialPresentation,
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

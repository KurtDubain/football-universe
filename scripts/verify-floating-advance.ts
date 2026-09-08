import { chromium, type ConsoleMessage } from 'playwright';
import { RECOMMENDED_EXPERIENCE_SEED } from '../src/config/observer-experience';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const viewports = [
  { name: 'mobile-320', width: 320, height: 568, isMobile: true, hasTouch: true },
  { name: 'mobile-390', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'desktop-low', width: 1280, height: 720, isMobile: false, hasTouch: false },
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

async function assertNoObstacleOverlap(
  page: import('playwright').Page,
  label: string,
): Promise<unknown> {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const layout = await page.evaluate(() => {
    const control = document.querySelector<HTMLElement>('[data-testid="floating-advance"]')?.getBoundingClientRect();
    const obstacles = [...document.querySelectorAll<HTMLElement>('[data-floating-advance-obstacle]')]
      .map(element => {
        const rect = element.getBoundingClientRect();
        const scrollContainer = element.closest<HTMLElement>('.app-route-content')?.getBoundingClientRect();
        return {
          element,
          style: getComputedStyle(element),
          rect: scrollContainer ? {
            left: Math.max(rect.left, scrollContainer.left),
            top: Math.max(rect.top, scrollContainer.top),
            right: Math.min(rect.right, scrollContainer.right),
            bottom: Math.min(rect.bottom, scrollContainer.bottom),
            width: Math.max(0, Math.min(rect.right, scrollContainer.right) - Math.max(rect.left, scrollContainer.left)),
            height: Math.max(0, Math.min(rect.bottom, scrollContainer.bottom) - Math.max(rect.top, scrollContainer.top)),
          } : rect,
        };
      })
      .filter(({ rect, style }) => (
        rect.width > 0
        && rect.height > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.right > 0
        && rect.left < window.innerWidth
        && rect.bottom > 0
        && rect.top < window.innerHeight
      ));
    if (!control) return null;
    return {
      control: { left: control.left, top: control.top, right: control.right, bottom: control.bottom },
      avoidanceActive: document.querySelector<HTMLElement>('[data-testid="floating-advance"]')?.dataset.avoidanceActive,
      obstacles: obstacles.map(({ element, rect }) => ({
        testId: element.dataset.testid,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        intersects: control.left < rect.right
          && control.right > rect.left
          && control.top < rect.bottom
          && control.bottom > rect.top,
      })),
    };
  });
  if (!layout) throw new Error(`${label}: floating control is missing`);
  const collision = layout.obstacles.find(obstacle => obstacle.intersects);
  if (collision) throw new Error(`${label}: floating control overlaps ${JSON.stringify(collision)}`);
  return layout;
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
    const expectedPosition = viewport.isMobile ? 'static' : 'fixed';
    if (
      presentation.position !== expectedPosition
      || presentation.display === 'none'
      || (!viewport.isMobile && presentation.zIndex < 100)
    ) {
      throw new Error(`${viewport.name} ${path}: advance control lost its expected presentation ${JSON.stringify(presentation)}`);
    }
    const margin = viewport.isMobile ? 4 : 10;
    if (
      box.x < margin
      || box.y < margin
      || box.x + box.width > viewport.width - margin
      || box.y + box.height > viewport.height - margin
    ) {
      throw new Error(`${viewport.name} ${path}: floating control escaped the visual viewport`);
    }
    if (viewport.isMobile) {
      const overlap = await page.evaluate(() => {
        const content = document.querySelector<HTMLElement>('.app-route-content')?.getBoundingClientRect();
        const control = document.querySelector<HTMLElement>('[data-testid="floating-advance"]')?.getBoundingClientRect();
        return content && control ? Math.max(0, Math.min(content.bottom, control.bottom) - Math.max(content.top, control.top)) : -1;
      });
      if (overlap !== 0) throw new Error(`${viewport.name} ${path}: dock overlaps route content by ${overlap}px`);
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
              setFavoriteTeams: (teamIds: string[]) => void;
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
        store!.getState().setFavoriteTeams([teamId]);
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
      const expectedPosition = viewport.isMobile ? 'static' : 'fixed';
      if (!initialPresentation || initialPresentation.position !== expectedPosition || initialPresentation.display === 'none') {
        throw new Error(`${viewport.name}: shortcut does not use ${expectedPosition} positioning`);
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
        if (!compact || compact.width < 360 || compact.height < 44) {
          throw new Error(`${viewport.name}: shortcut disappeared or failed to dock below the mobile breakpoint`);
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

      const ordinaryLayout = await assertNoObstacleOverlap(page, `${viewport.name} ordinary matchday`);
      const ordinaryScreenshot = `/tmp/football-floating-obstacle-${viewport.name}-matchday.png`;
      await page.screenshot({ path: ordinaryScreenshot, animations: 'disabled' });

      const rolledOver = await page.evaluate(async () => {
        const store = (window as typeof window & {
          __gameStore?: {
            getState: () => {
              advanceUntil: (type: 'season_end') => Promise<boolean>;
              batchAdvance: (count: number) => Promise<boolean>;
            };
          };
        }).__gameStore!;
        const reachedBoundary = await store.getState().advanceUntil('season_end');
        if (!reachedBoundary) return false;
        return store.getState().batchAdvance(10);
      });
      if (!rolledOver) throw new Error(`${viewport.name}: could not create a completed season for layout checks`);

      await page.waitForFunction(() => new URL(window.location.href).pathname === '/');
      await page.getByTestId('open-season-review').click();
      const handoff = page.getByTestId('season-archive-handoff');
      await handoff.waitFor();
      const reviewStats = await page.getByTestId('season-competition-stats').first().textContent();
      const handoffBottomAction = page.getByTestId('auto-resolve-season-transfer');
      if (await handoffBottomAction.count() > 0) await handoffBottomAction.scrollIntoViewIfNeeded();
      else await page.getByTestId('observe-next-season').scrollIntoViewIfNeeded();
      const handoffLayout = await assertNoObstacleOverlap(page, `${viewport.name} season handoff`);
      const handoffScreenshot = `/tmp/football-floating-obstacle-${viewport.name}-handoff.png`;
      await page.screenshot({ path: handoffScreenshot, animations: 'disabled' });

      let draggedObstacleLayout: unknown = null;
      if (!viewport.isMobile) {
        const draggable = page.getByTestId('floating-advance');
        const dragStart = await draggable.boundingBox();
        if (!dragStart) throw new Error(`${viewport.name}: floating control missing before obstacle drag`);
        await page.mouse.move(dragStart.x + dragStart.width / 2, dragStart.y + dragStart.height / 2);
        await page.mouse.down();
        await page.mouse.move(viewport.width - 44, viewport.height - 38, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(100);
        const memoryAfterDrag = await page.evaluate(() => localStorage.getItem('floating-advance-position-v2'));
        draggedObstacleLayout = await assertNoObstacleOverlap(page, `${viewport.name} dragged season handoff`);
        const memoryAfterAvoidance = await page.evaluate(() => localStorage.getItem('floating-advance-position-v2'));
        if (!memoryAfterDrag || memoryAfterAvoidance !== memoryAfterDrag) {
          throw new Error(`${viewport.name}: transient obstacle avoidance overwrote the user's stored position`);
        }
      }

      await page.goto(`${baseUrl}/market?audit=1`, { waitUntil: 'networkidle' });
      const marketFooter = page.getByTestId('market-action-footer');
      await marketFooter.waitFor();
      const marketLayout = await assertNoObstacleOverlap(page, `${viewport.name} market footer`);
      const marketScreenshot = `/tmp/football-floating-obstacle-${viewport.name}-market.png`;
      await page.screenshot({ path: marketScreenshot, animations: 'disabled' });

      await page.goto(`${baseUrl}/history?audit=1`, { waitUntil: 'networkidle' });
      const visibleAchievementItems = await page.locator('[data-testid="achievement-card"], [data-testid="achievement-group"]').count();
      if (visibleAchievementItems > 6) {
        throw new Error(`${viewport.name}: achievement hall rendered ${visibleAchievementItems} default items`);
      }
      const achievementScreenshot = `/tmp/football-achievement-hall-${viewport.name}.png`;
      await page.screenshot({ path: achievementScreenshot, animations: 'disabled' });
      await page.getByTestId('season-history-toggle').first().click();
      const historyObstacle = page.locator('[data-floating-advance-obstacle]').last();
      await historyObstacle.scrollIntoViewIfNeeded();
      const historyLayout = await assertNoObstacleOverlap(page, `${viewport.name} expanded history`);
      const historyScreenshot = `/tmp/football-floating-obstacle-${viewport.name}-history.png`;
      await page.screenshot({ path: historyScreenshot, animations: 'disabled' });

      await page.goto(`${baseUrl}/chronicle?audit=1`, { waitUntil: 'networkidle' });
      await page.getByTestId('chronicle-season-1').click();
      const chronicleStats = await page.getByTestId('season-competition-stats').textContent();
      if (!reviewStats || chronicleStats !== reviewStats) {
        throw new Error(`${viewport.name}: season stats disagree ${JSON.stringify({ reviewStats, chronicleStats })}`);
      }
      if (errors.length > 0) throw new Error(`${viewport.name}: runtime errors: ${errors.join(' | ')}`);

      const screenshot = `/tmp/football-floating-advance-${viewport.name}.png`;
      await page.screenshot({ path: screenshot, animations: 'disabled' });
      reports.push({
        viewport: `${viewport.width}x${viewport.height}`,
        presentation: viewport.isMobile ? 'mobile-layout-dock' : 'desktop-floating-overlay',
        initial,
        initialPresentation,
        dragged,
        restored,
        coveredRoutes,
        before,
        afterTap,
        overflow,
        ordinaryLayout,
        handoffLayout,
        draggedObstacleLayout,
        marketLayout,
        historyLayout,
        reviewStats,
        chronicleStats,
        ordinaryScreenshot,
        handoffScreenshot,
        marketScreenshot,
        achievementScreenshot,
        historyScreenshot,
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

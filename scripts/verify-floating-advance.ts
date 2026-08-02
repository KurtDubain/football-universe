import { chromium, type ConsoleMessage } from 'playwright';

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
    const buttons = page.getByTestId('floating-advance');
    if (await buttons.count() !== 1) {
      throw new Error(`${viewport.name} ${path}: expected exactly one floating button`);
    }
    const box = await buttons.boundingBox();
    if (!box) throw new Error(`${viewport.name} ${path}: floating button is not visible`);
    const contentBox = await page.locator('.app-route-content').boundingBox();
    if (!contentBox) throw new Error(`${viewport.name} ${path}: route content has no box`);
    const margin = 11;
    if (
      box.x < margin
      || box.y < margin
      || box.x + box.width > viewport.width - margin
      || box.y + box.height > viewport.height - margin
    ) {
      throw new Error(`${viewport.name} ${path}: floating button escaped viewport ${JSON.stringify(box)}`);
    }
    if (
      box.x < contentBox.x + margin
      || box.y < contentBox.y + margin
      || box.x + box.width > contentBox.x + contentBox.width - margin
      || box.y + box.height > contentBox.y + contentBox.height - margin
    ) {
      throw new Error(`${viewport.name} ${path}: floating button escaped content area ${JSON.stringify({
        box,
        contentBox,
      })}`);
    }
  }
  return paths;
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
      const ids = await page.evaluate(() => {
        const store = (window as typeof window & {
          __gameStore?: {
            getState: () => {
              newGame: (seed: number) => void;
              world: {
                teamBases: Record<string, unknown>;
                coachBases: Record<string, unknown>;
                squads: Record<string, Array<{ uuid: string }>>;
              };
            };
          };
        }).__gameStore;
        store?.getState().newGame(20260718);
        const world = store!.getState().world;
        const teamId = Object.keys(world.teamBases)[0];
        localStorage.removeItem('floating-advance-position-v2');
        localStorage.removeItem('floating-btn');
        return {
          teamId,
          playerId: world.squads[teamId][0].uuid,
          coachId: Object.keys(world.coachBases)[0],
        };
      });
      await page.reload({ waitUntil: 'networkidle' });

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

      await page.evaluate(() => localStorage.setItem('floating-btn', '0'));
      await page.reload({ waitUntil: 'networkidle' });
      if (await page.getByTestId('floating-advance').count() !== 0) {
        throw new Error(`${viewport.name}: explicit hidden preference was ignored`);
      }
      await page.evaluate(() => localStorage.setItem('floating-btn', '1'));
      await page.goto(`${baseUrl}/teams?audit=1`, { waitUntil: 'networkidle' });

      const draggableButton = page.getByTestId('floating-advance');
      const draggableBox = await draggableButton.boundingBox();
      if (!draggableBox) throw new Error(`${viewport.name}: floating button missing after re-enable`);
      await page.mouse.move(
        draggableBox.x + draggableBox.width / 2,
        draggableBox.y + draggableBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(40, Math.round(viewport.height * 0.43), { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(80);
      const dragged = await draggableButton.boundingBox();
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
        throw new Error(`${viewport.name}: position did not survive reload ${JSON.stringify({
          dragged,
          restored,
          storedPosition,
        })}`);
      }

      const alternateViewport = viewport.isMobile
        ? { width: viewport.width === 320 ? 430 : 320, height: viewport.height === 568 ? 932 : 568 }
        : { width: 390, height: 844 };
      await page.setViewportSize(alternateViewport);
      await page.waitForTimeout(80);
      const resized = await page.getByTestId('floating-advance').boundingBox();
      if (
        !resized
        || resized.x < 11
        || resized.y < 11
        || resized.x + resized.width > alternateViewport.width - 11
        || resized.y + resized.height > alternateViewport.height - 11
      ) {
        throw new Error(`${viewport.name}: position escaped after viewport change ${JSON.stringify(resized)}`);
      }
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(80);

      const coveredRoutes = await verifyRouteCoverage(page, viewport, ids);
      await page.goto(`${baseUrl}/teams?audit=1`, { waitUntil: 'networkidle' });
      await page.getByTestId('floating-advance').click();
      await page.waitForURL(url => url.pathname === '/');
      if (await page.getByTestId('floating-advance').count() !== 1) {
        throw new Error(`${viewport.name}: floating button disappeared on dashboard after advance`);
      }
      await page.getByTestId('toggle-full-report').click();
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
        resized,
        coveredRoutes,
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

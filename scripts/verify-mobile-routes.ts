import { writeFileSync } from 'node:fs';
import { chromium, type BrowserContext, type ConsoleMessage, type Page } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const reportPath = process.env.VERIFY_REPORT ?? '/tmp/football-mobile-routes.json';
const seed = Number(process.env.VERIFY_SEED ?? 20260730);

type AuditWorld = {
  seasonState: { seasonNumber: number };
  teamBases: Record<string, { name: string }>;
  coachBases: Record<string, unknown>;
  squads: Record<string, Array<{ uuid: string }>>;
  transferWindow: unknown | null;
};

type AuditState = {
  world: AuditWorld | null;
  newGame: (seed: number) => Promise<void>;
  setFavoriteTeams: (ids: string[]) => void;
  advanceWindow: () => Promise<boolean>;
  closeTransferWindow: (autoResolve: boolean) => void;
};

type AuditWindow = Window & {
  __gameStore?: {
    getState: () => AuditState;
  };
};

type RouteDescriptor = {
  name: string;
  path: string;
  root?: boolean;
  prepare?: (page: Page) => Promise<void>;
};

type Viewport = {
  width: number;
  height: number;
  label: string;
};

type RouteMetrics = {
  route: string;
  viewport: string;
  textLength: number;
  horizontalOverflow: number;
  undersizedControls: string[];
  inaccessibleClipping: string[];
  tinyBodyText: string[];
  hasExpectedBack: boolean;
};

const mobileViewports: Viewport[] = [
  { width: 320, height: 568, label: 'mobile-compact' },
  { width: 360, height: 800, label: 'mobile-standard' },
  { width: 390, height: 844, label: 'mobile' },
  { width: 430, height: 932, label: 'mobile-wide' },
];

const tabletViewports: Viewport[] = [
  { width: 768, height: 1024, label: 'tablet-portrait' },
];

const desktopViewports: Viewport[] = [
  { width: 1280, height: 720, label: 'desktop-compact' },
  { width: 1440, height: 900, label: 'desktop' },
];

function relevantConsoleMessage(message: ConsoleMessage): string | null {
  if (!['error', 'warning'].includes(message.type())) return null;
  const text = message.text();
  if (text.includes('[vite]') || text.includes('favicon')) return null;
  return `${message.type()}: ${text}`;
}

function attachErrorCapture(page: Page, errors: string[]): void {
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    const relevant = relevantConsoleMessage(message);
    if (relevant) errors.push(relevant);
  });
}

async function initializeSeason(page: Page): Promise<{ teamId: string; playerId: string; coachId: string; advances: number }> {
  await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean((window as AuditWindow).__gameStore));
  const ids = await page.evaluate(async (gameSeed) => {
    const state = (window as AuditWindow).__gameStore!.getState();
    await state.newGame(gameSeed);
    const world = (window as AuditWindow).__gameStore!.getState().world!;
    const teamId = Object.keys(world.teamBases)[0];
    state.setFavoriteTeams([teamId]);
    return {
      teamId,
      playerId: world.squads[teamId][0].uuid,
      coachId: Object.keys(world.coachBases)[0],
    };
  }, seed);

  let advances = 0;
  while (advances < 90) {
    const atTransferWindow = await page.evaluate(() => Boolean(
      (window as AuditWindow).__gameStore?.getState().world?.transferWindow,
    ));
    if (atTransferWindow) break;
    const advanced = await page.evaluate(() => (
      window as AuditWindow
    ).__gameStore!.getState().advanceWindow());
    if (!advanced) {
      throw new Error(`Advance blocked before transfer window at step ${advances}`);
    }
    advances++;
  }

  const reachedTransferWindow = await page.evaluate(() => Boolean(
    (window as AuditWindow).__gameStore?.getState().world?.transferWindow,
  ));
  if (!reachedTransferWindow) throw new Error('Did not reach the first transfer window');
  return { ...ids, advances };
}

async function inspectRoute(
  page: Page,
  descriptor: RouteDescriptor,
  viewport: Viewport,
): Promise<RouteMetrics> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(`${baseUrl}${descriptor.path}${descriptor.path.includes('?') ? '&' : '?'}audit=1`, {
    waitUntil: 'networkidle',
  });
  await descriptor.prepare?.(page);
  await page.locator('body').waitFor({ state: 'visible' });

  const metrics = await page.evaluate(({ routeName, viewportLabel, expectBack, enforceTouchSize }) => {
    const controls = [...document.querySelectorAll<HTMLElement>([
      'button',
      '[role="button"]',
      '[role="tab"]',
      'summary',
      'select',
      'textarea',
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"])',
    ].join(','))].filter(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden';
    });

    const undersizedControls = enforceTouchSize ? controls
      .filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width < 43.5 || rect.height < 43.5;
      })
      .map(element => {
        const label = (
          element.getAttribute('aria-label')
          || element.getAttribute('title')
          || element.textContent
          || element.tagName
        ).trim().replace(/\s+/g, ' ').slice(0, 70);
        return `${label} (${Math.round(element.getBoundingClientRect().width)}x${Math.round(element.getBoundingClientRect().height)})`;
      })
      .slice(0, 12) : [];

    const inaccessibleClipping = [...document.querySelectorAll<HTMLElement>('.truncate,[class*="text-ellipsis"]')]
      .filter(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0
          && rect.height > 0
          && style.display !== 'none'
          && style.visibility !== 'hidden';
      })
      .filter(element => element.scrollWidth > element.clientWidth + 1)
      .filter(element => !element.getAttribute('title')
        && !element.getAttribute('aria-label')
        && !element.closest('[title],[aria-label]'))
      .map(element => (
        element.getAttribute('aria-label')
        || element.getAttribute('title')
        || element.textContent
        || element.tagName
      ).trim().replace(/\s+/g, ' ').slice(0, 70))
      .slice(0, 12);

    const tinyBodyText = enforceTouchSize ? [...document.querySelectorAll<HTMLElement>('p,span,div,a,button,label')]
      .filter(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0
          && rect.height > 0
          && style.display !== 'none'
          && style.visibility !== 'hidden';
      })
      .filter(element => element.children.length === 0)
      .filter(element => (element.textContent ?? '').trim().length >= 8)
      .filter(element => Number.parseFloat(getComputedStyle(element).fontSize) < 11)
      .map(element => {
        const label = (
          element.getAttribute('aria-label')
          || element.getAttribute('title')
          || element.textContent
          || element.tagName
        ).trim().replace(/\s+/g, ' ').slice(0, 70);
        return `${label} (${getComputedStyle(element).fontSize})`;
      })
      .slice(0, 12) : [];

    return {
      route: routeName,
      viewport: viewportLabel,
      textLength: (document.querySelector('main')?.innerText ?? document.body.innerText ?? '').trim().length,
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      undersizedControls,
      inaccessibleClipping,
      tinyBodyText,
      hasExpectedBack: !enforceTouchSize
        || !expectBack
        || Boolean(document.querySelector('[data-testid="mobile-route-back"]')),
    };
  }, {
    routeName: descriptor.name,
    viewportLabel: viewport.label,
    expectBack: !descriptor.root,
    enforceTouchSize: viewport.width < 640,
  });

  const failures = [
    metrics.textLength <= 20 && 'empty page',
    metrics.horizontalOverflow > 1 && `${metrics.horizontalOverflow}px horizontal overflow`,
    metrics.undersizedControls.length > 0 && `undersized controls: ${metrics.undersizedControls.join(', ')}`,
    metrics.inaccessibleClipping.length > 0 && `inaccessible clipping: ${metrics.inaccessibleClipping.join(', ')}`,
    metrics.tinyBodyText.length > 0 && `tiny body text: ${metrics.tinyBodyText.join(', ')}`,
    !metrics.hasExpectedBack && 'missing mobile return control',
  ].filter(Boolean);
  if (failures.length > 0) {
    throw new Error(`${viewport.label} ${descriptor.name}: ${failures.join(' | ')}`);
  }
  return metrics;
}

async function verifyNavigation(page: Page, ids: { teamId: string; playerId: string }): Promise<Record<string, boolean>> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/teams?audit=1`, { waitUntil: 'networkidle' });

  const teamRow = page.locator('[data-testid="team-directory-row"]').first();
  await teamRow.focus();
  await page.keyboard.press('Enter');
  const teamRowKeyboard = new URL(page.url()).pathname.startsWith('/team/');

  await page.getByTestId('mobile-route-back').click();
  const teamReturn = new URL(page.url()).pathname === '/teams';

  await page.goto(`${baseUrl}/player/${ids.playerId}?audit=1`, { waitUntil: 'networkidle' });
  await page.getByTestId('mobile-route-back').click();
  const playerReturn = new URL(page.url()).pathname === '/players';

  await page.goto(`${baseUrl}/team/${ids.teamId}?audit=1`, { waitUntil: 'networkidle' });
  const menuButton = page.getByRole('button', { name: '打开导航菜单' });
  await menuButton.click();
  const drawer = page.getByRole('dialog', { name: '足球联赛宇宙' });
  const drawerTargets = await drawer.locator('a,button').evaluateAll(elements => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }));
  const drawerTargetsSized = drawerTargets.every(target => target.width >= 43.5 && target.height >= 43.5);
  await drawer.getByRole('link', { name: '球员中心' }).click();
  const drawerNavigation = new URL(page.url()).pathname === '/players'
    && await page.getByRole('dialog').count() === 0;

  await menuButton.click();
  await page.keyboard.press('Escape');
  const drawerEscape = await page.getByRole('dialog').count() === 0
    && await menuButton.evaluate(element => element === document.activeElement);

  await page.goto(`${baseUrl}/players?audit=1`, { waitUntil: 'networkidle' });
  const tablist = page.getByRole('tablist', { name: '球员榜单' });
  const lastTab = tablist.getByRole('tab').last();
  await lastTab.click();
  await page.waitForTimeout(350);
  const selectedTabVisible = await lastTab.evaluate((element) => {
    const item = element.getBoundingClientRect();
    const container = element.parentElement!.getBoundingClientRect();
    return item.left >= container.left - 1 && item.right <= container.right + 1;
  });

  return {
    teamRowKeyboard,
    teamReturn,
    playerReturn,
    drawerTargetsSized,
    drawerNavigation,
    drawerEscape,
    selectedTabVisible,
  };
}

async function verifyLargeTextAndReducedMotion(page: Page): Promise<Record<string, boolean>> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/team-editor?audit=1`, { waitUntil: 'networkidle' });
  const largeText = await page.evaluate(async () => {
    document.documentElement.style.fontSize = '20px';
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    return {
      noOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
      primaryActionsVisible: [...document.querySelectorAll<HTMLElement>('button')]
        .filter(element => (element.textContent ?? '').includes('开局'))
        .every(element => element.getBoundingClientRect().width > 0),
    };
  });
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
  const reducedMotion = await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  return {
    largeTextNoOverflow: largeText.noOverflow,
    largeTextActionsVisible: largeText.primaryActionsVisible,
    reducedMotion,
  };
}

async function verifyOfflineRevisit(page: Page, context: BrowserContext): Promise<boolean> {
  await page.goto(`${baseUrl}/history?audit=1`, { waitUntil: 'networkidle' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'networkidle' });
  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
    return (await page.locator('body').innerText()).trim().length > 20;
  } finally {
    await context.setOffline(false);
  }
}

async function verifyWelcome(browser: Awaited<ReturnType<typeof chromium.launch>>): Promise<Record<string, boolean>> {
  const context = await browser.newContext({ viewport: { width: 320, height: 568 } });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/?fresh=1`, { waitUntil: 'networkidle' });
    const welcomeVisible = await page.getByRole('heading', { name: '足球联赛宇宙' }).isVisible();
    const controlsSized = await page.locator('button,a').evaluateAll(elements => elements
      .filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .every(element => {
        const rect = element.getBoundingClientRect();
        return rect.width >= 43.5 && rect.height >= 43.5;
      }));
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    await page.screenshot({ path: '/tmp/football-mobile-routes-welcome-320.png', animations: 'disabled' });
    return { welcomeVisible, controlsSized, noOverflow };
  } finally {
    await context.close();
  }
}

async function verifyErrorBoundary(browser: Awaited<ReturnType<typeof chromium.launch>>): Promise<Record<string, boolean>> {
  const context = await browser.newContext({ viewport: { width: 320, height: 568 } });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/?auditError=1`, { waitUntil: 'networkidle' });
    const recoveryVisible = await page.getByRole('heading', { name: '足球宇宙暂时无法继续' }).isVisible();
    const controlsSized = await page.locator('button,summary').evaluateAll(elements => elements
      .filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .every(element => {
        const rect = element.getBoundingClientRect();
        return rect.width >= 43.5 && rect.height >= 43.5;
      }));
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    await page.getByRole('button', { name: '返回主页' }).click();
    await page.waitForURL(url => url.pathname === '/' && !url.searchParams.has('auditError'));
    const recoveredHome = new URL(page.url()).pathname === '/';
    return { recoveryVisible, errorControlsSized: controlsSized, errorNoOverflow: noOverflow, recoveredHome };
  } finally {
    await context.close();
  }
}

async function verifyStandaloneAndRotation(browser: Awaited<ReturnType<typeof chromium.launch>>): Promise<Record<string, boolean>> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript({
    content: `
      (() => {
        const original = window.matchMedia.bind(window);
        window.matchMedia = function matchMedia(query) {
          if (query === '(display-mode: standalone)') {
            return {
              matches: true,
              media: query,
              onchange: null,
              addListener() {},
              removeListener() {},
              addEventListener() {},
              removeEventListener() {},
              dispatchEvent() { return true; },
            };
          }
          return original(query);
        };
      })();
    `,
  });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean((window as AuditWindow).__gameStore));
    await page.evaluate((gameSeed) => (window as AuditWindow).__gameStore!.getState().newGame(gameSeed), seed + 1);
    await page.getByTestId('app-shell').waitFor();

    const portrait = await page.evaluate(() => ({
      standalone: window.matchMedia('(display-mode: standalone)').matches,
      viewportFitCover: document.querySelector('meta[name="viewport"]')?.getAttribute('content')?.includes('viewport-fit=cover') ?? false,
      shellDelta: Math.abs(document.querySelector<HTMLElement>('[data-testid="app-shell"]')!.getBoundingClientRect().height - window.innerHeight),
      overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    }));
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(100);
    const landscape = await page.evaluate(() => ({
      shellDelta: Math.abs(document.querySelector<HTMLElement>('[data-testid="app-shell"]')!.getBoundingClientRect().height - window.innerHeight),
      overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      headerVisible: document.querySelector<HTMLElement>('.app-shell-header')!.getBoundingClientRect().height >= 44,
    }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const restored = await page.evaluate(() => (
      Math.max(0, document.documentElement.scrollWidth - window.innerWidth) <= 1
      && Math.abs(document.querySelector<HTMLElement>('[data-testid="app-shell"]')!.getBoundingClientRect().height - window.innerHeight) <= 1
    ));

    return {
      standaloneMode: portrait.standalone,
      viewportFitCover: portrait.viewportFitCover,
      standaloneNoOverflow: portrait.overflow <= 1,
      standaloneUsesDynamicViewport: portrait.shellDelta <= 1,
      landscapeNoOverflow: landscape.overflow <= 1,
      landscapeUsesDynamicViewport: landscape.shellDelta <= 1,
      landscapeHeaderVisible: landscape.headerVisible,
      portraitRestored: restored,
    };
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const runtimeErrors: string[] = [];
  attachErrorCapture(page, runtimeErrors);

  try {
    const initialized = await initializeSeason(page);
    const routeMetrics: RouteMetrics[] = [];
    const marketRoute: RouteDescriptor = { name: 'market', path: '/market' };
    for (const viewport of [...mobileViewports, ...tabletViewports, ...desktopViewports]) {
      routeMetrics.push(await inspectRoute(
        page,
        viewport.width < 640 ? marketRoute : { ...marketRoute, root: true },
        viewport,
      ));
    }
    await page.evaluate(() => {
      (window as AuditWindow).__gameStore!.getState().closeTransferWindow(false);
    });
    await page.waitForFunction(() => (
      window as AuditWindow
    ).__gameStore?.getState().world?.seasonState.seasonNumber === 2);

    const routes: RouteDescriptor[] = [
      { name: 'dashboard', path: '/', root: true },
      {
        name: 'season-review',
        path: '/',
        root: true,
        prepare: async currentPage => {
          await currentPage.getByRole('tab', { name: /S\d+档案/ }).click();
        },
      },
      { name: 'calendar', path: '/calendar' },
      { name: 'league', path: '/league/1' },
      { name: 'league-cup', path: '/cup/league_cup' },
      { name: 'super-cup', path: '/cup/super_cup' },
      { name: 'teams', path: '/teams' },
      { name: 'team-detail', path: `/team/${initialized.teamId}` },
      { name: 'coaches', path: '/coaches' },
      { name: 'coach-detail', path: `/coach/${initialized.coachId}` },
      { name: 'players', path: '/players' },
      { name: 'player-detail', path: `/player/${initialized.playerId}` },
      { name: 'transfers', path: '/transfers' },
      { name: 'history', path: '/history' },
      { name: 'chronicle', path: '/chronicle' },
      { name: 'legends', path: '/legends' },
      { name: 'memorable', path: '/memorable' },
      { name: 'advanced-search', path: '/search' },
      { name: 'compare', path: '/compare' },
      { name: 'settings', path: '/settings' },
      { name: 'team-editor', path: '/team-editor' },
    ];

    for (const viewport of mobileViewports) {
      for (const route of routes) {
        routeMetrics.push(await inspectRoute(page, route, viewport));
      }
    }
    for (const viewport of tabletViewports) {
      for (const route of routes) {
        routeMetrics.push(await inspectRoute(page, { ...route, root: true }, viewport));
      }
    }
    for (const viewport of desktopViewports) {
      for (const route of routes.filter(item => [
        'dashboard', 'season-review', 'league', 'team-detail', 'player-detail',
        'market', 'history', 'team-editor',
      ].includes(item.name))) {
        const metrics = await inspectRoute(page, { ...route, root: true }, viewport);
        if (metrics.horizontalOverflow > 1 || metrics.textLength <= 20) {
          throw new Error(`${viewport.label} ${route.name}: desktop layout failed`);
        }
        routeMetrics.push(metrics);
      }
    }

    const navigation = await verifyNavigation(page, initialized);
    const accessibilityModes = await verifyLargeTextAndReducedMotion(page);
    const offlineRevisit = await verifyOfflineRevisit(page, context);
    const welcome = await verifyWelcome(browser);
    const errorBoundary = await verifyErrorBoundary(browser);
    const standaloneAndRotation = await verifyStandaloneAndRotation(browser);
    const checks = {
      ...navigation,
      ...accessibilityModes,
      offlineRevisit,
      ...welcome,
      ...errorBoundary,
      ...standaloneAndRotation,
    };
    const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    if (failedChecks.length > 0) throw new Error(`Interaction checks failed: ${failedChecks.join(', ')}`);
    if (runtimeErrors.length > 0) throw new Error(`Runtime errors: ${runtimeErrors.join(' | ')}`);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/memorable?audit=1`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: '/tmp/football-mobile-routes-memorable-390.png', animations: 'disabled' });
    await page.goto(`${baseUrl}/team-editor?audit=1`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: '/tmp/football-mobile-routes-editor-390.png', animations: 'disabled' });
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(`${baseUrl}/team/${initialized.teamId}?audit=1`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: '/tmp/football-mobile-routes-team-320.png', animations: 'disabled' });

    const report = {
      passed: true,
      seed,
      advancesToTransferWindow: initialized.advances,
      routeChecks: routeMetrics.length,
      checks,
      runtimeErrors,
      screenshots: [
        '/tmp/football-mobile-routes-welcome-320.png',
        '/tmp/football-mobile-routes-team-320.png',
        '/tmp/football-mobile-routes-memorable-390.png',
        '/tmp/football-mobile-routes-editor-390.png',
      ],
      routeMetrics,
    };
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  writeFileSync(reportPath, `${JSON.stringify({ passed: false, fatalError: message }, null, 2)}\n`);
  console.error(error);
  process.exitCode = 1;
});

import { chromium, type BrowserContext, type ConsoleMessage, type Locator, type Page } from 'playwright';
import { initializeGameWorld, type GameWorld } from '../src/engine/season/season-manager';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const seed = Number(process.env.VERIFY_SEED ?? 20260811);

interface MusicEvent {
  owner?: string;
  scene: string;
  state: string;
}

type AuditWindow = Window & {
  __gameStore?: {
    setState: (patch: {
      world: GameWorld;
      initialized: boolean;
      favoriteTeamId: string;
      favoriteTeamIds: string[];
    }) => void;
  };
  __tournamentMusicEvents?: MusicEvent[];
};

const routes = [
  { type: 'league_cup', scene: 'league_cup', label: '联赛杯主题', asset: 'league-cup-theme-v1' },
  { type: 'super_cup', scene: 'super_cup', label: '超级杯主题', asset: 'super-cup-theme-v1' },
  { type: 'mainland_cup', scene: 'mainland_cup', label: '大陆杯主题', asset: 'mainland-cup-theme-v1' },
  { type: 'southern_cup', scene: 'southern_cup', label: '南洲杯主题', asset: 'southern-cup-theme-v1' },
  { type: 'eastern_cup', scene: 'eastern_cup', label: '东洲杯主题', asset: 'eastern-cup-theme-v1' },
] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function captureError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
}

async function prepareContext(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    localStorage.setItem('football-feedback-preferences-v1', JSON.stringify({
      soundEnabled: true,
      soundProfile: 'balanced',
      effectsVolume: 1,
      musicVolume: 1,
      hapticsEnabled: false,
    }));
    const events: MusicEvent[] = [];
    (window as AuditWindow).__tournamentMusicEvents = events;
    window.addEventListener('football-ambient-music', event => {
      events.push({ ...((event as CustomEvent<MusicEvent>).detail ?? {}) });
    });
  });
}

async function installWorld(page: Page, world: GameWorld): Promise<void> {
  const favoriteTeamId = Object.keys(world.teamBases)[0];
  await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean((window as AuditWindow).__gameStore));
  await page.evaluate(({ nextWorld, teamId }) => {
    const store = (window as AuditWindow).__gameStore;
    if (!store) throw new Error('Audit store unavailable');
    store.setState({
      world: nextWorld,
      initialized: true,
      favoriteTeamId: teamId,
      favoriteTeamIds: [teamId],
    });
  }, { nextWorld: world, teamId: favoriteTeamId });
}

async function ensureThemeStarted(
  page: Page,
  button: Locator,
  scene: string,
  contextLabel: string,
): Promise<void> {
  try {
    await page.waitForFunction(expectedScene => {
      const events = (window as AuditWindow).__tournamentMusicEvents ?? [];
      const playbackState = document.querySelector<HTMLElement>('[data-testid="tournament-music-now-playing"]')?.dataset.playbackState
        ?? document.querySelector<HTMLElement>('[data-testid="tournament-music-toggle"]')?.dataset.playbackState;
      return events.some(event => event.scene === expectedScene && event.state === 'started')
        || playbackState === 'blocked';
    }, scene, { timeout: 5_000 });
    const alreadyStarted = await page.evaluate(expectedScene =>
      ((window as AuditWindow).__tournamentMusicEvents ?? [])
        .some(event => event.scene === expectedScene && event.state === 'started'),
    scene);
    if (!alreadyStarted) {
      await button.click();
      await page.waitForFunction(expectedScene =>
        (window as AuditWindow).__tournamentMusicEvents?.some(event =>
          event.scene === expectedScene && event.state === 'started'
        ),
      scene, { timeout: 5_000 });
    }
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="tournament-music-toggle"]')?.getAttribute('aria-pressed') === 'true',
    null, { timeout: 2_000 });
  } catch {
    const diagnostic = await page.evaluate(() => ({
      events: (window as AuditWindow).__tournamentMusicEvents ?? [],
      controlState: document.querySelector('[data-testid="tournament-music-toggle"]')?.getAttribute('aria-pressed'),
      playbackState: document.querySelector<HTMLElement>('[data-testid="tournament-music-now-playing"]')?.dataset.playbackState
        ?? document.querySelector<HTMLElement>('[data-testid="tournament-music-toggle"]')?.dataset.playbackState,
      visibility: document.visibilityState,
      online: navigator.onLine,
    }));
    throw new Error(`${contextLabel}: theme did not start: ${JSON.stringify(diagnostic)}`);
  }
}

async function verifyRoute(page: Page, route: typeof routes[number], viewportName: string): Promise<Record<string, unknown>> {
  await page.goto(`${baseUrl}/cup/${route.type}?audit=1`, { waitUntil: 'networkidle' });
  const button = page.getByTestId('tournament-music-toggle');
  await button.waitFor({ state: 'visible' });
  assert(await button.getAttribute('data-music-scene') === route.scene, `${viewportName}/${route.type}: wrong scene`);
  assert((await button.getAttribute('aria-label'))?.includes(route.label), `${viewportName}/${route.type}: label is missing`);
  await ensureThemeStarted(page, button, route.scene, `${viewportName}/${route.type}`);

  const state = await page.evaluate(asset => {
    const control = document.querySelector<HTMLElement>('[data-testid="tournament-music-toggle"]');
    const rect = control?.getBoundingClientRect();
    return {
      support: document.createElement('audio').canPlayType('audio/mp4; codecs="mp4a.40.2"'),
      resources: performance.getEntriesByType('resource')
        .map(entry => entry.name)
        .filter(name => name.endsWith('.m4a')),
      events: (window as AuditWindow).__tournamentMusicEvents ?? [],
      scene: control?.dataset.musicScene,
      pressed: control?.getAttribute('aria-pressed'),
      width: rect?.width ?? 0,
      height: rect?.height ?? 0,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      expectedAssetLoaded: performance.getEntriesByType('resource').some(entry => entry.name.includes(asset)),
    };
  }, route.asset);

  assert(state.support !== '', `${viewportName}/${route.type}: browser reports no AAC support`);
  assert(state.expectedAssetLoaded, `${viewportName}/${route.type}: theme asset was not requested`);
  assert(state.pressed === 'true', `${viewportName}/${route.type}: control did not enter playing state`);
  assert(state.height >= 44, `${viewportName}/${route.type}: control is too short (${state.height}px)`);
  assert(state.width > 0 && state.width <= page.viewportSize()!.width, `${viewportName}/${route.type}: control width is invalid (${state.width}px)`);
  assert(state.overflow <= 1, `${viewportName}/${route.type}: page overflows by ${state.overflow}px`);

  const screenshot = `/tmp/football-tournament-music-${viewportName}-${route.type}.png`;
  await page.screenshot({ path: screenshot, animations: 'disabled', fullPage: false });
  let modalHandoff = false;
  let advancePersistence = false;
  if (viewportName === 'mobile-390' && route.type === 'league_cup') {
    const fixture = page.locator('.cup-bracket-tie:not([disabled])').first();
    await fixture.click();
    await page.getByRole('dialog').waitFor({ state: 'visible' });
    await page.waitForFunction(scene =>
      (window as AuditWindow).__tournamentMusicEvents?.some(event => event.scene === scene && event.state === 'stopped'),
    route.scene, { timeout: 2_000 });
    assert(await button.getAttribute('aria-pressed') === 'false', 'Cup page music did not yield to the match dialog');
    modalHandoff = true;
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  if (viewportName === 'mobile-390' && route.type === 'super_cup') {
    const stoppedBefore = await page.evaluate(scene =>
      ((window as AuditWindow).__tournamentMusicEvents ?? [])
        .filter(event => event.scene === scene && event.state === 'stopped').length,
    route.scene);
    await page.getByTestId('header-advance').click();
    await page.waitForURL(url => url.pathname === '/', { timeout: 15_000 });
    const nowPlaying = page.getByTestId('tournament-music-now-playing');
    await nowPlaying.waitFor({ state: 'visible' });
    assert(await nowPlaying.getAttribute('data-music-scene') === route.scene, 'Tournament identity was lost after advancing');
    assert(await page.getByTestId('tournament-music-global-toggle').getAttribute('aria-pressed') === 'true', 'Tournament music did not remain active after advancing');
    await page.waitForTimeout(450);
    const stoppedAfter = await page.evaluate(scene =>
      ((window as AuditWindow).__tournamentMusicEvents ?? [])
        .filter(event => event.scene === scene && event.state === 'stopped').length,
    route.scene);
    assert(stoppedAfter === stoppedBefore, 'Tournament music restarted or stopped during the route transition');
    await page.screenshot({
      path: '/tmp/football-tournament-music-mobile-390-advance-persistence.png',
      animations: 'disabled',
      fullPage: false,
    });
    advancePersistence = true;
  }
  const globalToggle = page.getByTestId('tournament-music-global-toggle');
  if (await globalToggle.isVisible().catch(() => false)) {
    if (await globalToggle.getAttribute('aria-pressed') === 'true') await globalToggle.click();
  } else if (await button.isVisible().catch(() => false) && await button.getAttribute('aria-pressed') === 'true') {
    await button.click();
  }
  await page.waitForFunction(scene =>
    (window as AuditWindow).__tournamentMusicEvents?.some(event => event.scene === scene && event.state === 'stopped'),
  route.scene, { timeout: 2_000 });

  let offlineRevisit = false;
  if (viewportName === 'mobile-390' && route.type === 'eastern_cup') {
    await page.evaluate(() => navigator.serviceWorker.ready);
    if (!await page.evaluate(() => navigator.serviceWorker.controller !== null)) {
      await page.reload({ waitUntil: 'networkidle' });
    }
    await page.context().setOffline(true);
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
      const offlineButton = page.getByTestId('tournament-music-toggle');
      await offlineButton.waitFor({ state: 'visible' });
      await ensureThemeStarted(page, offlineButton, route.scene, `${viewportName}/${route.type}/offline`);
      assert(await offlineButton.getAttribute('data-music-scene') === route.scene, 'Offline revisit lost its tournament identity');
      offlineRevisit = true;
      if (await offlineButton.getAttribute('aria-pressed') === 'true') await offlineButton.click();
    } finally {
      await page.context().setOffline(false);
    }
  }
  return { route: route.type, ...state, modalHandoff, advancePersistence, offlineRevisit, screenshot };
}

async function navigateSpa(page: Page, path: string): Promise<void> {
  const link = page.locator(`a[href="${path}"]`).first();
  assert(await link.count() > 0, `SPA navigation link is missing: ${path}`);
  await link.evaluate(element => (element as HTMLAnchorElement).click());
  await page.waitForURL(url => url.pathname === path, { timeout: 5_000 });
}

async function verifyRouteAndBrowserTabSwitches(page: Page): Promise<Record<string, unknown>> {
  await navigateSpa(page, '/cup/league_cup');
  const leagueButton = page.getByTestId('tournament-music-toggle');
  await leagueButton.waitFor({ state: 'visible' });
  await ensureThemeStarted(page, leagueButton, 'league_cup', 'spa-switch/league-cup');

  await navigateSpa(page, '/cup/super_cup');
  const superButton = page.getByTestId('tournament-music-toggle');
  await superButton.waitFor({ state: 'visible' });
  assert(await superButton.getAttribute('data-music-scene') === 'super_cup', 'SPA cup switch kept the previous identity');
  await ensureThemeStarted(page, superButton, 'super_cup', 'spa-switch/super-cup');
  await page.waitForTimeout(400);
  const afterCompetitionSwitch = await page.evaluate(() => ({
    leagueStopped: ((window as AuditWindow).__tournamentMusicEvents ?? [])
      .filter(event => event.scene === 'league_cup' && event.state === 'stopped').length,
    superStarted: ((window as AuditWindow).__tournamentMusicEvents ?? [])
      .filter(event => event.scene === 'super_cup' && event.state === 'started').length,
  }));
  assert(afterCompetitionSwitch.leagueStopped === 1, 'Previous cup theme did not crossfade out exactly once');
  assert(afterCompetitionSwitch.superStarted === 1, 'Next cup theme did not start exactly once');

  await navigateSpa(page, '/teams');
  const nowPlaying = page.getByTestId('tournament-music-now-playing');
  await nowPlaying.waitFor({ state: 'visible' });
  assert(await nowPlaying.getAttribute('data-music-scene') === 'super_cup', 'Ordinary route lost the selected tournament identity');
  const stoppedBeforeTabSwitch = await page.evaluate(() =>
    ((window as AuditWindow).__tournamentMusicEvents ?? [])
      .filter(event => event.scene === 'super_cup' && event.state === 'stopped').length
  );

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(350);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    Reflect.deleteProperty(document, 'visibilityState');
  });
  await page.waitForTimeout(350);

  const stoppedAfterTabSwitch = await page.evaluate(() =>
    ((window as AuditWindow).__tournamentMusicEvents ?? [])
      .filter(event => event.scene === 'super_cup' && event.state === 'stopped').length
  );
  assert(stoppedAfterTabSwitch === stoppedBeforeTabSwitch, 'Browser tab switch destroyed or restarted the active theme');
  assert(await page.getByTestId('tournament-music-global-toggle').getAttribute('aria-pressed') === 'true', 'Theme did not resume after returning to the browser tab');

  const screenshot = '/tmp/football-tournament-music-mobile-390-tab-switch.png';
  await page.screenshot({ path: screenshot, animations: 'disabled', fullPage: false });
  return { afterCompetitionSwitch, stoppedBeforeTabSwitch, stoppedAfterTabSwitch, screenshot };
}

async function main(): Promise<void> {
  const world = initializeGameWorld(seed);
  const browser = await chromium.launch({ headless: true });
  const reports: Record<string, unknown>[] = [];
  const errors: string[] = [];
  try {
    for (const viewport of [
      { name: 'mobile-320', width: 320, height: 568, isMobile: true, hasTouch: true },
      { name: 'mobile-390', width: 390, height: 844, isMobile: true, hasTouch: true },
      { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
    ]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch,
      });
      await prepareContext(context);
      const page = await context.newPage();
      page.on('console', message => captureError(message, errors));
      await installWorld(page, world);
      for (const route of routes) reports.push(await verifyRoute(page, route, viewport.name));
      if (viewport.name === 'mobile-390') {
        await installWorld(page, world);
        reports.push({ route: 'route-and-browser-tab-switches', ...await verifyRouteAndBrowserTabSwitches(page) });
      }
      await context.close();
    }
    assert(errors.length === 0, `Console errors: ${errors.join(' | ')}`);
    process.stdout.write(`${JSON.stringify({ seed, reports, errors }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

import { chromium, type ConsoleMessage, type Page } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const viewports = [
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
] as const;

interface AudioDelivery {
  type: 'start' | 'event' | 'stage' | 'stop';
  cue?: string;
}

function captureConsoleError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
}

async function initializeObserver(page: Page): Promise<void> {
  await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean((window as typeof window & { __gameStore?: unknown }).__gameStore));
  await page.evaluate(() => {
    type AuditState = {
      newGame: (seed: number) => void;
      setFavoriteTeam: (teamId: string) => void;
      getCurrentWindow: () => { fixtures: Array<{ homeTeamId: string }> } | null;
    };
    const store = (window as typeof window & { __gameStore?: { getState: () => AuditState } }).__gameStore;
    if (!store) throw new Error('Audit store unavailable');
    store.getState().newGame(20260808);
    const fixture = store.getState().getCurrentWindow()?.fixtures[0];
    if (!fixture) throw new Error('Initial fixture unavailable');
    store.getState().setFavoriteTeam(fixture.homeTeamId);
  });
  await page.getByTestId('dashboard').waitFor({ state: 'visible' });
}

async function verifyViewport(viewport: typeof viewports[number]) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', message => captureConsoleError(message, errors));
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const target = window as typeof window & { __broadcastAudio?: AudioDelivery[] };
    target.__broadcastAudio = [];
    window.addEventListener('football-match-soundscape', event => {
      target.__broadcastAudio?.push((event as CustomEvent<AudioDelivery>).detail);
    });
  });

  try {
    await initializeObserver(page);
    const watchToggle = page.getByTestId('focus-watch-toggle').first();
    await watchToggle.waitFor({ state: 'visible' });
    await watchToggle.click();
    if (await watchToggle.getAttribute('aria-pressed') !== 'true') {
      throw new Error(`${viewport.name}: focus watch did not lock`);
    }

    const advance = page.getByTestId('dashboard-advance');
    if (!((await advance.textContent()) ?? '').includes('进入焦点直播')) {
      throw new Error(`${viewport.name}: advance action did not acknowledge focus watch`);
    }
    await advance.click();

    const opener = page.getByTestId('key-match-opener');
    await opener.waitFor({ state: 'visible', timeout: 15_000 });
    if (!((await opener.textContent()) ?? '').includes('比分未揭晓')) {
      throw new Error(`${viewport.name}: opener is missing spoiler-free status`);
    }
    if (await horizontalOverflow(page) > 1) throw new Error(`${viewport.name}: opener page overflow`);
    await page.screenshot({
      path: `/tmp/football-broadcast-opener-${viewport.name}.png`,
      animations: 'disabled',
    });

    const soundscapeStarted = await page.evaluate(() => (
      (window as typeof window & { __broadcastAudio?: AudioDelivery[] }).__broadcastAudio ?? []
    ).some(delivery => delivery.type === 'start'));
    if (!soundscapeStarted) throw new Error(`${viewport.name}: soundscape did not start after gesture`);

    await page.getByRole('button', { name: '跳过转播开场' }).click();
    await opener.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '精华', exact: true }).click();
    const canvas = page.locator('canvas').first();
    await canvas.waitFor({ state: 'visible' });
    await page.waitForFunction(() => (
      (window as typeof window & { __broadcastAudio?: AudioDelivery[] }).__broadcastAudio ?? []
    ).some(delivery => delivery.type === 'event'), undefined, { timeout: 12_000 });
    const nonBlank = await canvas.evaluate(element => {
      const source = element as HTMLCanvasElement;
      const context2d = source.getContext('2d');
      if (!context2d || source.width === 0 || source.height === 0) return false;
      const data = context2d.getImageData(0, 0, source.width, source.height).data;
      for (let index = 0; index < data.length; index += 64) {
        if (data[index] || data[index + 1] || data[index + 2] || data[index + 3]) return true;
      }
      return false;
    });
    if (!nonBlank) throw new Error(`${viewport.name}: live canvas is blank`);
    await page.screenshot({
      path: `/tmp/football-broadcast-live-${viewport.name}.png`,
      animations: 'disabled',
    });

    await page.getByRole('button', { name: /跳过/ }).last().click();
    await page.getByText('全场结束', { exact: true }).waitFor({ state: 'visible' });
    const deliveries = await page.evaluate(() => (
      (window as typeof window & { __broadcastAudio?: AudioDelivery[] }).__broadcastAudio ?? []
    ));
    if (!deliveries.some(delivery => delivery.type === 'event')) {
      throw new Error(`${viewport.name}: no event sound was scheduled`);
    }
    if (!deliveries.some(delivery => delivery.type === 'stage' && delivery.cue === 'fulltime')) {
      throw new Error(`${viewport.name}: fulltime sound stage missing`);
    }
    await page.getByRole('button', { name: '关闭', exact: true }).click();

    const seasonStatus = await page.evaluate(async () => {
      type AuditState = {
        advanceUntil: (type: 'season_end') => Promise<boolean>;
        advanceWindow: () => Promise<boolean>;
        world: { seasonState: { seasonNumber: number }; honorHistory: unknown[] } | null;
      };
      const store = (window as typeof window & { __gameStore?: { getState: () => AuditState } }).__gameStore;
      if (!store) throw new Error('Audit store unavailable for season review');
      await store.getState().advanceUntil('season_end');
      await store.getState().advanceWindow();
      return {
        season: store.getState().world?.seasonState.seasonNumber ?? 0,
        honors: store.getState().world?.honorHistory.length ?? 0,
      };
    });
    if (seasonStatus.season < 2 || seasonStatus.honors < 1) {
      throw new Error(`${viewport.name}: season review data was not finalized ${JSON.stringify(seasonStatus)}`);
    }
    const reviewTab = page.getByRole('tab', { name: /S1档案/ });
    await reviewTab.waitFor({ state: 'visible', timeout: 15_000 });
    await reviewTab.click();
    const championHero = page.getByTestId('season-champion-hero');
    await championHero.waitFor({ state: 'visible' });
    if (await horizontalOverflow(page) > 1) throw new Error(`${viewport.name}: champion hero page overflow`);
    await page.screenshot({
      path: `/tmp/football-champion-hero-${viewport.name}.png`,
      animations: 'disabled',
    });

    if (errors.length > 0) throw new Error(`${viewport.name}: runtime errors ${errors.join(' | ')}`);
    return {
      viewport: viewport.name,
      audioDeliveries: deliveries,
      openerScreenshot: `/tmp/football-broadcast-opener-${viewport.name}.png`,
      championScreenshot: `/tmp/football-champion-hero-${viewport.name}.png`,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

const results = [];
for (const viewport of viewports) results.push(await verifyViewport(viewport));
console.log(JSON.stringify(results, null, 2));

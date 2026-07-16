import { chromium, type BrowserContext, type Page } from 'playwright';

const baseUrl = (process.env.ANIMATION_AUDIT_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');

interface RenderingMetrics {
  active: boolean;
  pauseReason: string;
  quality: string;
  dpr: number;
  particleCount: number;
  particleCap: number;
  renderedFrames: number;
  averageRenderMs: number;
  averageFrameIntervalMs: number;
  maxFrameIntervalMs: number;
  maxConsecutiveSlowFrames: number;
}

interface ProfileResult {
  cpuRate: number;
  fixtureId: string;
  rendering: RenderingMetrics;
  longTasks: number[];
  hiddenPaused: boolean;
  hiddenClockPaused: boolean;
  coveredPaused: boolean;
  unrelatedUpdatePreservedPlayback: boolean;
  finalScoreMatches: boolean;
  closedUnmountedCanvas: boolean;
  rapidReopenCount: number;
  nextBatchReset: boolean;
  errors: string[];
}

type AuditWindow = Window & {
  __gameStore?: { getState: () => Record<string, unknown> };
  render_game_to_text?: () => string;
  __animationLongTasks?: number[];
};

async function installLongTaskObserver(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const target = window as AuditWindow;
    target.__animationLongTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) target.__animationLongTasks?.push(entry.duration);
    }).observe({ type: 'longtask', buffered: true });
  });
}

async function readRendering(page: Page): Promise<RenderingMetrics> {
  return page.evaluate(() => {
    const render = (window as AuditWindow).render_game_to_text;
    if (!render) throw new Error('Pitch debug bridge unavailable');
    return JSON.parse(render()).rendering as RenderingMetrics;
  });
}

async function openFirstLiveMatch(page: Page): Promise<{ fixtureId: string; expectedHome: number; expectedAway: number }> {
  await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean((window as AuditWindow).__gameStore));
  const expected = await page.evaluate(async () => {
    const store = (window as AuditWindow).__gameStore;
    const state = store?.getState() as {
      newGame: (seed: number) => void;
      getCurrentWindow: () => { fixtures: Array<{ id: string }> } | null;
      toggleStarFixture: (id: string) => void;
      advanceWindow: () => Promise<void>;
      lastResults: Array<{
        fixtureId: string;
        events: Array<{ type: string; teamId: string }>;
        homeTeamId: string;
      }>;
    };
    state.newGame(20260716);
    let current = state.getCurrentWindow();
    for (let step = 0; step < 5 && !current?.fixtures.length; step++) {
      await state.advanceWindow();
      current = state.getCurrentWindow();
    }
    const fixture = current?.fixtures[0];
    if (!fixture) throw new Error('No fixture available');
    state.toggleStarFixture(fixture.id);
    await state.advanceWindow();
    const latest = store?.getState() as typeof state;
    const result = latest.lastResults.find(row => row.fixtureId === fixture.id);
    if (!result) throw new Error('Starred result missing');
    const scoreEvents = result.events.filter(event => event.type === 'goal' || event.type === 'own_goal');
    return {
      fixtureId: fixture.id,
      expectedHome: scoreEvents.filter(event => event.teamId === result.homeTeamId).length,
      expectedAway: scoreEvents.filter(event => event.teamId !== result.homeTeamId).length,
    };
  });
  await page.getByRole('dialog', { name: '比赛直播回放' }).waitFor({ state: 'visible' });
  return expected;
}

async function runProfile(cpuRate: number): Promise<ProfileResult> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
  });
  await installLongTaskObserver(context);
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  const errors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  const cdp = await context.newCDPSession(page);

  try {
    const expected = await openFirstLiveMatch(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
    await page.evaluate(() => { (window as AuditWindow).__animationLongTasks = []; });
    const dialog = page.getByRole('dialog', { name: '比赛直播回放' });
    await dialog.getByRole('button', { name: '4x' }).click();
    await page.waitForTimeout(1800);
    const rendering = await readRendering(page);

    const beforeUnrelated = await page.locator('[data-testid="live-minute"]').textContent();
    const framesBeforeUnrelated = rendering.renderedFrames;
    await page.evaluate(() => {
      const state = (window as AuditWindow).__gameStore?.getState() as { setFavoriteTeams: (ids: string[]) => void };
      state.setFavoriteTeams(['gz_hengda']);
    });
    await page.waitForTimeout(150);
    const afterUnrelated = await page.locator('[data-testid="live-minute"]').textContent();
    const framesAfterUnrelated = (await readRendering(page)).renderedFrames;
    const unrelatedUpdatePreservedPlayback = Number.parseInt(afterUnrelated ?? '0', 10) >= Number.parseInt(beforeUnrelated ?? '0', 10)
      && framesAfterUnrelated > framesBeforeUnrelated;

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(100);
    const hiddenStart = await readRendering(page);
    const hiddenStartMinute = await page.locator('[data-testid="live-minute"]').textContent();
    await page.waitForTimeout(250);
    const hidden = await readRendering(page);
    const hiddenMinute = await page.locator('[data-testid="live-minute"]').textContent();
    const hiddenPaused = hidden.renderedFrames === hiddenStart.renderedFrames && hidden.pauseReason === 'hidden';
    const hiddenClockPaused = hiddenMinute === hiddenStartMinute;
    await page.evaluate(() => {
      delete (document as Document & Record<string, unknown>).visibilityState;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(150);

    const canvas = dialog.getByTestId('pitch-canvas');
    await canvas.evaluate(element => { (element as HTMLElement).style.display = 'none'; });
    await page.waitForTimeout(150);
    const coveredStart = await readRendering(page);
    await page.waitForTimeout(200);
    const coveredEnd = await readRendering(page);
    const coveredPaused = coveredStart.pauseReason === 'covered'
      && coveredEnd.renderedFrames === coveredStart.renderedFrames;
    await canvas.evaluate(element => { (element as HTMLElement).style.display = ''; });
    await page.waitForTimeout(150);

    await dialog.getByRole('button', { name: /跳过/ }).click();
    const homeScore = Number(await page.locator('[aria-label="主队比分"]').textContent());
    const awayScore = Number(await page.locator('[aria-label="客队比分"]').textContent());
    const finalScoreMatches = homeScore === expected.expectedHome && awayScore === expected.expectedAway;
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    const closedUnmountedCanvas = await page.evaluate(() => !(window as AuditWindow).render_game_to_text);

    let rapidReopenCount = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      const replay = page.getByRole('button', { name: '观看直播回放', exact: true }).first();
      await replay.click();
      await dialog.waitFor({ state: 'visible' });
      if (await page.getByRole('dialog', { name: '比赛直播回放' }).count() === 1) rapidReopenCount++;
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
    }

    const nextFixtureId = await page.evaluate(async () => {
      const state = (window as AuditWindow).__gameStore?.getState() as {
        getCurrentWindow: () => { fixtures: Array<{ id: string }> } | null;
        toggleStarFixture: (id: string) => void;
        advanceWindow: () => Promise<void>;
      };
      let current = state.getCurrentWindow();
      for (let step = 0; step < 5 && !current?.fixtures.length; step++) {
        await state.advanceWindow();
        current = state.getCurrentWindow();
      }
      const fixture = current?.fixtures[0];
      if (!fixture) throw new Error('No next fixture available');
      state.toggleStarFixture(fixture.id);
      await state.advanceWindow();
      return fixture.id;
    });
    await dialog.waitFor({ state: 'visible' });
    const nextBatchReset = await dialog.getAttribute('data-fixture-id') === nextFixtureId
      && await page.locator('[data-testid="live-minute"]').textContent() === "0'";

    const longTasks = await page.evaluate(() => (window as AuditWindow).__animationLongTasks ?? []);
    const passed = rendering.averageRenderMs < 20
      && rendering.averageFrameIntervalMs <= 33
      && rendering.maxConsecutiveSlowFrames <= 4
      && rendering.particleCount <= rendering.particleCap
      && hiddenPaused
      && hiddenClockPaused
      && coveredPaused
      && unrelatedUpdatePreservedPlayback
      && finalScoreMatches
      && closedUnmountedCanvas
      && rapidReopenCount === 2
      && nextBatchReset
      && errors.length === 0;
    const profile = {
      cpuRate,
      fixtureId: expected.fixtureId,
      rendering,
      longTasks,
      hiddenPaused,
      hiddenClockPaused,
      coveredPaused,
      unrelatedUpdatePreservedPlayback,
      finalScoreMatches,
      closedUnmountedCanvas,
      rapidReopenCount,
      nextBatchReset,
      errors,
    };
    if (!passed) throw new Error(`Animation profile failed at ${cpuRate}x CPU\n${JSON.stringify(profile, null, 2)}`);

    return profile;
  } finally {
    await browser.close();
  }
}

const profiles = [await runProfile(1), await runProfile(4)];
console.log(JSON.stringify({ passed: true, profiles }, null, 2));

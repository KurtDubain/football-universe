import { readFileSync, statSync } from 'node:fs';
import { chromium, type BrowserContext, type ConsoleMessage, type Page } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const assets = [
  { file: 'src/assets/visual/welcome-universe-v1.webp', maxBytes: 150 * 1024 },
  { file: 'src/assets/visual/story-dark-horse-v2.webp', maxBytes: 12 * 1024 },
  { file: 'src/assets/visual/story-giant-crisis-v2.webp', maxBytes: 12 * 1024 },
  { file: 'src/assets/visual/story-promoted-survival-v2.webp', maxBytes: 12 * 1024 },
  { file: 'src/assets/visual/live-scoreboard-v1.webp', maxBytes: 24 * 1024 },
  { file: 'src/assets/visual/season-archive-frame-v1.webp', maxBytes: 96 * 1024 },
  { file: 'src/assets/visual/key-match-opener-v1.webp', maxBytes: 96 * 1024 },
  { file: 'src/assets/visual/match-opener-domestic-cup-v1.webp', maxBytes: 96 * 1024 },
  { file: 'src/assets/visual/match-opener-continental-v1.webp', maxBytes: 96 * 1024 },
  { file: 'src/assets/visual/match-opener-world-v1.webp', maxBytes: 96 * 1024 },
  { file: 'src/assets/visual/champion-ceremony-v1.webp', maxBytes: 64 * 1024 },
  { file: 'src/assets/visual/world-moment-stage-v1.webp', maxBytes: 72 * 1024 },
  { file: 'src/assets/visual/world-moment-rise-v1.webp', maxBytes: 72 * 1024 },
  { file: 'src/assets/visual/world-moment-fall-v1.webp', maxBytes: 72 * 1024 },
  { file: 'src/assets/visual/world-moment-legacy-v1.webp', maxBytes: 72 * 1024 },
  { file: 'src/assets/visual/world-moment-transfer-v1.webp', maxBytes: 72 * 1024 },
] as const;

type AuditState = {
  world: { teamBases: Record<string, { expectation: number }> };
  newGame: (seed: number) => Promise<void>;
  setFavoriteTeams: (ids: string[]) => void;
  batchAdvance: (count: number) => Promise<boolean>;
  advanceUntil: (type: 'season_end') => Promise<boolean>;
  advanceWindow: () => Promise<boolean>;
  closeTransferWindow: (autoResolveRest: boolean) => void;
  getCurrentWindow: () => { fixtures: Array<{ id: string }> } | null;
  toggleStarFixture: (id: string) => void;
};

type AuditWindow = Window & {
  __gameStore?: {
    getState: () => AuditState;
    setState: (state: Record<string, unknown>) => void;
  };
  __visualMetrics?: { cls: number; longestTask: number };
};

function captureError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
}

async function installPerformanceProbe(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const metrics = { cls: 0, longestTask: 0 };
    (window as AuditWindow).__visualMetrics = metrics;
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
          if (!shift.hadRecentInput) metrics.cls += shift.value ?? 0;
        }
      }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          metrics.longestTask = Math.max(metrics.longestTask, entry.duration);
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch {
      // Older browsers still run the visual checks without performance entries.
    }
  });
}

async function createPage(context: BrowserContext): Promise<{ page: Page; errors: string[] }> {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', message => captureError(message, errors));
  page.on('pageerror', error => errors.push(error.message));
  return { page, errors };
}

async function verifyWelcome(
  context: BrowserContext,
  name: string,
): Promise<Record<string, unknown>> {
  const { page, errors } = await createPage(context);
  const startedAt = Date.now();
  await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
  const art = page.getByTestId('welcome-universe-art');
  await art.waitFor({ state: 'visible' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const metrics = await page.evaluate(() => {
    const image = document.querySelector('[data-testid="welcome-universe-art"]') as HTMLImageElement | null;
    const start = [...document.querySelectorAll('button')]
      .find(button => button.textContent?.trim() === '开始观察');
    const resource = performance.getEntriesByType('resource')
      .find(entry => entry.name.includes('welcome-universe')) as PerformanceResourceTiming | undefined;
    return {
      naturalWidth: image?.naturalWidth ?? 0,
      naturalHeight: image?.naturalHeight ?? 0,
      artRect: image?.getBoundingClientRect().toJSON(),
      startRect: start?.getBoundingClientRect().toJSON(),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      resourceBytes: resource?.decodedBodySize ?? 0,
      performance: (window as AuditWindow).__visualMetrics,
    };
  });
  if (metrics.naturalWidth !== 1440 || metrics.naturalHeight !== 960) {
    throw new Error(`${name}: Welcome art did not decode ${JSON.stringify(metrics)}`);
  }
  if (metrics.overflow > 1) throw new Error(`${name}: Welcome overflows by ${metrics.overflow}px`);
  if ((metrics.performance?.cls ?? 0) > 0.05) {
    throw new Error(`${name}: Welcome CLS is ${metrics.performance?.cls}`);
  }
  if ((metrics.performance?.longestTask ?? 0) > 120) {
    throw new Error(`${name}: Welcome long task is ${metrics.performance?.longestTask}ms`);
  }
  if (errors.length > 0) throw new Error(`${name}: runtime errors ${errors.join(' | ')}`);
  const screenshot = `/tmp/football-visual-welcome-${name}.png`;
  await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });
  await page.close();
  return {
    ...metrics,
    coldLoadMs: Date.now() - startedAt,
    screenshot,
  };
}

async function verifyFallbacks(): Promise<Record<string, unknown>> {
  const browser = await chromium.launch({ headless: true });
  try {
    const saveDataContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await saveDataContext.addInitScript(() => {
      Object.defineProperty(navigator, 'connection', {
        configurable: true,
        value: { saveData: true },
      });
    });
    const saveDataPage = await saveDataContext.newPage();
    await saveDataPage.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
    if (await saveDataPage.getByTestId('welcome-universe-art').count() !== 0) {
      throw new Error('Save-Data mode still mounted the Welcome artwork');
    }
    await saveDataPage.getByRole('button', { name: '开始观察' }).waitFor();
    await saveDataContext.close();

    const contrastContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      forcedColors: 'active',
    });
    const contrastPage = await contrastContext.newPage();
    await contrastPage.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
    const contrastDisplay = await contrastPage.getByTestId('welcome-universe-art')
      .evaluate(element => getComputedStyle(element).display);
    if (contrastDisplay !== 'none') throw new Error(`High contrast art display is ${contrastDisplay}`);
    await contrastPage.getByRole('button', { name: '开始观察' }).waitFor();
    await contrastContext.close();

    const failureContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await failureContext.route('**/*welcome-universe*.webp', route => route.abort());
    const failurePage = await failureContext.newPage();
    await failurePage.goto(`${baseUrl}/?audit=1`, { waitUntil: 'domcontentloaded' });
    await failurePage.waitForTimeout(250);
    if (await failurePage.getByTestId('welcome-universe-art').count() !== 0) {
      throw new Error('Broken Welcome artwork did not fall back to live content');
    }
    await failurePage.getByRole('button', { name: '开始观察' }).waitFor();
    await failureContext.close();

    return { saveData: true, forcedColors: true, failedRequest: true };
  } finally {
    await browser.close();
  }
}

async function waitForAuditStore(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as AuditWindow).__gameStore));
}

async function verifyStoryAndLive(context: BrowserContext): Promise<Record<string, unknown>> {
  const { page, errors } = await createPage(context);
  await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
  await waitForAuditStore(page);
  await page.evaluate(async () => {
    const store = (window as AuditWindow).__gameStore;
    if (!store) throw new Error('Audit store unavailable');
    await store.getState().newGame(20260718);
    const primary = Object.entries(store.getState().world.teamBases)
      .find(([, team]) => team.expectation <= 3)?.[0];
    if (primary) store.getState().setFavoriteTeams([primary]);
    await store.getState().batchAdvance(12);
  });
  await page.getByRole('tab', { name: '比赛日' }).click();
  const signals = page.getByTestId('storyline-signals');
  await signals.waitFor({ state: 'visible', timeout: 15_000 });
  const storyArt = signals.locator('[data-testid^="story-art-"]');
  const storyMetrics = await storyArt.evaluateAll(images => images.map(image => ({
    testId: image.getAttribute('data-testid'),
    naturalWidth: (image as HTMLImageElement).naturalWidth,
    rect: image.getBoundingClientRect().toJSON(),
  })));
  if (storyMetrics.length === 0 || storyMetrics.some(item => item.naturalWidth !== 256)) {
    throw new Error(`Story artwork did not decode ${JSON.stringify(storyMetrics)}`);
  }
  await signals.scrollIntoViewIfNeeded();
  const storyScreenshot = '/tmp/football-visual-story-mobile.png';
  await page.screenshot({ path: storyScreenshot, animations: 'disabled' });

  const focusSection = page.getByTestId('focus-matches');
  await focusSection.waitFor({ state: 'visible', timeout: 15_000 });
  const focusButton = focusSection.getByTestId('focus-watch-toggle').first();
  const focusButtonMetrics = await focusButton.evaluate(button => {
    const rect = button.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      visibleText: button.textContent?.trim() ?? '',
      label: button.getAttribute('aria-label'),
    };
  });
  if (
    focusButtonMetrics.width < 44
    || focusButtonMetrics.height < 44
    || focusButtonMetrics.visibleText !== ''
    || !focusButtonMetrics.label?.includes('无剧透观战')
  ) {
    throw new Error(`Focus-watch control is not polished ${JSON.stringify(focusButtonMetrics)}`);
  }
  await focusSection.scrollIntoViewIfNeeded();
  const focusScreenshot = '/tmp/football-focus-watch-mobile.png';
  await page.screenshot({ path: focusScreenshot, animations: 'disabled' });

  await page.getByRole('tab', { name: '战报' }).click();
  const momentFixtures = [
    { kind: 'stage', type: 'storyline', title: '洲际杯抽签之夜' },
    { kind: 'rise', type: 'promotion', title: '小球队完成升级奇迹' },
    { kind: 'fall', type: 'relegation', title: '传统劲旅跌入低谷' },
    { kind: 'legacy', type: 'retirement', title: '一代传奇正式谢幕' },
    { kind: 'transfer', type: 'rumor', title: '重磅谈判进入深夜' },
  ] as const;
  const momentMetrics: Array<Record<string, unknown>> = [];
  for (const moment of momentFixtures) {
    await page.evaluate((fixture) => {
      const store = (window as AuditWindow).__gameStore;
      if (!store) throw new Error('Audit store unavailable');
      store.setState({
        lastResults: [],
        lastWorldResponse: null,
        lastNews: [{
          id: `visual-${fixture.kind}`,
          seasonNumber: 4,
          windowIndex: 3,
          type: fixture.type,
          importance: 'major',
          title: fixture.title,
          description: '这一刻将被写入足球宇宙的赛季记录。',
        }],
      });
    }, moment);
    const feature = page.getByTestId('world-moment-feature');
    await feature.waitFor({ state: 'visible' });
    const metric = await feature.evaluate((element, expectedKind) => {
      const image = element.querySelector(`[data-testid="world-moment-art-${expectedKind}"]`) as HTMLImageElement | null;
      return {
        kind: element.getAttribute('data-moment-kind'),
        naturalWidth: image?.naturalWidth ?? 0,
        naturalHeight: image?.naturalHeight ?? 0,
        overflow: element.scrollWidth - element.clientWidth,
      };
    }, moment.kind);
    if (
      metric.kind !== moment.kind
      || metric.naturalWidth !== 1440
      || metric.naturalHeight !== 630
      || metric.overflow > 1
    ) {
      throw new Error(`World moment ${moment.kind} failed ${JSON.stringify(metric)}`);
    }
    await feature.scrollIntoViewIfNeeded();
    const screenshot = `/tmp/football-world-moment-${moment.kind}-mobile.png`;
    await page.screenshot({ path: screenshot, animations: 'disabled' });
    momentMetrics.push({ ...metric, screenshot });
  }

  await page.evaluate(async () => {
    const store = (window as AuditWindow).__gameStore;
    if (!store) throw new Error('Audit store unavailable');
    await store.getState().newGame(20260716);
    let current = store.getState().getCurrentWindow();
    for (let step = 0; step < 5 && !current?.fixtures.length; step++) {
      await store.getState().advanceWindow();
      current = store.getState().getCurrentWindow();
    }
    const fixture = current?.fixtures[0];
    if (!fixture) throw new Error('No live fixture available');
    store.getState().toggleStarFixture(fixture.id);
    await store.getState().advanceWindow();
  });
  const dialog = page.getByRole('dialog', { name: '比赛直播回放' });
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  const liveArt = dialog.getByTestId('live-scoreboard-art');
  await liveArt.waitFor();
  const liveMetrics = await dialog.evaluate(element => {
    const image = element.querySelector('[data-testid="live-scoreboard-art"]') as HTMLImageElement | null;
    const stage = element.querySelector('[data-testid="live-stage"]');
    const scoreLabels = [...element.querySelectorAll('[aria-label$="比分"]')];
    const modeGroup = element.querySelector('[role="group"][aria-label="播放模式"]');
    const groupRect = modeGroup?.getBoundingClientRect();
    const clippedModeButtons = groupRect
      ? [...modeGroup.querySelectorAll('button')].flatMap(button => {
          const rect = button.getBoundingClientRect();
          return rect.left < groupRect.left - 0.5 || rect.right > groupRect.right + 0.5
            ? [button.textContent?.trim() ?? '']
            : [];
        })
      : ['missing-mode-group'];
    return {
      naturalWidth: image?.naturalWidth ?? 0,
      stage: stage?.textContent?.trim(),
      scoreLabelCount: scoreLabels.length,
      clippedModeButtons,
      overflow: element.scrollWidth - element.clientWidth,
    };
  });
  if (
    liveMetrics.naturalWidth !== 1200
    || !liveMetrics.stage
    || liveMetrics.scoreLabelCount !== 2
    || liveMetrics.clippedModeButtons.length > 0
    || liveMetrics.overflow > 1
  ) {
    throw new Error(`Live-score presentation is incomplete ${JSON.stringify(liveMetrics)}`);
  }
  const liveScreenshot = '/tmp/football-visual-live-mobile.png';
  await page.screenshot({ path: liveScreenshot, animations: 'disabled' });
  await page.keyboard.press('Escape');
  if (errors.length > 0) throw new Error(`Story/live runtime errors ${errors.join(' | ')}`);
  await page.close();
  return {
    storyMetrics,
    momentMetrics,
    focusButtonMetrics,
    liveMetrics,
    storyScreenshot,
    focusScreenshot,
    liveScreenshot,
  };
}

async function verifyArchive(context: BrowserContext): Promise<Record<string, unknown>> {
  const { page, errors } = await createPage(context);
  await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
  await waitForAuditStore(page);
  await page.evaluate(async () => {
    const store = (window as AuditWindow).__gameStore;
    if (!store) throw new Error('Audit store unavailable');
    await store.getState().newGame(20260718);
    const teamIds = Object.keys(store.getState().world.teamBases);
    store.getState().setFavoriteTeams(teamIds.slice(0, 1));
    if (!await store.getState().advanceUntil('season_end')) throw new Error('Season end unavailable');
    if (!await store.getState().advanceWindow()) throw new Error('Season archive unavailable');
    store.getState().closeTransferWindow(true);
  });
  await page.goto(`${baseUrl}/history?audit=1`, { waitUntil: 'networkidle' });
  await page.getByTestId('season-history-toggle').first().click();
  await page.getByTestId('toggle-season-detail').click();
  const archive = page.getByTestId('primary-team-season-trajectory');
  await archive.waitFor({ state: 'visible', timeout: 15_000 });
  await archive.scrollIntoViewIfNeeded();
  const archiveScreenshot = '/tmp/football-visual-archive-mobile.png';
  await page.screenshot({ path: archiveScreenshot, animations: 'disabled' });

  const frameLoadedBeforeExport = await page.evaluate(() => (
    performance.getEntriesByType('resource')
      .some(entry => entry.name.includes('season-archive-frame'))
  ));
  if (frameLoadedBeforeExport) throw new Error('Archive frame loaded before export was requested');

  const button = page.getByRole('button', { name: '保存档案图' });
  const exportStartedAt = Date.now();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15_000 }),
    button.click(),
  ]);
  const downloadPath = '/tmp/football-visual-season-archive.png';
  await download.saveAs(downloadPath);
  const frameLoadedAfterExport = await page.evaluate(() => (
    performance.getEntriesByType('resource')
      .some(entry => entry.name.includes('season-archive-frame'))
  ));
  if (!frameLoadedAfterExport) throw new Error('Archive frame did not load on export');

  const png = readFileSync(downloadPath);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (png.subarray(1, 4).toString('ascii') !== 'PNG' || width !== 1200 || height !== 1500) {
    throw new Error(`Archive export is invalid: ${width}x${height}`);
  }
  if (errors.length > 0) throw new Error(`Archive runtime errors ${errors.join(' | ')}`);
  await page.close();
  return {
    width,
    height,
    bytes: png.length,
    exportMs: Date.now() - exportStartedAt,
    frameLoadedBeforeExport,
    frameLoadedAfterExport,
    screenshot: archiveScreenshot,
    downloadPath,
  };
}

async function verifyOfflineWelcome(): Promise<Record<string, unknown>> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(async () => {
      if (!('serviceWorker' in navigator)) return false;
      await navigator.serviceWorker.ready;
      return true;
    }, null, { timeout: 15_000 });
    await page.reload({ waitUntil: 'networkidle' });
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const dimensions = await page.getByTestId('welcome-universe-art').evaluate(image => ({
      width: (image as HTMLImageElement).naturalWidth,
      height: (image as HTMLImageElement).naturalHeight,
    }));
    if (dimensions.width !== 1440 || dimensions.height !== 960) {
      throw new Error(`Offline Welcome art failed ${JSON.stringify(dimensions)}`);
    }
    return dimensions;
  } finally {
    await context.setOffline(false);
    await context.close();
    await browser.close();
  }
}

async function verifyMobileNetworkWelcome(): Promise<Record<string, unknown>> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  try {
    await session.send('Network.enable');
    await session.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: 200 * 1024,
      uploadThroughput: 100 * 1024,
      connectionType: 'cellular3g',
    });
    const startedAt = Date.now();
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const image = document.querySelector('[data-testid="welcome-universe-art"]');
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth === 1440;
    }, null, { timeout: 12_000 });
    const loadedMs = Date.now() - startedAt;
    const metrics = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      resourceBytes: (
        performance.getEntriesByType('resource')
          .find(entry => entry.name.includes('welcome-universe')) as PerformanceResourceTiming | undefined
      )?.decodedBodySize ?? 0,
    }));
    if (loadedMs > 8_000 || metrics.overflow > 1) {
      throw new Error(`Throttled Welcome failed ${loadedMs}ms ${JSON.stringify(metrics)}`);
    }
    return { profile: '1.6Mbps/150ms', loadedMs, ...metrics };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main(): Promise<void> {
  const assetReport = assets.map(asset => {
    const bytes = statSync(asset.file).size;
    if (bytes > asset.maxBytes) {
      throw new Error(`${asset.file} exceeds ${bytes}/${asset.maxBytes} bytes`);
    }
    return { ...asset, bytes };
  });

  const browser = await chromium.launch({ headless: true });
  const reports: Record<string, unknown> = {};
  try {
    for (const viewport of [
      { name: 'mobile-320', width: 320, height: 568 },
      { name: 'mobile', width: 390, height: 844 },
      { name: 'desktop', width: 1440, height: 900 },
    ]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.width < 640,
        hasTouch: viewport.width < 640,
        reducedMotion: viewport.name === 'mobile-320' ? 'reduce' : 'no-preference',
      });
      await installPerformanceProbe(context);
      reports[viewport.name] = await verifyWelcome(context, viewport.name);
      await context.close();
    }

    const gameContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      acceptDownloads: true,
    });
    reports.storyAndLive = await verifyStoryAndLive(gameContext);
    await gameContext.close();

    const archiveContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      acceptDownloads: true,
    });
    reports.archive = await verifyArchive(archiveContext);
    await archiveContext.close();
  } finally {
    await browser.close();
  }

  reports.fallbacks = await verifyFallbacks();
  reports.mobileNetwork = await verifyMobileNetworkWelcome();
  reports.offline = await verifyOfflineWelcome();
  console.log(JSON.stringify({ passed: true, assets: assetReport, reports }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

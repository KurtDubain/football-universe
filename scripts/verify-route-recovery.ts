import { writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const reportPath = process.env.VERIFY_REPORT ?? '/tmp/football-route-recovery.json';

type AuditWindow = Window & {
  __gameStore?: {
    getState: () => {
      initialized: boolean;
      newGame: (seed: number) => void;
    };
  };
};

async function initialize(page: Page): Promise<void> {
  await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean((window as AuditWindow).__gameStore));
  await page.evaluate(() => (window as AuditWindow).__gameStore!.getState().newGame(20260810));
  await page.getByTestId('observation-runway').waitFor();
  await page.locator('[data-route-loading="true"]').waitFor({ state: 'detached' });
}

async function navigateClient(page: Page, path: string): Promise<void> {
  await page.evaluate((nextPath) => {
    window.history.pushState({}, '', nextPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

async function verifyTransientRetry(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
  });
  let historyRequests = 0;
  await context.route(/\/assets\/History-.*\.js(?:\?.*)?$/, async route => {
    historyRequests += 1;
    if (historyRequests === 1) {
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  const page = await context.newPage();
  try {
    await initialize(page);
    await navigateClient(page, '/history');
    await page.getByRole('heading', { name: '历史荣誉' }).waitFor({ timeout: 8_000 });
    return {
      requests: historyRequests,
      recovered: historyRequests === 2,
      errorVisible: await page.getByTestId('route-resource-error').count() > 0,
    };
  } finally {
    await context.close();
  }
}

async function verifyOfflineRecovery(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const context = await browser.newContext({
    viewport: { width: 320, height: 568 },
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  try {
    await initialize(page);
    await context.setOffline(true);
    await navigateClient(page, '/chronicle');
    const failure = page.getByTestId('route-resource-error');
    await failure.waitFor({ timeout: 5_000 });
    const offlineTitle = await page.getByRole('heading', { name: '当前离线，页面资源尚未缓存' }).isVisible();
    const controlsSized = await failure.locator('button,summary').evaluateAll(elements => elements.every(element => {
      const rect = element.getBoundingClientRect();
      return rect.width >= 43.5 && rect.height >= 43.5;
    }));
    const record = await page.evaluate(() => JSON.parse(
      sessionStorage.getItem('football-universe-last-route-error') ?? 'null',
    ) as { routeId?: string; code?: string; attempts?: number } | null);
    const saveIntact = await page.evaluate(() => (window as AuditWindow).__gameStore!.getState().initialized);
    const loadingStopped = await page.locator('[data-route-loading="true"]').count() === 0;
    await page.screenshot({
      path: '/tmp/football-route-recovery-offline-320.png',
      animations: 'disabled',
    });

    await context.setOffline(false);
    await page.getByRole('button', { name: '重试当前页面' }).click();
    await page.getByRole('heading', { name: '编年史', exact: true }).first().waitFor({ timeout: 8_000 });
    await page.screenshot({
      path: '/tmp/football-route-recovery-restored-320.png',
      animations: 'disabled',
    });

    return {
      offlineTitle,
      controlsSized,
      record,
      saveIntact,
      loadingStopped,
      recoveredAfterOnline: true,
    };
  } finally {
    await context.close();
  }
}

async function verifyBoundedFailure(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
  });
  let requests = 0;
  await context.route(/\/assets\/Legends-.*\.js(?:\?.*)?$/, async route => {
    requests += 1;
    await route.abort('failed');
  });
  const page = await context.newPage();
  try {
    await initialize(page);
    await navigateClient(page, '/legends');
    await page.getByTestId('route-resource-error').waitFor({ timeout: 8_000 });
    const record = await page.evaluate(() => JSON.parse(
      sessionStorage.getItem('football-universe-last-route-error') ?? 'null',
    ) as { routeId?: string; code?: string; attempts?: number } | null);
    return { requests, record, bounded: record?.attempts === 2 && requests <= 2 };
  } finally {
    await context.close();
  }
}

async function verifySlowNetwork(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  try {
    await initialize(page);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 400,
      downloadThroughput: 50 * 1024,
      uploadThroughput: 20 * 1024,
      connectionType: 'cellular3g',
    });
    const startedAt = Date.now();
    await navigateClient(page, '/search');
    await page.getByRole('heading', { name: '高级搜索' }).waitFor({ timeout: 10_000 });
    const elapsedMs = Date.now() - startedAt;
    const routeErrorVisible = await page.getByTestId('route-resource-error').count() > 0;
    const loadingStopped = await page.locator('[data-route-loading="true"]').count() === 0;
    await cdp.send('Network.disable');
    return {
      elapsedMs,
      loadedBeforeRouteTimeout: elapsedMs < 8_000,
      routeErrorVisible,
      loadingStopped,
    };
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const transient = await verifyTransientRetry(browser);
    const offline = await verifyOfflineRecovery(browser);
    const bounded = await verifyBoundedFailure(browser);
    const slowNetwork = await verifySlowNetwork(browser);
    const passed = transient.recovered
      && !transient.errorVisible
      && offline.offlineTitle
      && offline.controlsSized
      && offline.record?.code === 'offline'
      && offline.record.attempts === 1
      && offline.saveIntact
      && offline.loadingStopped
      && offline.recoveredAfterOnline
      && bounded.bounded
      && slowNetwork.loadedBeforeRouteTimeout
      && !slowNetwork.routeErrorVisible
      && slowNetwork.loadingStopped;
    const report = {
      passed,
      transient,
      offline,
      bounded,
      slowNetwork,
      screenshots: [
        '/tmp/football-route-recovery-offline-320.png',
        '/tmp/football-route-recovery-restored-320.png',
      ],
    };
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    if (!passed) process.exitCode = 1;
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

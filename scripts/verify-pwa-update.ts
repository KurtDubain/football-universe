import { readFileSync } from 'node:fs';
import { chromium, type ConsoleMessage } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const packageVersion = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
}).version;
const auditBuildId = 'new-deployment-audit';

function collectError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
}

async function main(): Promise<void> {
  const deployedVersionResponse = await fetch(`${baseUrl}/version.json`, { cache: 'no-store' });
  if (!deployedVersionResponse.ok) {
    throw new Error(`version.json returned ${deployedVersionResponse.status}`);
  }
  const deployedVersion = await deployedVersionResponse.json() as { version?: string; buildId?: string };
  if (deployedVersion.version !== packageVersion || !deployedVersion.buildId) {
    throw new Error(`Invalid deployed version payload: ${JSON.stringify(deployedVersion)}`);
  }

  const serviceWorkerResponse = await fetch(`${baseUrl}/sw.js`, { cache: 'no-store' });
  if (!serviceWorkerResponse.ok) throw new Error(`sw.js returned ${serviceWorkerResponse.status}`);
  const serviceWorkerSource = await serviceWorkerResponse.text();
  if (serviceWorkerSource.includes('version.json')) {
    throw new Error('version.json must bypass the Service Worker precache');
  }
  if (serviceWorkerSource.includes('og-image.png')) {
    throw new Error('The social preview image must not delay the PWA precache install');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    const count = Number.parseInt(sessionStorage.getItem('pwa-update-document-count') ?? '0', 10);
    sessionStorage.setItem('pwa-update-document-count', String(count + 1));
  });
  let remoteBuildId = deployedVersion.buildId;
  await context.route('**/version.json?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Cache-Control': 'no-store' },
    body: JSON.stringify({ version: packageVersion, buildId: remoteBuildId }),
  }));

  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', message => collectError(message, errors));
  page.on('pageerror', error => errors.push(error.message));

  try {
    await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean((window as typeof window & {
      __appUpdateAudit?: unknown;
    }).__appUpdateAudit));
    await page.waitForFunction(() => Boolean((window as typeof window & {
      __appUpdateAudit?: { getState: () => { registered: boolean } };
    }).__appUpdateAudit?.getState().registered));
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(expectedBuildId => (
      (window as typeof window & {
        __appUpdateAudit?: { getState: () => { lastRemoteBuildId: string | null } };
      }).__appUpdateAudit?.getState().lastRemoteBuildId === expectedBuildId
    ), deployedVersion.buildId);

    await page.getByRole('button', { name: '开始观察' }).click();
    await page.getByTestId('observation-runway').waitFor({ timeout: 15_000 });
    await page.evaluate(() => {
      window.history.pushState({}, '', '/settings?audit=1');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.getByRole('heading', { name: '设置' }).waitFor();
    await page.getByTestId('check-app-update').click();
    await page.getByTestId('app-update-status').filter({ hasText: '已是最新版' }).waitFor();

    remoteBuildId = auditBuildId;
    await page.getByTestId('check-app-update').click();
    await page.waitForFunction(() => Number(sessionStorage.getItem('pwa-update-document-count')) === 2);
    await page.getByRole('heading', { name: '设置' }).waitFor();
    await page.waitForFunction(() => Boolean((window as typeof window & {
      __appUpdateAudit?: { getState: () => { registered: boolean } };
    }).__appUpdateAudit?.getState().registered));
    await page.getByTestId('app-update-status').filter({ hasText: `发现 v${packageVersion}` }).waitFor();
    await page.waitForFunction(expectedBuildId => {
      const monitor = (window as typeof window & {
        __appUpdateAudit?: {
          getState: () => { lastRemoteBuildId: string | null; completedUpdateRequests: number };
        };
      }).__appUpdateAudit?.getState();
      return monitor?.lastRemoteBuildId === expectedBuildId
        && monitor.completedUpdateRequests >= 1;
    }, auditBuildId);

    const auditState = await page.evaluate(() => ({
      monitor: (window as typeof window & {
        __appUpdateAudit?: { getState: () => unknown };
      }).__appUpdateAudit?.getState(),
      controlled: Boolean(navigator.serviceWorker.controller),
      documentCount: Number(sessionStorage.getItem('pwa-update-document-count')),
      overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    }));

    const monitor = auditState.monitor as {
      localVersion?: string;
      localBuildId?: string;
      registered?: boolean;
      updateRequests?: number;
      completedUpdateRequests?: number;
      lastRemoteVersion?: string;
      lastRemoteBuildId?: string;
    } | undefined;
    if (
      monitor?.localVersion !== packageVersion
      || monitor.lastRemoteVersion !== packageVersion
      || monitor.lastRemoteBuildId !== auditBuildId
      || !monitor.registered
      || (monitor.updateRequests ?? 0) < 1
      || (monitor.completedUpdateRequests ?? 0) < 1
      || auditState.documentCount !== 2
    ) {
      throw new Error(`Remote deployment was not detected: ${JSON.stringify(auditState)}`);
    }
    if (auditState.overflow > 1) throw new Error(`Mobile layout overflowed by ${auditState.overflow}px`);
    if (errors.length > 0) throw new Error(`Runtime errors: ${errors.join(' | ')}`);

    await page.screenshot({
      path: '/tmp/football-pwa-update-mobile.png',
      fullPage: false,
      animations: 'disabled',
    });
    console.log(JSON.stringify({
      deployedVersion,
      auditState,
      screenshot: '/tmp/football-pwa-update-mobile.png',
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

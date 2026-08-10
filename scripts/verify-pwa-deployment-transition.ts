import { createServer, type ServerResponse } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile, stat, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const newRoot = resolve(process.env.PWA_NEW_DIST ?? 'dist');

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function send(response: ServerResponse, status: number, body: Buffer, filePath: string): void {
  const basename = filePath.slice(filePath.lastIndexOf('/') + 1);
  const noStore = basename === 'index.html' || basename === 'sw.js' || basename === 'version.json';
  response.writeHead(status, {
    'Content-Type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream',
    'Cache-Control': noStore ? 'no-store' : 'public, max-age=31536000, immutable',
    ...(basename === 'sw.js' ? { 'Service-Worker-Allowed': '/' } : {}),
  });
  response.end(body);
}

async function readAsset(root: string, requestPath: string): Promise<{ body: Buffer; filePath: string }> {
  const safePath = normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  const candidate = join(root, safePath || 'index.html');
  try {
    if ((await stat(candidate)).isFile()) return { body: await readFile(candidate), filePath: candidate };
  } catch {
    // Client-side routes fall through to index.html.
  }
  const indexPath = join(root, 'index.html');
  return { body: await readFile(indexPath), filePath: indexPath };
}

function entryScript(indexHtml: string): string | null {
  return indexHtml.match(/<script[^>]+src="([^"]+)"/)?.[1] ?? null;
}

async function prepareOldBuild(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const providedRoot = process.env.PWA_OLD_DIST?.trim();
  if (providedRoot) {
    const root = resolve(providedRoot);
    await stat(join(root, 'index.html'));
    return { root, cleanup: async () => undefined };
  }

  const revision = process.env.PWA_OLD_REVISION?.trim() || 'HEAD^';
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'football-pwa-old-'));
  const sourceRoot = join(temporaryRoot, 'source');
  const archivePath = join(temporaryRoot, 'source.tar');
  await mkdir(sourceRoot);
  try {
    execFileSync('git', ['archive', '--format=tar', revision, '-o', archivePath], {
      cwd: repositoryRoot,
      stdio: 'pipe',
    });
    execFileSync('tar', ['-xf', archivePath, '-C', sourceRoot], { stdio: 'pipe' });
    await symlink(join(repositoryRoot, 'node_modules'), join(sourceRoot, 'node_modules'), 'dir');
    execFileSync('pnpm', ['build'], {
      cwd: sourceRoot,
      env: { ...process.env, GITHUB_SHA: `pwa-old-${revision.replace(/[^a-z0-9_-]/gi, '-')}` },
      stdio: 'pipe',
    });
    return {
      root: join(sourceRoot, 'dist'),
      cleanup: () => rm(temporaryRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

async function runTransition(oldRoot: string): Promise<void> {
  await stat(join(oldRoot, 'index.html'));
  await stat(join(newRoot, 'index.html'));
  const oldEntry = entryScript(await readFile(join(oldRoot, 'index.html'), 'utf8'));
  const newEntry = entryScript(await readFile(join(newRoot, 'index.html'), 'utf8'));
  if (!oldEntry || !newEntry || oldEntry === newEntry) {
    throw new Error(`Expected distinct old/new entry assets, received ${oldEntry} and ${newEntry}`);
  }

  let activeRoot = oldRoot;
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      const asset = await readAsset(activeRoot, path);
      send(response, 200, asset.body, asset.filePath);
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('PWA audit server did not expose a TCP port');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      await context.addInitScript(() => {
        const count = Number.parseInt(sessionStorage.getItem('pwa-audit-document-count') ?? '0', 10);
        sessionStorage.setItem('pwa-audit-document-count', String(count + 1));
      });
      const page = await context.newPage();
      const runtimeErrors: string[] = [];
      page.on('pageerror', error => runtimeErrors.push(error.message));
      page.on('console', message => {
        if (message.type() === 'error') runtimeErrors.push(message.text());
      });

      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: '开始观察' }).click();
      await page.getByTestId('observation-runway').waitFor({ timeout: 15_000 });
      await page.waitForTimeout(800);
      await page.evaluate(() => window.history.replaceState({}, '', '/?audit=1'));
      await page.evaluate(() => navigator.serviceWorker.ready);

      const savedBeforeUpdate = await page.evaluate(() => localStorage.getItem('football-universe-save'));
      await page.getByRole('button', { name: '打开导航菜单' }).click();
      await page.getByRole('dialog', { name: '足球联赛宇宙' }).waitFor();

      activeRoot = newRoot;
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await page.waitForTimeout(2_000);
      const heldDuringDialog = await page.getByRole('dialog', { name: '足球联赛宇宙' }).isVisible()
        && await page.evaluate(() => sessionStorage.getItem('pwa-audit-document-count') === '1');

      await page.keyboard.press('Escape');
      await page.waitForFunction(() => Number(sessionStorage.getItem('pwa-audit-document-count')) >= 2, null, {
        timeout: 20_000,
      });
      await page.waitForFunction(() => Boolean((window as Window & {
        __appUpdateAudit?: { getState: () => { localBuildId: string } };
      }).__appUpdateAudit), null, { timeout: 10_000 });
      await page.waitForTimeout(1_200);

      const documentCount = await page.evaluate(() => Number(sessionStorage.getItem('pwa-audit-document-count')));
      const auditState = await page.evaluate(() => (window as Window & {
        __appUpdateAudit?: { getState: () => unknown };
      }).__appUpdateAudit?.getState());
      const savedAfterUpdate = await page.evaluate(() => localStorage.getItem('football-universe-save'));
      const gameRestored = await page.getByTestId('observation-runway').isVisible();

      await page.evaluate(() => {
        window.history.pushState({}, '', '/history?audit=1');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await page.getByRole('heading', { name: '历史荣誉' }).waitFor({ timeout: 10_000 });
      const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
      const newEntryLoaded = resources.some(resource => resource.endsWith(newEntry));
      const oldEntryLoadedAfterReload = resources.some(resource => resource.endsWith(oldEntry));

      await page.evaluate(() => navigator.serviceWorker.ready);
      await context.setOffline(true);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
      const offlineHistory = await page.getByRole('heading', { name: '历史荣誉' }).isVisible();
      await context.setOffline(false);

      const passed = heldDuringDialog
        && documentCount === 2
        && gameRestored
        && savedBeforeUpdate !== null
        && savedAfterUpdate !== null
        && newEntryLoaded
        && !oldEntryLoadedAfterReload
        && offlineHistory
        && runtimeErrors.length === 0;
      const report = {
        passed,
        oldEntry,
        newEntry,
        heldDuringDialog,
        documentCount,
        gameRestored,
        savePresentBeforeUpdate: savedBeforeUpdate !== null,
        savePresentAfterUpdate: savedAfterUpdate !== null,
        newEntryLoaded,
        oldEntryLoadedAfterReload,
        offlineHistory,
        auditState,
        runtimeErrors,
      };
      console.log(JSON.stringify(report, null, 2));
      if (!passed) process.exitCode = 1;
    } finally {
      await context.close();
    }
  } finally {
    await browser?.close();
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
  }
}

async function main(): Promise<void> {
  const oldBuild = await prepareOldBuild();
  try {
    await runTransition(oldBuild.root);
  } finally {
    await oldBuild.cleanup();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

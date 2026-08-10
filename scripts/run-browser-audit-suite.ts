import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

type ServerKind = 'preview' | 'fixture' | 'none';

interface AuditCheck {
  script: string;
  server?: ServerKind;
}

interface ManagedServer {
  name: string;
  child: ChildProcess;
  log: () => string;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const previewUrl = process.env.AUDIT_PREVIEW_URL ?? 'http://127.0.0.1:4173';
const fixtureUrl = process.env.AUDIT_FIXTURE_URL ?? 'http://127.0.0.1:4174';

const SMOKE_CHECKS: AuditCheck[] = [
  { script: 'audit:current' },
  { script: 'verify:pwa-update' },
  { script: 'audit:advance-performance' },
  { script: 'verify:route-recovery' },
  { script: 'verify:mobile-routes' },
  { script: 'verify:cup-bracket' },
  { script: 'verify:match-tactics', server: 'fixture' },
];

const FULL_CHECKS: AuditCheck[] = [
  ...SMOKE_CHECKS,
  { script: 'audit:animation-performance' },
  { script: 'verify:match' },
  { script: 'verify:match-shootout', server: 'fixture' },
  { script: 'verify:match-set-pieces', server: 'fixture' },
  { script: 'verify:match-openers', server: 'fixture' },
  { script: 'verify:broadcast-experience' },
  { script: 'verify:match-explanation' },
  { script: 'verify:floating-advance' },
  { script: 'verify:ui-foundation' },
  { script: 'verify:world-cup-experience' },
  { script: 'verify:feedback' },
  { script: 'verify:pwa-transition', server: 'none' },
  { script: 'verify:visual-assets' },
  { script: 'verify:history-summary' },
  { script: 'verify:dashboard' },
  { script: 'verify:player-team' },
  { script: 'verify:player-performance' },
  { script: 'verify:club-story' },
  { script: 'verify:observer-foundation' },
  { script: 'verify:observer-onboarding' },
  { script: 'verify:observation-judgment' },
  { script: 'verify:storyline-signals' },
  { script: 'verify:world-response' },
  { script: 'verify:key-node' },
  { script: 'verify:observation-route' },
  { script: 'verify:observation-archive' },
  { script: 'verify:dashboard-focus' },
];

function appendTail(current: string, chunk: Buffer): string {
  return `${current}${chunk.toString()}`.slice(-30_000);
}

async function waitForUrl(url: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null) throw new Error(`Server exited before ${url} became ready.`);
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

async function startServer(name: string, args: string[], readyUrl: string): Promise<ManagedServer> {
  let output = '';
  const child = spawn(pnpm, args, {
    cwd: root,
    env: process.env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', chunk => { output = appendTail(output, chunk); });
  child.stderr?.on('data', chunk => { output = appendTail(output, chunk); });
  const managed = { name, child, log: () => output };
  try {
    await waitForUrl(readyUrl, child);
    return managed;
  } catch (error) {
    process.stderr.write(`\n${name} output:\n${output}\n`);
    throw error;
  }
}

async function stopServer(server: ManagedServer): Promise<void> {
  if (server.child.exitCode !== null || !server.child.pid) return;
  if (process.platform === 'win32') server.child.kill('SIGTERM');
  else process.kill(-server.child.pid, 'SIGTERM');
  await Promise.race([
    new Promise<void>(resolveExit => server.child.once('exit', () => resolveExit())),
    new Promise<void>(resolveTimeout => setTimeout(resolveTimeout, 2_000)),
  ]);
  if (server.child.exitCode === null) {
    if (process.platform === 'win32') server.child.kill('SIGKILL');
    else process.kill(-server.child.pid, 'SIGKILL');
  }
}

async function runCheck(check: AuditCheck): Promise<void> {
  const verifyUrl = check.server === 'fixture' ? fixtureUrl : previewUrl;
  const env = {
    ...process.env,
    AUDIT_URL: previewUrl,
    VERIFY_URL: verifyUrl,
    PERF_URL: `${previewUrl}/?audit=1`,
    ANIMATION_AUDIT_URL: previewUrl,
    SCREENSHOT_URL: previewUrl,
  };
  process.stdout.write(`\n[audit] ${check.script}\n`);
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    const child = spawn(pnpm, ['run', check.script], {
      cwd: root,
      env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', code => resolveExit(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`${check.script} failed with exit code ${exitCode}.`);
}

async function main(): Promise<void> {
  const suite = process.argv[2] ?? 'smoke';
  if (suite !== 'smoke' && suite !== 'full') {
    throw new Error(`Unknown browser audit suite: ${suite}. Use smoke or full.`);
  }
  const checks = suite === 'full' ? FULL_CHECKS : SMOKE_CHECKS;
  if (process.argv.includes('--list')) {
    process.stdout.write(`${checks.map(check => `${check.script} [${check.server ?? 'preview'}]`).join('\n')}\n`);
    return;
  }

  const servers: ManagedServer[] = [];
  try {
    servers.push(await startServer(
      'production preview',
      ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'],
      previewUrl,
    ));
    if (checks.some(check => check.server === 'fixture')) {
      servers.push(await startServer(
        'animation fixture server',
        ['exec', 'vite', '--host', '127.0.0.1', '--port', '4174', '--strictPort'],
        `${fixtureUrl}/scripts/fixtures/animation-preview.html`,
      ));
    }
    for (const check of checks) await runCheck(check);
  } catch (error) {
    for (const server of servers) {
      process.stderr.write(`\n${server.name} output:\n${server.log()}\n`);
    }
    throw error;
  } finally {
    for (const server of [...servers].reverse()) await stopServer(server);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

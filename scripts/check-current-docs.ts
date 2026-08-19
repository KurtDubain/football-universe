import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { APP_VERSION } from '../src/version';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const fail = (message: string): never => {
  throw new Error(`Documentation check failed: ${message}`);
};

const readme = read('README.md');
const currentStatus = read('docs/current-status.md');
const packageJson = JSON.parse(read('package.json')) as { version?: string };

if (packageJson.version !== APP_VERSION) fail('package.json and APP_VERSION differ');
if (!readme.includes(`Current release: **v${APP_VERSION}**`)) {
  fail(`README does not identify v${APP_VERSION} as the current release`);
}
if (!currentStatus.includes(`Current release: v${APP_VERSION}`)) {
  fail(`current-status.md does not identify v${APP_VERSION} as the current release`);
}
if (!readme.includes('docs/current-status.md')) fail('README does not link the active roadmap');

const productionFiles = execFileSync('find', [
  'src', '-type', 'f', '(', '-name', '*.ts', '-o', '-name', '*.tsx', ')',
  '!', '-name', '*.test.ts', '!', '-name', '*.test.tsx',
  '!', '-name', '*.spec.ts', '!', '-name', '*.spec.tsx',
], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const productionLines = productionFiles.reduce((sum, file) => (
  sum + readFileSync(resolve(root, file), 'utf8').split('\n').length
), 0);
const testFiles = execFileSync('find', [
  'src', '-type', 'f', '(',
  '-name', '*.test.ts', '-o', '-name', '*.test.tsx',
  '-o', '-name', '*.spec.ts', '-o', '-name', '*.spec.tsx',
  ')',
], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean).length;
const lineLabel = `${Math.floor(productionLines / 1_000)}k+`;
const testLabel = `${Math.floor(testFiles / 10) * 10}+`;

if (!readme.includes(`${lineLabel} production TypeScript lines`)) {
  fail(`README production size should use the current ${lineLabel} bucket`);
}
if (!readme.includes(`${testLabel} test files`)) {
  fail(`README test count should use the current ${testLabel} bucket`);
}

const historicalLedgers = [
  'docs/coach-tactics-formation-plan.md',
  'docs/contest-final-polish-checklist.md',
  'docs/data-chain-optimization-checklist.md',
  'docs/narrative-director-checklist.md',
  'docs/narrative-editorial-checklist.md',
  'docs/observer-gameplay-contest-checklist.md',
  'docs/star-player-presence-plan.md',
  'docs/ui-polish-checklist.md',
];
for (const ledger of historicalLedgers) {
  const header = read(ledger).split('\n').slice(0, 16).join('\n');
  if (!header.includes('current-status.md')) fail(`${ledger} is not marked as a historical ledger`);
}

console.log(
  `Documentation OK: v${APP_VERSION}, ${productionLines} production lines, `
  + `${productionFiles.length} production files, ${testFiles} test files`,
);

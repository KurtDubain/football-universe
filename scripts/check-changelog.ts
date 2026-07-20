import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CHANGELOG } from '../src/config/changelog';
import { APP_VERSION } from '../src/version';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version?: string };
const latest = CHANGELOG[0];

if (!latest) throw new Error('CHANGELOG must contain at least one release.');
if (latest.version !== APP_VERSION || pkg.version !== APP_VERSION) {
  throw new Error(
    `Version mismatch: changelog=${latest.version}, app=${APP_VERSION}, package=${pkg.version ?? 'missing'}`,
  );
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(latest.date) || latest.items.length === 0) {
  throw new Error('Latest changelog entry needs a YYYY-MM-DD date and at least one item.');
}

const base = process.env.CHANGELOG_BASE?.trim();
if (base && !/^0+$/.test(base)) {
  const changed = execFileSync('git', ['diff', '--name-only', base], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const userVisibleSourceChanged = changed.some(file =>
    file.startsWith('src/')
    && !file.endsWith('.test.ts')
    && !file.endsWith('.test.tsx')
    && file !== 'src/config/changelog.ts'
    && file !== 'src/version.ts'
  );

  if (userVisibleSourceChanged) {
    const required = ['package.json', 'src/config/changelog.ts', 'src/version.ts'];
    const missing = required.filter(file => !changed.includes(file));
    if (missing.length > 0) {
      throw new Error(`User-visible source changed without release files: ${missing.join(', ')}`);
    }
    const basePackage = JSON.parse(
      execFileSync('git', ['show', `${base}:package.json`], { cwd: root, encoding: 'utf8' }),
    ) as { version?: string };
    if (basePackage.version === APP_VERSION) {
      throw new Error(`User-visible source changed without a version bump from ${APP_VERSION}.`);
    }
  }
}

console.log(`Changelog OK: v${APP_VERSION} (${latest.items.length} items)`);

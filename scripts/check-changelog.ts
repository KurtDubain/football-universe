import { readFileSync } from 'node:fs';
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

console.log(`Changelog OK: v${APP_VERSION} (${latest.items.length} items)`);

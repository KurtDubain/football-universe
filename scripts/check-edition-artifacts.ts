import { readFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import assert from 'node:assert/strict';
import forbidden from './contest-forbidden-content.json';
const target = process.env.BUILD_TARGET ?? 'contest';
assert(['personal', 'contest', 'audit'].includes(target));
const root = join('dist', target);
const manifest = JSON.parse(readFileSync(join(root, 'build-manifest.json'), 'utf8'));
const version = JSON.parse(readFileSync(join(root, 'version.json'), 'utf8'));
assert.equal(manifest.target, target);
assert.equal(version.edition, target === 'contest' ? 'contest' : 'personal');
assert.equal(version.presetId, manifest.presetId);
assert(version.buildId.startsWith(version.edition + ':' + version.presetId + ':'));
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]);
}
const failures: string[] = [];
for (const file of files(root)) {
  if (file.endsWith('.map')) failures.push(file + ': sourcemap');
  if (![ '.html', '.js', '.json', '.svg', '.txt', '.xml', '.webmanifest', '.css' ].includes(extname(file))) continue;
  const text = readFileSync(file, 'utf8');
  const terms = target === 'contest' ? forbidden.terms : target === 'personal' ? ['__gameStore', '__appUpdateAudit'] : [];
  for (const term of terms) if (text.includes(term)) failures.push(file + ': ' + term);
}
if (target === 'contest') assert(!manifest.modules.some((m: string) => m.startsWith('edition/personal/') || m === 'pages/TeamEditor.tsx' || m === 'config/changelog.ts'));
assert.deepEqual(failures, []);
console.log(JSON.stringify({ target, version, files: files(root).length, modules: manifest.modules.length, passed: true }, null, 2));

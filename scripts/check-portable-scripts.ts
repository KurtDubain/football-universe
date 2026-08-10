import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const self = fileURLToPath(import.meta.url);
const personalPathPatterns = [
  /\/Users\/[^/]+\//g,
  /\/home\/[^/]+\//g,
  /[A-Za-z]:\\Users\\[^\\]+\\/g,
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return ['.ts', '.tsx', '.js', '.mjs'].includes(extname(path)) ? [path] : [];
  });
}

const violations: string[] = [];
for (const path of sourceFiles(resolve(root, 'scripts'))) {
  if (path === self) continue;
  const source = readFileSync(path, 'utf8');
  for (const pattern of personalPathPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(source)) violations.push(relative(root, path));
  }
}

if (violations.length > 0) {
  throw new Error(`Scripts contain machine-specific home paths: ${[...new Set(violations)].join(', ')}`);
}
console.log('Script portability OK: no machine-specific home paths.');

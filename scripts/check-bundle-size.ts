import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const manifestPath = 'dist/.vite/manifest.json';
const mainBudgetBytes = Number(process.env.MAIN_JS_BUDGET_BYTES ?? 500_000);
const initialBudgetBytes = Number(process.env.INITIAL_JS_BUDGET_BYTES ?? 700_000);
const reportPath = process.env.BUNDLE_REPORT;

type ManifestChunk = {
  file: string;
  imports?: string[];
  isEntry?: boolean;
  src?: string;
};

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, ManifestChunk>;
const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry);
if (!entryKey) throw new Error(`No entry chunk found in ${manifestPath}`);

const initialKeys = new Set<string>();
function collectStaticImports(key: string): void {
  if (initialKeys.has(key)) return;
  initialKeys.add(key);
  for (const dependency of manifest[key]?.imports ?? []) collectStaticImports(dependency);
}
collectStaticImports(entryKey);

const initialFiles = [...initialKeys].map((key) => manifest[key].file);
const chunks = initialFiles.map((file) => {
  const path = `dist/${file}`;
  const source = readFileSync(path);
  return { file, bytes: statSync(path).size, gzipBytes: gzipSync(source).length };
});
const initialBytes = chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
const initialGzipBytes = chunks.reduce((sum, chunk) => sum + chunk.gzipBytes, 0);
const entryChunk = chunks.find((chunk) => chunk.file === manifest[entryKey].file);
if (!entryChunk) throw new Error('Entry chunk was not included in the initial dependency graph');

const report = {
  entry: manifest[entryKey].src ?? entryKey,
  mainBudgetBytes,
  initialBudgetBytes,
  mainBytes: entryChunk.bytes,
  mainGzipBytes: entryChunk.gzipBytes,
  initialBytes,
  initialGzipBytes,
  passed: entryChunk.bytes <= mainBudgetBytes && initialBytes <= initialBudgetBytes,
  chunks,
};

console.log(JSON.stringify(report, null, 2));
if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) {
  throw new Error(
    `Bundle budget exceeded: main ${entryChunk.bytes}/${mainBudgetBytes} B, initial ${initialBytes}/${initialBudgetBytes} B`,
  );
}

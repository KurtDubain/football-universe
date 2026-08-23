import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { PRODUCTION_PERFORMANCE_BUDGETS } from '../src/config/performance-budgets';

const distPath = 'dist';
const manifestPath = join(distPath, '.vite', 'manifest.json');
const reportPath = process.env.BUNDLE_REPORT;
const imageExtensions = new Set(['.avif', '.jpeg', '.jpg', '.png', '.svg', '.webp']);

type ManifestChunk = {
  file: string;
  imports?: string[];
  isEntry?: boolean;
};

interface FileMetric {
  file: string;
  bytes: number;
  gzipBytes: number;
}

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function measureFile(path: string): FileMetric {
  const source = readFileSync(path);
  return {
    file: relative(distPath, path).replaceAll('\\', '/'),
    bytes: statSync(path).size,
    gzipBytes: gzipSync(source).length,
  };
}

function readPrecacheUrls(): string[] {
  const serviceWorkerPath = join(distPath, 'sw.js');
  const source = readFileSync(serviceWorkerPath, 'utf8');
  const start = source.indexOf('precacheAndRoute([');
  const end = source.indexOf('],{})', start);
  if (start < 0 || end < 0) throw new Error(`No Workbox precache manifest found in ${serviceWorkerPath}`);
  const manifestSource = source.slice(start, end);
  const urls = [...manifestSource.matchAll(/\burl:"((?:\\.|[^"])*)"/g)]
    .map(match => JSON.parse(`"${match[1]}"`) as string);
  if (urls.length === 0) throw new Error(`Workbox precache manifest is empty in ${serviceWorkerPath}`);
  return urls;
}

if (!existsSync(manifestPath)) throw new Error(`Missing ${manifestPath}; run pnpm build first`);

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, ManifestChunk>;
const entryKey = Object.keys(manifest).find(key => manifest[key].isEntry);
if (!entryKey) throw new Error(`No entry chunk found in ${manifestPath}`);

const initialKeys = new Set<string>();
function collectStaticImports(key: string): void {
  if (initialKeys.has(key)) return;
  initialKeys.add(key);
  for (const dependency of manifest[key]?.imports ?? []) collectStaticImports(dependency);
}
collectStaticImports(entryKey);

const initialChunks = [...initialKeys].map(key => measureFile(join(distPath, manifest[key].file)));
const entryChunk = initialChunks.find(chunk => chunk.file === manifest[entryKey].file);
if (!entryChunk) throw new Error('Entry chunk was not included in the initial dependency graph');

const initialJs = initialChunks.reduce((total, chunk) => ({
  bytes: total.bytes + chunk.bytes,
  gzipBytes: total.gzipBytes + chunk.gzipBytes,
}), { bytes: 0, gzipBytes: 0 });

const deployedFiles = listFiles(distPath);
const cssFiles = deployedFiles.filter(path => extname(path) === '.css').map(measureFile);
const css = cssFiles.reduce((total, file) => ({
  bytes: total.bytes + file.bytes,
  gzipBytes: total.gzipBytes + file.gzipBytes,
}), { bytes: 0, gzipBytes: 0 });

const deployedImages = deployedFiles
  .filter(path => imageExtensions.has(extname(path).toLowerCase()))
  .map(measureFile);
const appImages = deployedImages.filter(image => !/^og-image\./.test(basename(image.file)));
const deployedImageBytes = deployedImages.reduce((sum, image) => sum + image.bytes, 0);
const appImageBytes = appImages.reduce((sum, image) => sum + image.bytes, 0);
const largestAppImage = appImages.reduce<FileMetric | null>(
  (largest, image) => !largest || image.bytes > largest.bytes ? image : largest,
  null,
);

const precacheUrls = readPrecacheUrls();
const uniquePrecacheUrls = [...new Set(precacheUrls)];
const missingPrecacheFiles: string[] = [];
const precacheBytes = uniquePrecacheUrls.reduce((sum, url) => {
  const path = join(distPath, url.replace(/^\/+/, '').split('?')[0]);
  if (!existsSync(path)) {
    missingPrecacheFiles.push(url);
    return sum;
  }
  return sum + statSync(path).size;
}, 0);

const budgets = PRODUCTION_PERFORMANCE_BUDGETS;
const checks = [
  ['entry JS bytes', entryChunk.bytes, budgets.entryJs.bytes],
  ['entry JS gzip bytes', entryChunk.gzipBytes, budgets.entryJs.gzipBytes],
  ['initial JS bytes', initialJs.bytes, budgets.initialJs.bytes],
  ['initial JS gzip bytes', initialJs.gzipBytes, budgets.initialJs.gzipBytes],
  ['CSS bytes', css.bytes, budgets.css.bytes],
  ['CSS gzip bytes', css.gzipBytes, budgets.css.gzipBytes],
  ['application image bytes', appImageBytes, budgets.images.appBytes],
  ['deployed image bytes', deployedImageBytes, budgets.images.deployedBytes],
  ['largest application image bytes', largestAppImage?.bytes ?? 0, budgets.images.singleAppAssetBytes],
  ['PWA precache entries', precacheUrls.length, budgets.pwaPrecache.entries],
  ['PWA precache bytes', precacheBytes, budgets.pwaPrecache.bytes],
] as const;
const violations = checks
  .filter(([, actual, budget]) => actual > budget)
  .map(([label, actual, budget]) => `${label}: ${actual} > ${budget}`);
if (missingPrecacheFiles.length > 0) {
  violations.push(`PWA precache references missing files: ${missingPrecacheFiles.join(', ')}`);
}
if (precacheUrls.length !== uniquePrecacheUrls.length) {
  violations.push(`PWA precache contains ${precacheUrls.length - uniquePrecacheUrls.length} duplicate entries`);
}
if (cssFiles.length === 0) violations.push('Production build contains no CSS assets');
if (appImages.length === 0) violations.push('Production build contains no application images');

const report = {
  passed: violations.length === 0,
  budgets,
  measurements: {
    entryJs: { bytes: entryChunk.bytes, gzipBytes: entryChunk.gzipBytes, file: entryChunk.file },
    initialJs: { ...initialJs, chunks: initialChunks.length },
    css: { ...css, files: cssFiles.length },
    images: {
      appBytes: appImageBytes,
      deployedBytes: deployedImageBytes,
      files: deployedImages.length,
      largestAppAsset: largestAppImage,
    },
    pwaPrecache: {
      entries: precacheUrls.length,
      uniqueEntries: uniquePrecacheUrls.length,
      bytes: precacheBytes,
    },
  },
  violations,
  initialChunks,
};

console.log(JSON.stringify(report, null, 2));
if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) throw new Error(`Production performance budget exceeded\n${violations.join('\n')}`);

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import type { resolveBuildTarget } from './build-target';
import { DEFAULT_PERSONAL_SITE_URL } from './build-target';

export function editionPlugin(config: ReturnType<typeof resolveBuildTarget>): Plugin {
  return {
    name: 'football-edition-boundary',
    enforce: 'pre',
    resolveId(source, importer) {
      const path = source.startsWith('.') && importer ? resolve(importer, '..', source) : source;
      if (path.replace(/\.ts$/, '') === resolve('src/edition/preset')) return resolve('src/edition', config.edition, 'index.ts');
      if (path.replace(/\.ts$/, '') === resolve('src/edition/coach-names')) return resolve('src/edition', config.edition, 'coaches.json');
      if (config.edition === 'contest') {
        if (path.replace(/\.tsx?$/, '') === resolve('src/pages/TeamEditor')) return resolve('src/edition/contest/UnavailableEditor.tsx');
        if (path.replace(/\.ts$/, '') === resolve('src/config/changelog')) return resolve('src/edition/contest/changelog.ts');
      }
    },
    transformIndexHtml(html) {
      const siteHtml = html.replaceAll(DEFAULT_PERSONAL_SITE_URL, config.siteUrl);
      if (config.edition !== 'contest') return siteHtml;
      return siteHtml
        .replaceAll('电子斗蛐蛐', '三岸纪')
        .replace(/<meta name="keywords"[^>]*>/, '')
        .replace(/,\s*"url": "https:\/\/github.com\/KurtDubain"/, '');
    },
    generateBundle() {
      const modules = [...this.getModuleIds()].filter(id => id.includes('/src/')).map(id => id.split('/src/')[1]).sort();
      if (config.edition === 'contest' && modules.some(id => id.startsWith('edition/personal/') || id === 'config/changelog.ts' || id === 'pages/TeamEditor.tsx')) {
        throw new Error('Personal-only module entered contest dependency graph');
      }
      this.emitFile({ type: 'asset', fileName: 'build-manifest.json', source: JSON.stringify({ ...config, modules }, null, 2) });
      if (config.edition !== 'contest') {
        if (config.siteUrl !== DEFAULT_PERSONAL_SITE_URL) {
          for (const file of ['robots.txt', 'sitemap.xml']) {
            this.emitFile({ type: 'asset', fileName: file, source: readFileSync(resolve('public', file), 'utf8').replaceAll(DEFAULT_PERSONAL_SITE_URL, config.siteUrl) });
          }
        }
        return;
      }
      for (const file of ['favicon.svg', 'icon-192.png', 'icon-512.png', 'icons.svg']) {
        this.emitFile({ type: 'asset', fileName: file, source: readFileSync(resolve('public', file)) });
      }
      this.emitFile({ type: 'asset', fileName: 'og-image.png', source: readFileSync(resolve('src/edition/contest/og-image.png')) });
      this.emitFile({ type: 'asset', fileName: 'LICENSE.txt', source: readFileSync(resolve('LICENSE')) });
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: 'User-agent: *\nAllow: /\nSitemap: ' + config.siteUrl + '/sitemap.xml\n' });
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>' + config.siteUrl + '/</loc></url></urlset>' });
    },
  };
}

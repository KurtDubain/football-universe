import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  for (const base of ['public/og-image', 'src/edition/contest/og-image']) {
    await page.setContent('<style>body{margin:0}</style>' + readFileSync(base + '.svg', 'utf8'));
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: base + '.png' });
  }
  for (const size of process.argv.includes('--og-only') ? [] : [192, 512]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent('<style>body{margin:0}svg{display:block;width:100%;height:100%}</style>' + readFileSync('public/favicon.svg', 'utf8'));
    await page.screenshot({ path: `public/icon-${size}.png`, omitBackground: true });
  }
} finally { await browser.close(); }

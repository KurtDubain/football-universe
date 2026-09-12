import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent('<style>body{margin:0}</style>' + readFileSync('src/edition/contest/og-image.svg', 'utf8'));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'src/edition/contest/og-image.png' });
} finally { await browser.close(); }

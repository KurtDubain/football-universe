import { chromium } from 'playwright';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
const root = 'src/assets/visual';
const files = readdirSync(root).filter(f => f.endsWith('.webp'));
mkdirSync('output/playwright/editions', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1500 } });
  await page.setContent('<style>body{background:#eee;font:12px sans-serif;display:grid;grid-template-columns:repeat(3,1fr);gap:16px}img{width:100%;height:180px;object-fit:contain;background:#111}figure{margin:0}</style>' + files.map(file => '<figure><img src="data:image/webp;base64,' + readFileSync(root + '/' + file).toString('base64') + '"><figcaption>' + file + '</figcaption></figure>').join(''));
  await page.evaluate(() => Promise.all(Array.from(document.images, image => image.decode())));
  await page.screenshot({ path: 'output/playwright/editions/shared-assets.png', fullPage: true });
} finally { await browser.close(); }

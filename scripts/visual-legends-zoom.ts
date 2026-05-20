import { chromium } from 'playwright';
import * as fs from 'fs';

const URL = 'http://localhost:5173/';
const SAVE = JSON.parse(fs.readFileSync('/Users/mutu/Downloads/football-universe-s16.json', 'utf8'));

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.evaluate(`
    localStorage.clear();
    localStorage.setItem('football-universe-save', ${JSON.stringify(JSON.stringify(SAVE))});
  `);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  for (let i = 0; i < 50; i++) {
    const btn = await page.$('button:has-text("推进"), button:has-text("开始模拟")');
    if (!btn) break;
    const txt = await btn.textContent();
    if (!txt || txt.includes('赛季已结束') || txt.includes('模拟中')) break;
    await btn.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(2000);
  await page.goto(URL + 'legends', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/visual-legends-top.png', fullPage: false });
  // scroll to coach candidate section
  await page.evaluate(`window.scrollTo(0, document.body.scrollHeight)`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/visual-legends-bottom.png', fullPage: false });
  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });

import { chromium } from 'playwright';
import * as fs from 'fs';

const URL = 'http://localhost:5173/';
const SAVE = JSON.parse(fs.readFileSync('/Users/mutu/Downloads/football-universe-s16.json', 'utf8'));

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`PAGE: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.evaluate(`
    localStorage.clear();
    localStorage.setItem('football-universe-save', ${JSON.stringify(JSON.stringify(SAVE))});
  `);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // Advance ~30 windows
  for (let i = 0; i < 35; i++) {
    try {
      const btn = await page.$('button:has-text("推进"), button:has-text("开始模拟")');
      if (!btn) break;
      const txt = await btn.textContent();
      if (!txt || txt.includes('赛季已结束') || txt.includes('模拟中')) break;
      await btn.click({ timeout: 1500 });
      await page.waitForTimeout(150);
    } catch { break; }
  }
  await page.waitForTimeout(1500);

  const state = await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    if (!raw) return null;
    var data = JSON.parse(raw);
    var w = data.state.world;
    var injCount = 0, susCount = 0;
    for (var tid of Object.keys(w.squads)) {
      for (var p of w.squads[tid]) {
        if ((p.injuredUntilWindow ?? 0) > w.totalElapsedWindows) injCount++;
        if ((p.suspendedUntilWindow ?? 0) > w.totalElapsedWindows) susCount++;
      }
    }
    return {
      version: data.version,
      season: w.seasonState.seasonNumber,
      totalElapsedWindows: w.totalElapsedWindows,
      activeInjuries: injCount,
      activeSuspensions: susCount,
    };
  })()`);
  console.log('=== STATE ===', JSON.stringify(state, null, 2));

  await page.goto(URL + 'team/gz_hengda', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/g-team-injury-board.png', fullPage: false });

  console.log('=== ERRORS ===', errors.length === 0 ? 'NONE' : errors.join('\n'));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

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
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`CON: ${m.text()}`); });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.evaluate(`
    localStorage.clear();
    localStorage.setItem('football-universe-save', ${JSON.stringify(JSON.stringify(SAVE))});
  `);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // Set favorite team via store (so we get window)
  await page.evaluate(`(() => {
    var s = (window).__gameStore;
    if (!s) return;
    var w = s.getState().world;
    var top = Object.keys(w.teamBases).sort(function(a,b){return w.teamBases[b].overall - w.teamBases[a].overall;})[0];
    s.getState().setFavoriteTeams([top]);
  })()`);
  await page.waitForTimeout(500);

  // Advance through season to season_end
  for (let i = 0; i < 80; i++) {
    const btn = await page.$('button:has-text("推进"), button:has-text("开始模拟")');
    if (!btn) break;
    const t = await btn.textContent();
    if (!t || t.includes('赛季已结束') || t.includes('模拟中')) break;
    await btn.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(1000);

  // Check current location + window state
  const state = await page.evaluate(`(() => {
    var s = (window).__gameStore;
    var w = s.getState().world;
    return {
      url: window.location.pathname,
      transferWindow: w.transferWindow ? {
        season: w.transferWindow.season,
        status: w.transferWindow.status,
        offers: w.transferWindow.incomingOffers.length,
        targets: w.transferWindow.outgoingTargets.length,
        pool: w.transferWindow.freeAgentUuids.length,
      } : null,
      season: w.seasonState.seasonNumber,
      windowIdx: w.seasonState.currentWindowIndex,
    };
  })()`);
  console.log('=== After advancing ===');
  console.log(JSON.stringify(state, null, 2));

  await page.screenshot({ path: '/tmp/market-window.png', fullPage: true });

  console.log('\n=== ERRORS ===');
  console.log(errors.length === 0 ? 'NONE' : errors.join('\n'));
  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });

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

  // Advance until rumors start firing (window 37+ of 47)
  for (let i = 0; i < 80; i++) {
    const btn = await page.$('button:has-text("推进"), button:has-text("开始模拟")');
    if (!btn) break;
    const t = await btn.textContent();
    if (!t || t.includes('赛季已结束') || t.includes('模拟中')) break;
    await btn.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(50);
    // Check if we have rumors yet
    if (i > 20 && i % 8 === 0) {
      const rumorCount = await page.evaluate(`(() => {
        var raw = localStorage.getItem('football-universe-save');
        var data = JSON.parse(raw);
        return (data.state.world.transferRumors || []).length;
      })()`);
      if (rumorCount > 0) break;
    }
  }
  await page.waitForTimeout(1500);

  const state = await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    var data = JSON.parse(raw);
    var w = data.state.world;
    return {
      season: w.seasonState.seasonNumber,
      window: w.seasonState.currentWindowIndex,
      rumorCount: (w.transferRumors || []).length,
      rumors: (w.transferRumors || []).slice(-8),
    };
  })()`);
  console.log('=== Transfer Rumors ===');
  console.log('Season:', state.season, 'Window:', state.window);
  console.log('Rumors:', state.rumorCount);
  for (const r of state.rumors) {
    console.log(`  [${r.intensity.padEnd(6)}] ${r.eliteTeamName} 对 ${r.candidateName} (${r.candidatePosition}) @ ${r.fromTeamName}`);
  }

  // Screenshot dashboard if any rumor for favorite team
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/dashboard-rumors.png', fullPage: false });

  // Visit a player to see rivals section
  const playerId = await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    var data = JSON.parse(raw);
    var sq = data.state.world.squads['gz_hengda'] || [];
    var top = sq.sort(function(a, b) { return b.rating - a.rating; })[0];
    return top ? top.uuid : null;
  })()`);
  if (playerId) {
    await page.goto(URL + 'player/' + playerId, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: '/tmp/player-rivals.png', fullPage: true });
  }

  console.log('\n=== ERRORS ===');
  console.log(errors.length === 0 ? 'NONE' : errors.join('\n'));
  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });

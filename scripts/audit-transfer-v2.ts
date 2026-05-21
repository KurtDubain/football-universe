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

  // Load s16 save, advance 3 seasons
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.evaluate(`
    localStorage.clear();
    localStorage.setItem('football-universe-save', ${JSON.stringify(JSON.stringify(SAVE))});
  `);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  for (let i = 0; i < 200; i++) {
    const btn = await page.$('button:has-text("推进"), button:has-text("开始模拟")');
    if (!btn) break;
    const t = await btn.textContent();
    if (!t || t.includes('赛季已结束') || t.includes('模拟中')) break;
    await btn.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(1500);

  // Analyze transfers
  const stats = await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    var data = JSON.parse(raw);
    var w = data.state.world;
    var history = w.transferHistory || [];
    var byType = {};
    var byPosition = {};
    for (var i = 0; i < history.length; i++) {
      var t = history[i];
      byType[t.type] = (byType[t.type] || 0) + 1;
      byPosition[t.position] = (byPosition[t.position] || 0) + 1;
    }
    var freeAgentRetirees = (w.retirementHistory || []).filter(function(r) { return r.uuid && r.uuid.startsWith('p-'); });
    return {
      season: w.seasonState.seasonNumber,
      totalTransfers: history.length,
      byType: byType,
      byPosition: byPosition,
      sample: history.slice(-12).map(function(t) { return {
        s: t.season, type: t.type, pos: t.position, name: t.playerName,
        from: t.fromTeamName, to: t.toTeamName, fee: t.fee
      }; }),
      totalRetirees: (w.retirementHistory || []).length,
    };
  })()`);

  console.log('=== Transfer system v2 ===');
  console.log('Current season:', stats.season);
  console.log('Total historical transfers:', stats.totalTransfers);
  console.log('By type:', JSON.stringify(stats.byType));
  console.log('By position:', JSON.stringify(stats.byPosition));
  console.log('Total retirees:', stats.totalRetirees);
  console.log('\nLast 12 transfers:');
  for (const t of stats.sample) {
    console.log(`  S${t.s} [${t.type.padEnd(11)}] ${t.pos} ${t.name.padEnd(12)} ${t.from} → ${t.to}` + (t.fee ? ` (€${t.fee}M)` : ''));
  }

  // Visual: visit Transfers page
  await page.goto(URL + 'transfers', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: '/tmp/transfers-v2.png', fullPage: false });

  // Find a transferred player and visit their detail
  const playerId = await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    var data = JSON.parse(raw);
    var hist = data.state.world.transferHistory || [];
    if (hist.length === 0) return null;
    // Last actual transfer
    return hist[hist.length - 1].playerId;
  })()`);

  if (playerId) {
    await page.goto(URL + 'player/' + playerId, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: '/tmp/player-detail-v2.png', fullPage: true });
  }

  console.log('\n=== ERRORS ===');
  console.log(errors.length === 0 ? 'NONE' : errors.join('\n'));
  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });

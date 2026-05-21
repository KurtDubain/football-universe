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

  // Snapshot initial
  const init = await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    var data = JSON.parse(raw);
    var w = data.state.world;
    var totalSquad = 0;
    for (var tid in w.squads) totalSquad += w.squads[tid].length;
    var tagCounts = { loyal: 0, ambitious: 0, iron: 0, glass: 0, none: 0 };
    for (var tid in w.squads) {
      for (var i = 0; i < w.squads[tid].length; i++) {
        var p = w.squads[tid][i];
        tagCounts[p.tag || 'none']++;
      }
    }
    return {
      season: w.seasonState.seasonNumber,
      totalSquadPlayers: totalSquad,
      poolSize: (w.freeAgentPool || []).length,
      retirees: (w.retirementHistory || []).length,
      tagCounts: tagCounts,
    };
  })()`);
  console.log('=== Initial (post-migration v17) ===');
  console.log('Season:', init.season);
  console.log('Total squad players:', init.totalSquadPlayers);
  console.log('Free agent pool:', init.poolSize);
  console.log('Tag distribution:', JSON.stringify(init.tagCounts));

  // Advance many seasons to test pool growth
  for (let i = 0; i < 500; i++) {
    const btn = await page.$('button:has-text("推进"), button:has-text("开始模拟")');
    if (!btn) break;
    const t = await btn.textContent();
    if (!t || t.includes('赛季已结束') || t.includes('模拟中')) break;
    await btn.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(2000);

  // Snapshot after
  const after = await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    var data = JSON.parse(raw);
    var w = data.state.world;
    var totalSquad = 0;
    for (var tid in w.squads) totalSquad += w.squads[tid].length;
    var tagCounts = { loyal: 0, ambitious: 0, iron: 0, glass: 0, none: 0 };
    var poolTagCounts = { loyal: 0, ambitious: 0, iron: 0, glass: 0, none: 0 };
    for (var tid in w.squads) {
      for (var i = 0; i < w.squads[tid].length; i++) {
        var p = w.squads[tid][i];
        tagCounts[p.tag || 'none']++;
      }
    }
    var pool = w.freeAgentPool || [];
    for (var j = 0; j < pool.length; j++) {
      poolTagCounts[pool[j].tag || 'none']++;
    }
    var history = w.transferHistory || [];
    var recent = history.slice(-15);
    return {
      season: w.seasonState.seasonNumber,
      totalSquadPlayers: totalSquad,
      poolSize: pool.length,
      retirees: (w.retirementHistory || []).length,
      tagCounts: tagCounts,
      poolTagCounts: poolTagCounts,
      recentTransfers: recent.map(function(t) { return { s: t.season, type: t.type, name: t.playerName, from: t.fromTeamName, to: t.toTeamName }; }),
    };
  })()`);
  console.log('\n=== After advance to S' + after.season + ' ===');
  console.log('Total squad players:', after.totalSquadPlayers);
  console.log('Free agent pool size:', after.poolSize, '(cap 40)');
  console.log('Retirees (FIFO 300):', after.retirees);
  console.log('Squad tag distribution:', JSON.stringify(after.tagCounts));
  console.log('Pool tag distribution:', JSON.stringify(after.poolTagCounts));
  console.log('\nLast 15 transfers:');
  for (const t of after.recentTransfers) {
    console.log('  S' + t.s + ' [' + t.type.padEnd(11) + '] ' + (t.name || '?').padEnd(12) + ' ' + (t.from || '') + ' → ' + (t.to || ''));
  }

  // Verify a tagged player's detail page
  const tagPlayerId = await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    var data = JSON.parse(raw);
    for (var tid in data.state.world.squads) {
      var sq = data.state.world.squads[tid];
      for (var i = 0; i < sq.length; i++) {
        if (sq[i].tag === 'loyal') return sq[i].uuid;
      }
    }
    return null;
  })()`);
  if (tagPlayerId) {
    await page.goto(URL + 'player/' + tagPlayerId, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    await page.screenshot({ path: '/tmp/player-tagged.png', fullPage: false });
  }

  console.log('\n=== ERRORS ===');
  console.log(errors.length === 0 ? 'NONE' : errors.join('\n'));
  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });

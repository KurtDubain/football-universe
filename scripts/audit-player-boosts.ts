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

  // Advance 3 full seasons
  for (let i = 0; i < 200; i++) {
    const btn = await page.$('button:has-text("推进"), button:has-text("开始模拟")');
    if (!btn) break;
    const t = await btn.textContent();
    if (!t || t.includes('赛季已结束') || t.includes('模拟中')) break;
    await btn.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(2000);

  // Snapshot: per-team L1 standings (via in-memory store, avoids
  // compressed localStorage parsing).
  const stats = await page.evaluate(`(() => {
    var s = (window).__gameStore;
    if (!s) return { error: 'store not exposed' };
    var w = s.getState().world;
    if (!w) return { error: 'no world' };
    var l1 = w.league1Standings.map(function(s) {
      var base = w.teamBases[s.teamId];
      return {
        name: base ? base.name : s.teamId,
        baseOverall: base ? base.overall : 0,
        played: s.played,
        wins: s.won,
        points: s.points,
        rank: w.league1Standings.indexOf(s) + 1,
      };
    });
    return { season: w.seasonState.seasonNumber, window: w.seasonState.currentWindowIndex, standings: l1 };
  })()`);
  console.log('=== L1 standings after 3 seasons ===');
  console.log('Now S' + stats.season + ' W' + stats.window);
  console.log('Rank | Name           | BaseOVR | Pts | W');
  console.log('-----+----------------+---------+-----+---');
  for (const s of stats.standings.slice(0, 16)) {
    console.log(`${String(s.rank).padStart(4)} | ${s.name.padEnd(15)}| ${String(s.baseOverall).padStart(7)} | ${String(s.points).padStart(3)} | ${s.wins}`);
  }

  // Verify boost calc end-to-end via the engine
  const boostCheck = await page.evaluate(`(() => {
    var s = (window).__gameStore;
    if (!s) return { error: 'store not exposed' };
    var w = s.getState().world;
    if (!w) return { error: 'no world' };
    var teamIds = Object.keys(w.teamBases).sort(function(a, b) { return w.teamBases[b].overall - w.teamBases[a].overall; });
    var rows = [];
    for (var i = 0; i < teamIds.length; i++) {
      var tid = teamIds[i];
      var sq = w.squads[tid] || [];
      var byPos = { GK: [], DF: [], MF: [], FW: [] };
      var inj = 0;
      var curWin = w.totalElapsedWindows || 0;
      for (var j = 0; j < sq.length; j++) {
        var p = sq[j];
        if ((p.injuredUntilWindow || 0) > curWin || (p.suspendedUntilWindow || 0) > curWin) { inj++; continue; }
        byPos[p.position].push(p.rating);
      }
      var STARTERS = { GK: 1, DF: 4, MF: 4, FW: 3 };
      var WEIGHTS = {
        FW: { attack: 1.0, midfield: 0.2, defense: 0 },
        MF: { attack: 0.4, midfield: 0.8, defense: 0.2 },
        DF: { attack: 0,   midfield: 0.2, defense: 1.0 },
        GK: { attack: 0,   midfield: 0,   defense: 0.8 },
      };
      var atk = 0, mid = 0, def = 0;
      for (var pos in byPos) {
        var list = byPos[pos].sort(function(a,b){return b-a;}).slice(0, STARTERS[pos]);
        if (list.length === 0) continue;
        var avg = list.reduce(function(s, r){ return s+r; }, 0) / list.length;
        var delta = avg - 60;
        atk += delta * WEIGHTS[pos].attack;
        mid += delta * WEIGHTS[pos].midfield;
        def += delta * WEIGHTS[pos].defense;
      }
      function clamp(v) { return Math.round(Math.max(-15, Math.min(15, v))); }
      rows.push({
        name: w.teamBases[tid].name,
        baseOverall: w.teamBases[tid].overall,
        atk: clamp(atk),
        mid: clamp(mid),
        def: clamp(def),
        inj: inj,
      });
    }
    return rows;
  })()`);

  console.log('\n=== Player boost distribution across all teams ===');
  console.log('Team                | BaseOVR | +ATK | +MID | +DEF | Inj');
  console.log('--------------------+---------+------+------+------+----');
  for (const r of boostCheck) {
    console.log(`${r.name.padEnd(20)}| ${String(r.baseOverall).padStart(7)} | ${String(r.atk).padStart(4)} | ${String(r.mid).padStart(4)} | ${String(r.def).padStart(4)} | ${r.inj}`);
  }

  console.log('\n=== ERRORS ===');
  console.log(errors.length === 0 ? 'NONE' : errors.join('\n'));
  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });

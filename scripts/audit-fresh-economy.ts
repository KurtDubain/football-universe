import { chromium } from 'playwright';

const URL = 'http://localhost:5173/';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`PAGE: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`CON: ${m.text()}`); });

  // Fresh start — clear localStorage, navigate, let app initialize fresh
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.evaluate(`localStorage.clear()`);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Check if onboarding/start screen appears, dismiss/start
  // Look for any "开始" / "开始游戏" button
  const startBtn = await page.$('button:has-text("开始游戏"), button:has-text("开始"), button:has-text("快速开始")');
  if (startBtn) {
    await startBtn.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  // Capture S0/S1 init state — fresh squad market values + finances
  const initState = await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    if (!raw) return null;
    var data = JSON.parse(raw);
    var w = data.state.world;
    var bases = w.teamBases;
    var fins = w.teamFinances || {};
    var squads = w.squads || {};
    var rows = [];
    for (var tid in bases) {
      var b = bases[tid];
      var sq = squads[tid] || [];
      var sv = 0;
      for (var i = 0; i < sq.length; i++) sv += sq[i].marketValue || 0;
      rows.push({
        name: b.name,
        rep: b.reputation,
        cash: fins[tid] ? fins[tid].cash : null,
        squadVal: Math.round(sv),
        squadCount: sq.length,
      });
    }
    rows.sort(function(a, b) { return b.rep - a.rep; });
    return { season: w.seasonState ? w.seasonState.seasonNumber : '?', rows: rows };
  })()`);

  if (!initState) {
    console.error('FRESH GAME FAILED — no save in localStorage after init');
    process.exit(1);
  }

  console.log('=== FRESH GAME — initial state @ S' + initState.season + ' ===');
  console.log('Team                | Rep | Cash    | SquadVal | Players');
  console.log('--------------------+-----+---------+----------+--------');
  for (const r of initState.rows.slice(0, 16)) {
    console.log(`${r.name.padEnd(20)}| ${String(r.rep).padStart(3)} | ${r.cash != null ? '€' + String(Math.round(r.cash)).padStart(4) + 'M' : '????'} | €${String(r.squadVal).padStart(5)}M  | ${r.squadCount}`);
  }
  console.log('...');
  for (const r of initState.rows.slice(-10)) {
    console.log(`${r.name.padEnd(20)}| ${String(r.rep).padStart(3)} | ${r.cash != null ? '€' + String(Math.round(r.cash)).padStart(4) + 'M' : '????'} | €${String(r.squadVal).padStart(5)}M  | ${r.squadCount}`);
  }

  // Now advance ~10 full seasons (60 windows × 10 = 600)
  for (let i = 0; i < 700; i++) {
    const btn = await page.$('button:has-text("推进"), button:has-text("开始模拟")');
    if (!btn) break;
    const t = await btn.textContent();
    if (!t || t.includes('赛季已结束') || t.includes('模拟中')) break;
    await btn.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(2000);

  const after = await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    var data = JSON.parse(raw);
    var w = data.state.world;
    var bases = w.teamBases;
    var fins = w.teamFinances || {};
    var squads = w.squads || {};
    var news = w.newsLog || [];
    var fireSales = news.filter(function(n) { return n.type === 'fire_sale'; });
    var rows = [];
    for (var tid in bases) {
      var b = bases[tid];
      var sq = squads[tid] || [];
      var sv = 0;
      for (var i = 0; i < sq.length; i++) sv += sq[i].marketValue || 0;
      var f = fins[tid];
      var lastH = f && f.history ? f.history.slice(-1)[0] : null;
      rows.push({
        name: b.name,
        rep: b.reputation,
        cash: f ? f.cash : null,
        squadVal: Math.round(sv),
        lastSal: lastH ? lastH.salaries : 0,
        lastEnd: lastH ? lastH.endCash : 0,
        lastStart: lastH ? lastH.startCash : 0,
      });
    }
    rows.sort(function(a, b) { return b.rep - a.rep; });
    return { season: w.seasonState.seasonNumber, rows: rows, fireSaleCount: fireSales.length, fireSales: fireSales.slice(-15) };
  })()`);

  console.log('\n=== AFTER ADVANCE — at S' + after.season + ' ===');
  console.log('Team                | Rep | Cash    | SquadVal | LastSal | LastNet');
  console.log('--------------------+-----+---------+----------+---------+--------');
  for (const r of after.rows.slice(0, 16)) {
    const net = r.lastEnd - r.lastStart;
    console.log(`${r.name.padEnd(20)}| ${String(r.rep).padStart(3)} | ${r.cash != null ? '€' + String(Math.round(r.cash)).padStart(4) + 'M' : '????'} | €${String(r.squadVal).padStart(5)}M  | €${String(r.lastSal).padStart(4)}M | €${String(net).padStart(5)}M`);
  }
  console.log('...');
  for (const r of after.rows.slice(-10)) {
    const net = r.lastEnd - r.lastStart;
    console.log(`${r.name.padEnd(20)}| ${String(r.rep).padStart(3)} | ${r.cash != null ? '€' + String(Math.round(r.cash)).padStart(4) + 'M' : '????'} | €${String(r.squadVal).padStart(5)}M  | €${String(r.lastSal).padStart(4)}M | €${String(net).padStart(5)}M`);
  }

  console.log('\n=== TOTAL FIRE SALES: ' + after.fireSaleCount + ' ===');
  for (const fs of after.fireSales) {
    console.log(`  S${fs.seasonNumber} W${fs.windowIndex}: ${fs.title}`);
  }

  console.log('\n=== ERRORS ===');
  console.log(errors.length === 0 ? 'NONE' : errors.join('\n'));
  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });

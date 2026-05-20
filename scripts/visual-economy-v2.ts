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
  await page.waitForTimeout(500);
  await page.evaluate(`
    localStorage.clear();
    localStorage.setItem('football-universe-save', ${JSON.stringify(JSON.stringify(SAVE))});
  `);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Advance 5 full seasons
  for (let i = 0; i < 300; i++) {
    const btn = await page.$('button:has-text("推进"), button:has-text("开始模拟")');
    if (!btn) break;
    const t = await btn.textContent();
    if (!t || t.includes('赛季已结束') || t.includes('模拟中')) break;
    await btn.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(1500);

  // Capture finance state per team
  const finance = await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    if (!raw) return null;
    var data = JSON.parse(raw);
    var w = data.state.world;
    var bases = w.teamBases;
    var fins = w.teamFinances;
    var squads = w.squads;
    var rows = [];
    for (var tid in fins) {
      var b = bases[tid];
      var sq = squads[tid] || [];
      var sv = 0;
      for (var i = 0; i < sq.length; i++) sv += sq[i].marketValue || 0;
      var lastH = (fins[tid].history || []).slice(-1)[0];
      rows.push({
        name: b ? b.name : tid,
        rep: b ? b.reputation : 0,
        cash: fins[tid].cash,
        squadVal: Math.round(sv),
        lastSeasonSalary: lastH ? lastH.salaries : 0,
        lastSeasonNet: lastH ? (lastH.endCash - lastH.startCash) : 0,
      });
    }
    rows.sort(function(a, b) { return b.rep - a.rep; });
    return rows;
  })()`);

  console.log('=== After 5 seasons advance with new bracketed salaries ===');
  console.log('Team                | Rep | Cash    | SquadVal | LastSeasonSalary | LastSeasonNet');
  console.log('--------------------+-----+---------+----------+------------------+--------------');
  for (const r of finance.slice(0, 16)) {
    console.log(
      `${r.name.padEnd(20)}| ${String(r.rep).padStart(3)} | €${String(Math.round(r.cash)).padStart(5)}M | €${String(r.squadVal).padStart(5)}M  | €${String(r.lastSeasonSalary).padStart(5)}M          | €${String(r.lastSeasonNet).padStart(5)}M`
    );
  }
  console.log('...');
  for (const r of finance.slice(-5)) {
    console.log(
      `${r.name.padEnd(20)}| ${String(r.rep).padStart(3)} | €${String(Math.round(r.cash)).padStart(5)}M | €${String(r.squadVal).padStart(5)}M  | €${String(r.lastSeasonSalary).padStart(5)}M          | €${String(r.lastSeasonNet).padStart(5)}M`
    );
  }

  // Visit a top team's finance panel
  const topTeam = finance[0];
  // Find the team id
  const topId = await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    var data = JSON.parse(raw);
    var bases = data.state.world.teamBases;
    var topName = ${JSON.stringify(topTeam.name)};
    for (var tid in bases) if (bases[tid].name === topName) return tid;
    return null;
  })()`);

  if (topId) {
    await page.goto(URL + 'team/' + topId, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: '/tmp/economy-v2-top-team.png', fullPage: false });
  }

  console.log('\n=== ERRORS ===');
  console.log(errors.length === 0 ? 'NONE' : errors.join('\n'));
  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });

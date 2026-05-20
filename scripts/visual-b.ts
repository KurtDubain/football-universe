import { chromium } from 'playwright';
import * as fs from 'fs';

const URL = 'http://localhost:5173/';
const SAVE = JSON.parse(fs.readFileSync('/Users/mutu/Downloads/football-universe-s16.json', 'utf8'));

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`PAGE ERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.evaluate(`
    localStorage.clear();
    localStorage.setItem('football-universe-save', ${JSON.stringify(JSON.stringify(SAVE))});
  `);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Advance season fully so coach + player retirements fire
  for (let i = 0; i < 60; i++) {
    const btn = await page.$('button:has-text("推进"), button:has-text("开始模拟")');
    if (!btn) break;
    const txt = await btn.textContent();
    if (!txt || txt.includes('赛季已结束') || txt.includes('模拟中')) break;
    await btn.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(2000);

  // Check state
  const state = await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    if (!raw) return null;
    var data = JSON.parse(raw);
    var w = data.state.world;
    return {
      version: data.version,
      season: w.seasonState.seasonNumber,
      playerRetirements: (w.retirementHistory || []).length,
      coachRetirements: (w.coachRetirementHistory || []).length,
      candidatePool: (w.coachCandidatePool || []).length,
      coachAges: Object.values(w.coachBases).map(c => c.age),
      sampleCoachRetirement: (w.coachRetirementHistory || [])[0] || null,
    };
  })()`);
  console.log('=== AFTER ADVANCE ===');
  console.log(JSON.stringify(state, null, 2));

  // Visit /legends and switch to coach tab
  await page.goto(URL + 'legends', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/b-legends-player-tab.png', fullPage: false });
  // Click coach tab
  const coachTab = await page.$('button:has-text("退役教练")');
  if (coachTab) {
    await coachTab.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/tmp/b-legends-coach-tab.png', fullPage: false });
  }

  console.log('=== ERRORS ===');
  console.log(errors.length === 0 ? 'NONE' : errors.join('\n'));
  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });

import { chromium } from 'playwright';
import * as fs from 'fs';

const URL = 'http://localhost:5173/';
const SAVE = JSON.parse(fs.readFileSync('/Users/mutu/Downloads/football-universe-s16.json', 'utf8'));

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`PAGE ERROR: ${e.message}`));

  await page.goto(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(`
    localStorage.clear();
    localStorage.setItem('football-universe-save', ${JSON.stringify(JSON.stringify(SAVE))});
  `);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  await page.goto(URL + 'legends', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/visual-legends-empty.png', fullPage: false });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  for (let i = 0; i < 50; i++) {
    const btn = await page.$('button:has-text("推进"), button:has-text("开始模拟")');
    if (!btn) break;
    const txt = await btn.textContent();
    if (!txt || txt.includes('赛季已结束') || txt.includes('模拟中')) break;
    await btn.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(2500);

  const stateAfter = await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    if (!raw) return null;
    var data = JSON.parse(raw);
    var w = data.state.world;
    return {
      version: data.version,
      season: w.seasonState.seasonNumber,
      currentWindowIndex: w.seasonState.currentWindowIndex,
      seasonCompleted: w.seasonState.completed,
      retirements: (w.retirementHistory || []).length,
      candidates: (w.coachCandidatePool || []).length,
      sample: (w.retirementHistory || [])[0] || null,
    };
  })()`);
  console.log('=== AFTER ADVANCE ===');
  console.log(JSON.stringify(stateAfter, null, 2));

  await page.goto(URL + 'legends', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/visual-legends-populated.png', fullPage: true });

  const sampleObj = stateAfter as { sample?: { uuid?: string } } | null;
  if (sampleObj && sampleObj.sample && sampleObj.sample.uuid) {
    await page.goto(URL + 'player/' + sampleObj.sample.uuid, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/tmp/visual-retired-player.png', fullPage: false });
  }

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/visual-dashboard-with-legends-nav.png', fullPage: false });

  console.log('=== ERRORS ===');
  console.log(errors.length === 0 ? 'NONE' : errors.join('\n'));
  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });

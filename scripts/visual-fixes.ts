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

  // Advance ~70 windows so coaches actually retire (forced by age over time)
  for (let i = 0; i < 70; i++) {
    const btn = await page.$('button:has-text("推进"), button:has-text("开始模拟")');
    if (!btn) break;
    const t = await btn.textContent();
    if (!t || t.includes('赛季已结束') || t.includes('模拟中')) break;
    await btn.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(1500);

  // Find a retired coach
  const retiredCoachId = await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    if (!raw) return null;
    var data = JSON.parse(raw);
    var w = data.state.world;
    var rh = w.coachRetirementHistory || [];
    return rh.length > 0 ? rh[0].id : null;
  })()`);

  console.log('RETIRED COACH ID:', retiredCoachId);

  if (retiredCoachId) {
    await page.goto(URL + `coach/${retiredCoachId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    await page.screenshot({ path: '/tmp/fix-retired-coach.png', fullPage: false });

    // Check banner text present
    const has退役 = await page.evaluate(`document.body.innerText.indexOf('已退役') !== -1`);
    const has名人堂 = await page.evaluate(`document.body.innerText.indexOf('名人堂') !== -1`);
    console.log('HAS 已退役 banner:', has退役);
    console.log('HAS 名人堂 link:', has名人堂);
  } else {
    console.log('No retired coach yet (might need more advance)');
  }

  // Test Dashboard overlay click-through
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // Inject a fake MatchLive open state by setting liveResult — easier: just check button is in sticky z-[210] container
  const topBarZ = await page.evaluate(`(() => {
    var el = document.querySelector('.sticky.top-0');
    return el ? (window.getComputedStyle(el).zIndex) : null;
  })()`);
  console.log('TOP BAR Z-INDEX:', topBarZ);

  // Test handleAdvanceClick wraps — confirm clicking advance doesn't error
  for (let i = 0; i < 3; i++) {
    const btn = await page.$('button:has-text("开始模拟"), button:has-text("推进")');
    if (btn) {
      await btn.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  await page.screenshot({ path: '/tmp/fix-dashboard.png', fullPage: false });

  console.log('=== ERRORS ===');
  console.log(errors.length === 0 ? 'NONE' : errors.join('\n'));
  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });

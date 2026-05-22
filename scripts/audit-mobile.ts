import { chromium, devices } from 'playwright';
import * as fs from 'fs';

const URL = 'http://localhost:5173/';
const SAVE = JSON.parse(fs.readFileSync('/Users/mutu/Downloads/football-universe-s16.json', 'utf8'));

async function main() {
  const browser = await chromium.launch({ headless: true });
  const iphone = devices['iPhone 13'];
  const ctx = await browser.newContext({ ...iphone });
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

  // Screenshots of every key page
  const pages = [
    { name: 'dashboard', path: '/' },
    { name: 'league-1', path: '/league/1' },
    { name: 'transfers', path: '/transfers' },
    { name: 'history', path: '/history' },
    { name: 'legends', path: '/legends' },
  ];

  for (const p of pages) {
    await page.goto(URL + p.path.slice(1), { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `/tmp/mobile-${p.name}.png`, fullPage: false });
  }

  // Hamburger menu test
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  // Look for hamburger button
  const hamburger = await page.$('button.md\\:hidden');
  console.log('Hamburger found:', !!hamburger);

  // TeamDetail
  const tid = await page.evaluate(`(() => {
    var s = (window).__gameStore;
    var w = s.getState().world;
    return Object.keys(w.teamBases)[0];
  })()`);
  if (tid) {
    await page.goto(URL + 'team/' + tid, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: '/tmp/mobile-teamdetail.png', fullPage: true });
  }

  // PlayerDetail
  const pid = await page.evaluate(`(() => {
    var s = (window).__gameStore;
    var w = s.getState().world;
    var sq = w.squads[Object.keys(w.squads)[0]];
    return sq[0].uuid;
  })()`);
  if (pid) {
    await page.goto(URL + 'player/' + pid, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: '/tmp/mobile-playerdetail.png', fullPage: true });
  }

  // Market page (need to open window first)
  await page.evaluate(`(() => {
    var s = (window).__gameStore;
    var w = s.getState().world;
    var top = Object.keys(w.teamBases).sort(function(a,b){return w.teamBases[b].overall - w.teamBases[a].overall;})[0];
    s.getState().setFavoriteTeams([top]);
  })()`);
  for (let i = 0; i < 80; i++) {
    const btn = await page.$('button:has-text("推进"), button:has-text("开始模拟")');
    if (!btn) break;
    const t = await btn.textContent();
    if (!t || t.includes('赛季已结束') || t.includes('模拟中')) break;
    await btn.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(1500);
  await page.goto(URL + 'market', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/mobile-market.png', fullPage: true });

  console.log('\n=== Mobile screenshots saved to /tmp/mobile-*.png ===');
  console.log('Viewport:', iphone.viewport);
  console.log('User-Agent:', iphone.userAgent.substring(0, 60) + '...');
  console.log('\n=== ERRORS ===');
  console.log(errors.length === 0 ? 'NONE' : errors.slice(0, 5).join('\n'));
  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });

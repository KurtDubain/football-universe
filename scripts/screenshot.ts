import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const URL = 'https://football-universe-ebon.vercel.app/';
const OUT_DIR = path.join(__dirname, '..', 'docs', 'screenshots');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  console.log('Loading site...');
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // 1. Welcome / Landing page
  console.log('Capture: welcome');
  await page.screenshot({ path: path.join(OUT_DIR, '01-welcome.png'), fullPage: false });

  // Click 开始新游戏
  const startBtn = page.getByRole('button', { name: /开始新游戏|🚀/ });
  await startBtn.click();
  await page.waitForTimeout(2500);

  // Now in Dashboard
  console.log('Capture: dashboard initial');
  await page.screenshot({ path: path.join(OUT_DIR, '02-dashboard-initial.png'), fullPage: false });

  // Try clicking Advance many times to play a season
  console.log('Advancing seasons...');
  for (let i = 0; i < 60; i++) {
    try {
      const advance = page.getByRole('button', { name: /推进|Advance/ }).first();
      const visible = await advance.isVisible().catch(() => false);
      if (!visible) break;
      await advance.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(80);
    } catch {}
  }

  await page.waitForTimeout(1500);

  // 3. Dashboard mid-season
  console.log('Capture: dashboard mid-season');
  await page.screenshot({ path: path.join(OUT_DIR, '03-dashboard-midseason.png'), fullPage: false });

  // 4. League standings — navigate to /league/1
  console.log('Capture: league standings');
  await page.goto(URL + 'league/1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT_DIR, '04-league.png'), fullPage: false });

  // 5. Cup bracket
  console.log('Capture: league cup');
  await page.goto(URL + 'cup/league_cup', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT_DIR, '05-cup-bracket.png'), fullPage: false });

  // 6. Super cup
  console.log('Capture: super cup');
  await page.goto(URL + 'cup/super_cup', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT_DIR, '06-super-cup.png'), fullPage: false });

  // 7. Teams page
  console.log('Capture: teams center');
  await page.goto(URL + 'teams', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT_DIR, '07-teams.png'), fullPage: false });

  // 8. History / Honors
  console.log('Capture: history');
  await page.goto(URL + 'history', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT_DIR, '08-history.png'), fullPage: false });

  // 9. Chronicle
  console.log('Capture: chronicle');
  await page.goto(URL + 'chronicle', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT_DIR, '09-chronicle.png'), fullPage: false });

  // 10. Mobile screenshot of dashboard
  console.log('Capture: mobile dashboard');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT_DIR, '10-mobile.png'), fullPage: false });

  await browser.close();
  console.log('Done! Screenshots in', OUT_DIR);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

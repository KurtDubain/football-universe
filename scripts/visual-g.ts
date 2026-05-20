/**
 * Phase G — UI smoke test. Loads the s16 save, navigates to dashboard,
 * advances a few windows so the world develops injuries / suspensions,
 * then visits TeamDetail + PlayerDetail to confirm the new UI sections
 * render without console errors.
 *
 * Run with: PATH=/Users/mutu/.nvm/versions/node/v22.22.2/bin:$PATH \
 *   node_modules/.bin/tsx scripts/visual-g.ts
 *
 * Requires `pnpm dev` running on localhost:5173.
 */
import { chromium } from 'playwright';
import * as fs from 'fs';

const URL = 'http://localhost:5173/';
const SAVE = JSON.parse(fs.readFileSync('/Users/mutu/Downloads/football-universe-s16.json', 'utf8'));

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`PAGE ERROR: ${e.message}`));

  await page.goto(URL);
  await page.evaluate(`
    localStorage.clear();
    localStorage.setItem('football-universe-save', ${JSON.stringify(JSON.stringify(SAVE))});
  `);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Advance ~30 windows (gets through ~half a season → enough injuries)
  console.log('Advancing windows...');
  for (let i = 0; i < 30; i++) {
    // Click 推进 button
    const btn = await page.$('button:has-text("推进")');
    if (btn) {
      await btn.click();
      await page.waitForTimeout(200);
    } else {
      break;
    }
  }
  await page.waitForTimeout(1500);

  // Check the saved state for injuries
  const state = await page.evaluate(`(() => {
    const raw = localStorage.getItem('football-universe-save');
    if (!raw) return null;
    const data = JSON.parse(raw);
    const w = data.state.world;
    let injuredCount = 0;
    let suspendedCount = 0;
    let teamWithInjuries = null;
    let playerWithHistory = null;
    const cur = w.totalElapsedWindows || 0;
    for (const [teamId, sq] of Object.entries(w.squads)) {
      for (const p of sq) {
        if ((p.injuredUntilWindow || 0) > cur) {
          injuredCount++;
          if (!teamWithInjuries) teamWithInjuries = teamId;
        }
        if ((p.suspendedUntilWindow || 0) > cur) suspendedCount++;
        if (p.injuryHistory && p.injuryHistory.length > 0 && !playerWithHistory) {
          playerWithHistory = p.uuid;
        }
      }
    }
    return { totalElapsedWindows: cur, injuredCount, suspendedCount, teamWithInjuries, playerWithHistory };
  })()`) as { totalElapsedWindows: number; injuredCount: number; suspendedCount: number; teamWithInjuries: string | null; playerWithHistory: string | null };
  console.log('State after advances:', state);

  // Visit a team with injuries
  if (state?.teamWithInjuries) {
    await page.goto(`${URL}team/${state.teamWithInjuries}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const hasInjuryBoard = await page.evaluate(`document.body.innerText.includes('🩹 伤员 / 停赛')`);
    console.log(`Team page (${state.teamWithInjuries}) shows injury board:`, hasInjuryBoard);
  }

  // Visit a player with injury history
  if (state?.playerWithHistory) {
    await page.goto(`${URL}player/${state.playerWithHistory}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const hasInjuryRecord = await page.evaluate(`document.body.innerText.includes('🩹 伤病记录')`);
    console.log(`Player page (${state.playerWithHistory}) shows injury record:`, hasInjuryRecord);
  }

  console.log('\n=== Console errors ===');
  if (errors.length === 0) {
    console.log('NONE — clean run');
  } else {
    for (const e of errors) console.log(e);
  }

  await browser.close();
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

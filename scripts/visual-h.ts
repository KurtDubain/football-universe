/**
 * Phase H — visual smoke test for the finance UI surfaces.
 *
 * Loads the s16 baseline, advances ~35 windows so a season-end has fired,
 * snapshots:
 *   1. Dashboard (favorite team cash chip + alert if any)
 *   2. TeamDetail (the new FinancePanel — current cash, history table)
 *   3. /history (财富榜 leaderboard)
 *
 * Run with: PATH=/Users/mutu/.nvm/versions/node/v22.22.2/bin:$PATH \
 *   pnpm exec vite dev &  # in another shell
 *   node_modules/.bin/tsx scripts/visual-h.ts
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
  page.on('pageerror', (e) => errors.push(`PAGE: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.evaluate(`
    localStorage.clear();
    localStorage.setItem('football-universe-save', ${JSON.stringify(JSON.stringify(SAVE))});
  `);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Pin a favorite (gz_hengda) so the dashboard cash-chip is visible.
  await page.evaluate(`
    var raw = localStorage.getItem('football-universe-save');
    var data = JSON.parse(raw);
    data.state.favoriteTeamIds = ['gz_hengda'];
    data.state.favoriteTeamId = 'gz_hengda';
    localStorage.setItem('football-universe-save', JSON.stringify(data));
  `);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Snap the migrated baseline first
  await page.screenshot({ path: '/tmp/h-dashboard-pre.png', fullPage: false });

  // Advance until at least one season-end fires (s16 → s17 etc)
  for (let i = 0; i < 60; i++) {
    try {
      const btn = await page.$('button:has-text("推进"), button:has-text("开始模拟")');
      if (!btn) break;
      const txt = await btn.textContent();
      if (!txt || txt.includes('赛季已结束') || txt.includes('模拟中')) break;
      await btn.click({ timeout: 1500 });
      await page.waitForTimeout(180);
    } catch { break; }
  }
  await page.waitForTimeout(1500);

  // Migration sanity: read the migrated state
  const state = await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    if (!raw) return null;
    var data = JSON.parse(raw);
    var w = data.state.world;
    var fin = w.teamFinances ?? {};
    var teams = Object.keys(fin).length;
    var negTeams = 0;
    var minCash = Infinity, maxCash = -Infinity;
    var samples = [];
    for (var tid of Object.keys(fin)) {
      var c = fin[tid].cash;
      if (c < 0) negTeams++;
      if (c < minCash) minCash = c;
      if (c > maxCash) maxCash = c;
      if (samples.length < 5) samples.push({ id: tid, name: w.teamBases[tid]?.name, cash: c, history: fin[tid].history.length });
    }
    return {
      version: data.version,
      season: w.seasonState.seasonNumber,
      financeTeams: teams,
      financeNegTeams: negTeams,
      cashRange: { min: minCash, max: maxCash },
      sample: samples,
      gzCash: fin['gz_hengda']?.cash,
      gzHistoryLen: fin['gz_hengda']?.history?.length,
    };
  })()`);
  console.log('=== STATE ===', JSON.stringify(state, null, 2));

  // Dashboard with cash chip
  await page.screenshot({ path: '/tmp/h-dashboard.png', fullPage: false });

  // TeamDetail finance panel
  await page.goto(URL + 'team/gz_hengda', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: '/tmp/h-team-finance.png', fullPage: true });

  // Wealth leaderboard on /history
  await page.goto(URL + 'history', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: '/tmp/h-history-wealth.png', fullPage: false });

  console.log('=== ERRORS ===', errors.length === 0 ? 'NONE' : errors.join('\n'));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

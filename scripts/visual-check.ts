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
  // Inject save via string (no closure / no helper functions)
  await page.evaluate(`
    localStorage.clear();
    localStorage.setItem('football-universe-save', ${JSON.stringify(JSON.stringify(SAVE))});
  `);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const postState = await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    if (!raw) return null;
    var data = JSON.parse(raw);
    var w = data.state.world;
    var ratings = [], peakRatings = [], ages = [];
    var total = 0, missingPeaks = 0;
    var teamIds = Object.keys(w.squads);
    for (var i = 0; i < teamIds.length; i++) {
      var squad = w.squads[teamIds[i]];
      for (var j = 0; j < squad.length; j++) {
        var p = squad[j];
        total++;
        if (typeof p.peakRating !== 'number') missingPeaks++;
        ratings.push(p.rating);
        peakRatings.push(p.peakRating || 0);
        ages.push(p.age);
      }
    }
    var summary = (arr) => {
      var s = arr.slice().sort((a,b) => a-b);
      var sum = 0;
      for (var k = 0; k < arr.length; k++) sum += arr[k];
      return { min: s[0], max: s[s.length-1], median: s[Math.floor(s.length/2)], avg: Math.round(sum/arr.length*10)/10 };
    };
    return {
      version: data.version,
      total: total,
      missingPeaks: missingPeaks,
      ratings: summary(ratings),
      peakRatings: summary(peakRatings),
      ages: summary(ages),
    };
  })()`);
  console.log('=== POST MIGRATION ===');
  console.log(JSON.stringify(postState, null, 2));

  const pages = [
    { name: '01-dashboard', path: '' },
    { name: '02-teams', path: 'teams' },
    { name: '03-team-hengda', path: 'team/gz_hengda' },
    { name: '04-players', path: 'players' },
    { name: '05-history', path: 'history' },
    { name: '06-search', path: 'search' },
  ];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    await page.goto(URL + p.path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `/tmp/visual-${p.name}.png`, fullPage: false });
  }

  const samplePlayer = await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    if (!raw) return null;
    var data = JSON.parse(raw);
    var sq = data.state.world.squads.gz_hengda;
    return sq && sq[0] ? sq[0].uuid : null;
  })()`);
  if (samplePlayer) {
    await page.goto(URL + 'player/' + samplePlayer, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/tmp/visual-07-player-detail.png', fullPage: false });
  }

  console.log('=== ERRORS ===');
  console.log(errors.length === 0 ? 'NONE' : errors.join('\n'));
  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });

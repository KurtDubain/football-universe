import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import LZ from 'lz-string';
import { initializeGameWorld, executeCurrentWindow, type GameWorld } from '../src/engine/season/season-manager';
import { retainPlayerArchives } from '../src/engine/players/retirement-archive';
import { SAVE_SCHEMA_VERSION } from '../src/store/save-constants';

// All fixtures are newly generated QA worlds in isolated contexts, never user browser data.
const url = process.env.VERIFY_URL ?? 'http://127.0.0.1:4193';
const output = 'output/playwright/player-exposure';
mkdirSync(output, { recursive: true });
let world = initializeGameWorld(20260709);
function finishSeason() {
  const season = world.seasonState.seasonNumber;
  let windows = 0;
  while (world.seasonState.seasonNumber === season && windows++ < 100) world = executeCurrentWindow(world).world;
  assert.equal(world.seasonState.seasonNumber, season + 1);
}
finishSeason();
const opening = structuredClone(world);
const winner = opening.playerAwardsHistory.find(award => award.type === 'mvp' && award.season === 1)!;
const player = Object.values(opening.squads).flat().find(player => player.uuid === winner.playerId)!;
assert(player);
player.rating = 83; // Explicit low-ability boundary fixture; not a claimed real result.
for (let i = 0; i < 3; i++) finishSeason();
const retiredWorld = structuredClone(world);
const defender = Object.values(retiredWorld.squads).flat().find(player => player.position === 'DF')!;
retiredWorld.squads[defender.teamId] = retiredWorld.squads[defender.teamId].filter(player => player.uuid !== defender.uuid);
retiredWorld.playerAwardsHistory = [1, 2, 3].map(season => ({ season, type: 'mvp', playerId: defender.uuid,
  playerName: defender.name, playerNumber: defender.number, teamId: defender.teamId,
  teamName: retiredWorld.teamBases[defender.teamId].name, statValue: 83, statLabel: '综合83（测试记录）' }));
retiredWorld.retirementHistory.push({ uuid: defender.uuid, name: defender.name, teamId: defender.teamId,
  teamName: retiredWorld.teamBases[defender.teamId].name, position: defender.position, age: 36,
  peakRating: 88, seasonRetired: 4, careerGoals: 0 });
retiredWorld.retirementHistory = retainPlayerArchives(retiredWorld, [defender.uuid]);
retiredWorld.playerAwardsHistory = [];
retiredWorld.playerStatsHistory = {};
for (const retired of retiredWorld.retirementHistory) delete retiredWorld.playerStats[retired.uuid];

function envelope(world: GameWorld, followed: string) {
  return JSON.stringify({ version: SAVE_SCHEMA_VERSION, state: { initialized: true, world,
    lastResults: [], lastNews: [], favoriteTeamId: null, favoriteTeamIds: [], favoritePlayerIds: [followed],
    narrativeMemory: [], starredFixtureIds: [], lastWorldResponse: null, lastTransferWindowHandoff: null } });
}
const errors: string[] = [];
const report: unknown[] = [];
const browser = await chromium.launch();
async function capture(page: Page, name: string) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ': overflow');
  assert.deepEqual(await page.evaluate(() => ['__gameStore', '__appUpdateAudit'].filter(key => key in window)), []);
  await page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' });
}
try {
  for (const width of [390, 1280]) {
    for (const scenario of ['opening', 'retired']) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 720 } });
      const raw = envelope(scenario === 'opening' ? opening : retiredWorld, scenario === 'opening' ? player.uuid : defender.uuid);
      await context.addInitScript(raw => {
        if (!localStorage.getItem('football-universe-save')) localStorage.setItem('football-universe-save', raw);
      }, raw);
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
      if (scenario === 'opening') {
        await page.goto(url + '/players', { waitUntil: 'networkidle' });
        await page.getByRole('heading', { name: '球星观察', exact: true }).scrollIntoViewIfNeeded();
        const more = page.getByRole('button', { name: /^查看全部 \d+ 人$/ });
        if (await more.count()) await more.click();
        const fact = page.locator(`a[href="/player/${player.uuid}#awards-S1"]`);
        await fact.scrollIntoViewIfNeeded();
        assert((await fact.innerText()).includes('上季金球得主'));
        await capture(page, `focus-${width}`);
        await fact.click();
        await page.locator('#awards-S1').waitFor();
        await page.waitForTimeout(250);
        const box = await page.locator('#awards-S1').boundingBox();
        assert(box && box.y >= 0 && box.y < (width === 390 ? 844 : 720), 'award anchor must be in view');
        await capture(page, `award-anchor-${width}`);
      } else {
        await page.goto(`${url}/player/${defender.uuid}`, { waitUntil: 'networkidle' });
        const thread = page.getByTestId('entity-narrative-thread');
        await page.screenshot({ path: `${output}/retired-loaded-${width}.png` });
        writeFileSync(`${output}/retired-loaded-${width}.txt`, await page.locator('body').innerText());
        writeFileSync(`${output}/errors.json`, JSON.stringify(errors));
        assert((await thread.innerText()).includes('3届金球'));
        await thread.scrollIntoViewIfNeeded();
        await capture(page, `retired-summary-${width}`);
        await thread.getByRole('link', { name: /个人荣誉/ }).click();
        await page.waitForURL(`**/player/${defender.uuid}#player-awards`);
        await page.locator('#player-awards').waitFor();
        await page.locator('#player-awards').getByText('综合83（测试记录）', { exact: true }).first().waitFor();
        assert.equal(await page.locator('#player-awards').getByText('综合83（测试记录）', { exact: true }).count(), 3);
        await capture(page, `retired-evidence-${width}`);
        await page.reload({ waitUntil: 'networkidle' });
        assert.equal(await page.locator('#player-awards').getByText('综合83（测试记录）', { exact: true }).count(), 3);
        await page.goto(url + '/legends', { waitUntil: 'networkidle' });
        const evidence = page.locator(`a[href="/player/${defender.uuid}#player-awards"]`);
        for (let attempt = 0; await evidence.count() === 0 && attempt < 20; attempt++) {
          await page.getByRole('button', { name: /查看更多退役人物/ }).click();
        }
        await evidence.scrollIntoViewIfNeeded();
        assert((await evidence.innerText()).includes('3届金球'));
        await capture(page, `legends-${width}`);
        await evidence.click();
        await page.locator('#player-awards').waitFor();
        await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
        await context.setOffline(true);
        await page.reload({ waitUntil: 'networkidle' });
        await page.locator('#player-awards').waitFor();
        assert.equal(await page.locator('#player-awards').getByText('综合83（测试记录）', { exact: true }).count(), 3);
        await context.setOffline(false);
        await page.goto(url + '/settings', { waitUntil: 'networkidle' });
        const downloadEvent = page.waitForEvent('download');
        await page.getByRole('button', { name: /^导出存档/ }).click();
        const download = await downloadEvent;
        const content = readFileSync((await download.path())!, 'utf8');
        const saved = JSON.parse(LZ.decompressFromUTF16(content) || content);
        assert.deepEqual(saved.state.world.retirementHistory.find((entry: { uuid: string }) => entry.uuid === defender.uuid).careerSummary,
          retiredWorld.retirementHistory.find(entry => entry.uuid === defender.uuid)!.careerSummary);
      }
      report.push({ width, scenario, passed: true });
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/report.json`, JSON.stringify({ report, errors, fixtures: 'isolated boundary fixtures derived from four independently simulated seasons' }, null, 2));
} finally { await browser.close(); }
console.log('Player exposure browser checks passed: ' + output);

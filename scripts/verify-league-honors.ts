import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import LZ from 'lz-string';
import { repairLeagueHonors } from '../src/engine/honors/repair-league-honors';
import { APP_VERSION } from '../src/version';
import type { Trophy } from '../src/types/team';

const output = `output/playwright/league-honors-v${APP_VERSION}`;
const url = process.env.CONTEST_PREVIEW_URL ?? 'http://127.0.0.1:4185';
const key = 'football-contest-three-shores-v1:football-universe-save';
const fixture = process.env.HONORS_SAVE_FIXTURE ?? 'output/contest-delivery-v4618/production/raw/s5-start-state.json';
mkdirSync(output, { recursive: true });
const decode = (raw: string) => JSON.parse(LZ.decompressFromUTF16(raw) || raw);
const browser = await chromium.launch();
const report: unknown[] = [];
const errors: string[] = [];
async function capture(page: Page, name: string) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: overflow`);
  assert.deepEqual(await page.evaluate(() => ['__gameStore', '__appUpdateAudit'].filter(k => k in window)), []);
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true, animations: 'disabled' });
}
async function exported(page: Page) {
  await page.goto(url + '/settings', { waitUntil: 'networkidle' });
  // Check the running document's local identity, not a remote version response.
  await page.locator('p').filter({ hasText: new RegExp(`^v${APP_VERSION.replaceAll('.', '\\.')} · .+ · three-shores-v1 · by KurtDubain$`) }).waitFor();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: /^导出存档/ }).click();
  const download = await event;
  return decode(readFileSync((await download.path())!, 'utf8'));
}
async function inspect(page: Page, world: ReturnType<typeof repairLeagueHonors>, suffix: string) {
  const teamId = 'hokkaido';
  assert.equal(world.honorHistory.find(h => h.seasonNumber === 1)?.league3Champion, teamId);
  const trophies = world.teamTrophies[teamId];
  assert(trophies.some(t => t.type === 'league3' && t.seasonNumber === 1));
  await page.goto(url + '/team/' + teamId, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: '历史', exact: true }).click();
  await page.getByRole('heading', { name: `奖杯柜 (${trophies.length})`, exact: true }).waitFor();
  await page.getByText('历史赛季记录', { exact: true }).scrollIntoViewIfNeeded();
  await capture(page, `${suffix}-team-history`);
  const coachId = Object.entries(world.coachCareers).find(([, entries]) => entries.some(e =>
    e.teamId === teamId && e.trophies.some(t => t.type === 'league3' && t.seasonNumber === 1)))?.[0];
  assert(coachId, 'Morning Light champion coach must be evidenced');
  await page.goto(url + '/coach/' + coachId, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: /奖杯柜/ }).scrollIntoViewIfNeeded();
  await capture(page, `${suffix}-coach-trophies`);
  await page.getByRole('heading', { name: /执教履历/ }).scrollIntoViewIfNeeded();
  await capture(page, `${suffix}-coach-career`);
}
try {
  for (const mode of ['fresh', 'legacy']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
    let expected;
    if (mode === 'legacy') {
      const state = JSON.parse(readFileSync(fixture, 'utf8'));
      const raw = state.origins.flatMap((o: { localStorage: { name: string; value: string }[] }) => o.localStorage)
        .find((entry: { name: string }) => entry.name === key).value;
      const original = decode(raw);
      const skippedCoaches: (Trophy & { teamId: string })[] = [];
      expected = repairLeagueHonors(original.state.world, (teamId, trophy) => skippedCoaches.push({ teamId, ...trophy }));
      const protectedKeys = Object.keys(expected).filter(k => !['teamTrophies', 'coachTrophies', 'coachCareers', 'coachRetirementHistory'].includes(k));
      for (const field of protectedKeys) assert.deepEqual(expected[field as keyof typeof expected], original.state.world[field], field);
      assert.deepEqual(repairLeagueHonors(expected), expected);
      report.push({ mode, skippedCoaches, preservedFields: protectedKeys,
        beforeTrophies: original.state.world.teamTrophies, afterTrophies: expected.teamTrophies });
      await context.addInitScript(({ key, raw }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, raw); }, { key, raw });
    }
    await page.goto(url, { waitUntil: 'networkidle' });
    if (mode === 'fresh') {
      await page.getByRole('button', { name: /草根长征/ }).click();
      await page.getByTestId('start-observation').click();
      await page.getByTestId('dashboard').waitFor();
      await page.getByRole('button', { name: '打开快进菜单' }).click();
      await page.getByTestId('skip-current-season').click();
      await page.getByTestId('confirm-skip-current-season').click();
      await page.getByRole('tab', { name: 'S1档案', exact: true }).waitFor({ timeout: 90000 });
      await page.getByRole('tab', { name: 'S1档案', exact: true }).click();
      await capture(page, 'fresh-season-archive');
      if (await page.getByTestId('season-handoff-transfer').count()) {
        await page.getByTestId('season-handoff-transfer').click();
        await page.getByRole('button', { name: '全自动剩余', exact: true }).click();
      }
      await page.getByTestId('dashboard').waitFor();
    }
    const saved = await exported(page);
    if (expected) assert.deepEqual(saved.state.world, expected);
    await inspect(page, saved.state.world, mode);
    await page.reload({ waitUntil: 'networkidle' });
    const reloaded = await exported(page);
    assert.deepEqual(reloaded.state.world, saved.state.world, 'reload must not duplicate trophies or mutate simulation');
    report.push({ mode, refreshStable: true, season: saved.state.world.seasonState.seasonNumber });
    await context.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/report.json`, JSON.stringify({ version: APP_VERSION, report, errors }, null, 2));
  console.log(`League honors browser checks passed: ${output}`);
} finally { await browser.close(); }

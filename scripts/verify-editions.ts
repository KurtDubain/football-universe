import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import LZString from 'lz-string';
import forbidden from './contest-forbidden-content.json';

const output = 'output/playwright/editions';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report: unknown[] = [];
let personalRaw: string | null = null;
let personalTemplate = '';
try {
  for (const edition of ['personal', 'contest']) for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    const url = edition === 'contest' ? process.env.CONTEST_PREVIEW_URL ?? 'http://127.0.0.1:4185' : process.env.PERSONAL_PREVIEW_URL ?? 'http://127.0.0.1:4186';
    const context = await browser.newContext({ viewport });
    if (edition === 'contest') {
      assert(personalRaw, 'personal save fixture was not captured');
      await context.addInitScript(({ raw, template }) => {
        if (!localStorage.getItem('football-universe-save')) localStorage.setItem('football-universe-save', raw);
        if (!localStorage.getItem('custom-teams-template')) localStorage.setItem('custom-teams-template', template);
      }, { raw: personalRaw, template: personalTemplate });
    }
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
    const prefix = edition + '-' + viewport.width;
    const check = async (name: string) => {
      console.log(prefix + ': ' + name);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ': overflow');
      assert.deepEqual(await page.evaluate(() => ['__gameStore', '__appUpdateAudit'].filter(k => k in window)), []);
      if (edition === 'contest') {
        const text = await page.locator('body').innerText();
        assert.deepEqual(forbidden.terms.filter(t => text.includes(t)), [], name + ': personal text');
      }
      await page.screenshot({ path: output + '/' + prefix + '-' + name + '.png', animations: 'disabled' });
    };
    await page.goto(url + '/?audit=1', { waitUntil: 'networkidle' });
    await check('welcome');
    await page.getByTestId('start-observation').click();
    await page.getByTestId('dashboard').waitFor();
    await check('opening');
    await page.getByRole('button', { name: /做出本轮观察判断/ }).click();
    await page.getByTestId('observation-panel').getByRole('tab', { name: '总进球' }).click();
    await page.getByTestId('observation-panel').getByRole('button', { name: '3+ 球' }).click();
    await page.getByTestId('focus-watch-toggle').first().click();
    await page.getByTestId('dashboard-advance').click();
    await page.getByTestId('key-match-opener').waitFor({ timeout: 30000 });
    await check('live-opener');
    await page.getByRole('button', { name: '跳过转播开场' }).click();
    await page.locator('canvas').first().waitFor();
    await page.waitForTimeout(1500);
    await check('live');
    await page.getByRole('button', { name: /跳过/ }).last().click();
    await page.getByText('全场结束', { exact: true }).waitFor();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByTestId('observation-settlement').waitFor({ timeout: 30000 });
    await check('report');
    await page.getByRole('button', { name: '打开快进菜单' }).click();
    await page.getByTestId('skip-current-season').click();
    await page.getByTestId('confirm-skip-current-season').click();
    await page.getByRole('tab', { name: 'S1档案', exact: true }).waitFor({ timeout: 90000 });
    await page.getByRole('tab', { name: 'S1档案', exact: true }).click();
    await check('archive');
    await page.getByTestId('season-handoff-transfer').click();
    await page.getByRole('button', { name: '全自动剩余', exact: true }).click();
    await page.getByTestId('dashboard').waitFor();
    for (const [name, route] of [['teams', '/teams'], ['team', '/team/datong'], ['coach', '/coach/coach_ancelotti'], ['history', '/history'], ['settings', '/settings']]) {
      await page.goto(url + route, { waitUntil: 'networkidle' });
      await check(name);
    }
    assert.equal(await page.locator('label').filter({ hasText: '导入存档' }).count(), edition === 'contest' ? 0 : 1);
    await page.getByText(edition === 'contest' ? /three-shores-v1/ : /personal-v1/).scrollIntoViewIfNeeded();
    await check('edition-label');
    if (edition === 'contest') {
      await page.route('**/version.json?*', route => route.fulfill({ json: { version: '99.0.0', buildId: 'personal-foreign', edition: 'personal', presetId: 'personal-v1' } }));
      await page.getByTestId('check-app-update').click();
      await page.getByTestId('app-update-status').filter({ hasText: '暂时无法检查' }).waitFor();
      await page.unroute('**/version.json?*');
    }
    await page.getByTestId('check-app-update').click();
    await page.getByTestId('app-update-status').filter({ hasText: '已是最新版' }).waitFor();
    const keys = await page.evaluate(() => Object.keys(localStorage));
    const saveKey = edition === 'personal' ? 'football-universe-save' : 'football-contest-three-shores-v1:football-universe-save';
    assert(keys.includes(saveKey));
    const raw = await page.evaluate(key => localStorage.getItem(key), saveKey);
    assert(raw);
    const text = LZString.decompressFromUTF16(raw) || raw;
    const save = JSON.parse(text);
    if (edition === 'personal') {
      personalRaw = raw;
      personalTemplate = JSON.stringify(Object.values(save.state.world.teamBases));
    }
    assert.equal(save.state.world.seasonState.seasonNumber, 2);
    if (edition === 'contest') {
      assert.equal(save.edition, 'contest');
      assert.equal(save.presetId, 'three-shores-v1');
      assert.equal(await page.evaluate(() => localStorage.getItem('football-universe-save')), personalRaw);
      assert.equal(await page.evaluate(() => localStorage.getItem('custom-teams-template')), personalTemplate);
      assert.deepEqual(forbidden.terms.filter(t => text.includes(t)), []);
    }
    await page.getByRole('button', { name: /^导出存档/ }).click();
    await page.goto(url + '/team-editor', { waitUntil: 'networkidle' });
    if (edition === 'contest') {
      await page.waitForURL(url + '/');
      await page.getByTestId('dashboard').waitFor();
      await check('blocked-editor');
    }
    await page.goto(url + '/', { waitUntil: 'networkidle' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('dashboard').waitFor({ timeout: 10000 }).catch(async error => {
      await page.screenshot({ path: output + '/' + prefix + '-reload-failure.png' });
      console.log(await page.locator('body').innerText(), errors);
      console.log(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.endsWith('-invalid')))));
      throw error;
    });
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('dashboard').waitFor();
    await check('offline');
    await context.setOffline(false);
    assert.deepEqual(errors, []);
    report.push({ edition, viewport, saveKey, season: 2, offline: true, errors });
    await context.close();
  }
  writeFileSync(output + '/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }

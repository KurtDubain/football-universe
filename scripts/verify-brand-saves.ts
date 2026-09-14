import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import LZString from 'lz-string';

const fixtures = process.env.BRAND_SAVE_FIXTURES ?? 'output/tencent-deploy-2026-09-14/online-qa/diagnostic-rerun';
const output = 'output/playwright/brand-v4.61.9/old-saves';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = [];
try {
  for (const edition of ['personal', 'contest']) {
    const raw = readFileSync(`${fixtures}/${edition}-1280-save.json`, 'utf8');
    const old = JSON.parse(raw);
    const key = edition === 'personal' ? 'football-universe-save' : 'football-contest-three-shores-v1:football-universe-save';
    const url = edition === 'personal' ? 'http://127.0.0.1:4186' : 'http://127.0.0.1:4185';
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(({ key, raw }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, raw); }, { key, raw });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.getByTestId('dashboard').waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('dashboard').waitFor();
    await page.getByTestId('dashboard-advance').click();
    await page.waitForTimeout(2500);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('dashboard').waitFor();
    const savedRaw = await page.evaluate(key => localStorage.getItem(key), key);
    assert(savedRaw);
    const saved = JSON.parse(LZString.decompressFromUTF16(savedRaw) || savedRaw);
    assert.equal(saved.state.world.seasonState.seasonNumber, old.state.world.seasonState.seasonNumber);
    assert(saved.state.world.seasonState.currentWindowIndex > old.state.world.seasonState.currentWindowIndex);
    assert.equal(saved.version, old.version);
    assert.equal(saved.edition, old.edition);
    assert.equal(saved.presetId, old.presetId);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/${edition}-continued.png` });
    report.push({ edition, schema: saved.version, beforeWindow: old.state.world.seasonState.currentWindowIndex, afterWindow: saved.state.world.seasonState.currentWindowIndex, errors });
    await context.close();
  }
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(report);
} finally { await browser.close(); }

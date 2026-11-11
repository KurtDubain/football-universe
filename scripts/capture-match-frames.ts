import { chromium, type Page } from 'playwright';
import * as fs from 'node:fs';

const baseUrl = (process.env.CAPTURE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const outDir = process.env.CAPTURE_DIR ?? '/tmp/anim-frames';
const seed = Number(process.env.CAPTURE_SEED ?? 20260722);
const width = Number(process.env.CAPTURE_W ?? 390);
const height = Number(process.env.CAPTURE_H ?? 844);
const dpr = Number(process.env.CAPTURE_DPR ?? 3);
const modeKey = process.env.CAPTURE_MODE ?? 'highlights';
const MODE_LABEL: Record<string, string> = { highlights: '精华', live: '完整', immersive: '沉浸' };
const modeLabel = MODE_LABEL[modeKey] ?? '精华';
const frameCount = Number(process.env.CAPTURE_FRAMES ?? 40);
const frameGapMs = Number(process.env.CAPTURE_GAP ?? 110);

async function boot(page: Page): Promise<void> {
  await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean((window as unknown as { __gameStore?: unknown }).__gameStore));
  await page.evaluate(async (s) => {
    type AuditState = {
      newGame: (seed: number) => Promise<void>;
      setFavoriteTeam: (teamId: string) => void;
      getCurrentWindow: () => { fixtures: Array<{ homeTeamId: string }> } | null;
    };
    const store = (window as unknown as { __gameStore?: { getState: () => AuditState } }).__gameStore;
    if (!store) throw new Error('no store');
    await store.getState().newGame(s);
    const fixture = store.getState().getCurrentWindow()?.fixtures[0];
    if (!fixture) throw new Error('no fixture');
    store.getState().setFavoriteTeam(fixture.homeTeamId);
  }, seed);
  await page.getByTestId('dashboard').waitFor({ state: 'visible' });
  const toggle = page.getByTestId('focus-watch-toggle').first();
  await toggle.waitFor({ state: 'visible' });
  await toggle.click();
  const advance = page.getByTestId('dashboard-advance');
  await advance.click();
  const opener = page.getByTestId('key-match-opener');
  await opener.waitFor({ state: 'visible', timeout: 20_000 });
  await page.getByRole('button', { name: '跳过转播开场' }).click();
  await opener.waitFor({ state: 'detached' });
  const modeButton = page.getByRole('button', { name: modeLabel, exact: true });
  try {
    await modeButton.click({ timeout: 15_000 });
  } catch {
    const labels = await page.evaluate(() => Array.from(document.querySelectorAll('button'))
      .map(b => (b.textContent ?? '').trim()).filter(Boolean).slice(0, 60));
    await page.screenshot({ path: `${outDir}/debug-no-mode.png` });
    throw new Error('mode button not found; buttons=' + JSON.stringify(labels));
  }
  await page.locator('canvas').first().waitFor({ state: 'visible' });
}

async function main(): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) fs.unlinkSync(`${outDir}/${f}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dpr,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));

  await boot(page);

  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${outDir}/layout-full.png` });

  const states: unknown[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    await canvas.screenshot({ path: `${outDir}/f${String(i).padStart(3, '0')}.png` });
    const raw = await page.evaluate(() => {
      const w = window as unknown as { render_game_to_text?: () => string };
      if (!w.render_game_to_text) return null;
      try { return JSON.parse(w.render_game_to_text()); } catch { return null; }
    });
    states.push(raw);
    await page.waitForTimeout(frameGapMs);
  }
  fs.writeFileSync(`${outDir}/states.json`, JSON.stringify(states, null, 1));

  const metrics = await page.evaluate(() => {
    const w = window as unknown as { __pitchMetrics?: unknown; render_game_to_text?: () => string };
    return { metrics: w.__pitchMetrics ?? null, text: w.render_game_to_text ? w.render_game_to_text().slice(0, 1200) : null };
  });

  console.log(JSON.stringify({ box, errors, metrics }, null, 2));
  await context.close();
  await browser.close();
}

await main();

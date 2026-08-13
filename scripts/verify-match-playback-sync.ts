import { chromium } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
const page = await context.newPage();
const errors: string[] = [];
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('pageerror', error => errors.push(error.message));

try {
  await page.goto(`${baseUrl}/scripts/fixtures/animation-preview.html?sameMinute=1`, { waitUntil: 'networkidle' });
  const dialog = page.getByRole('dialog', { name: '比赛直播回放' });
  await dialog.getByRole('button', { name: '精华', exact: true }).click();

  const score = dialog.locator('[aria-label="主队比分"]');
  const preImpact = await page.waitForFunction(() => {
    const render = (window as typeof window & { render_game_to_text?: () => string }).render_game_to_text;
    if (!render) return false;
    const state = JSON.parse(render()) as {
      phase: string;
      event: { type: string; attackerId?: string } | null;
      action: { kind: string; progress: number } | null;
      playback: { sceneMinute: number | null };
    };
    if (
      state.playback.sceneMinute !== 40
      || state.phase !== 'shooting'
      || state.event?.type !== 'goal'
      || state.event.attackerId !== 'home-10'
      || state.action?.kind !== 'shot'
      || state.action.progress >= 0.72
    ) return false;
    return document.querySelector('[aria-label="主队比分"]')?.textContent;
  }, undefined, { timeout: 35_000 });
  if (await preImpact.jsonValue() !== '0') throw new Error('First goal committed before ball impact');

  await page.waitForFunction(() => document.querySelector('[aria-label="主队比分"]')?.textContent === '1', undefined, { timeout: 8_000 });
  const secondPreImpact = await page.waitForFunction(() => {
    const render = (window as typeof window & { render_game_to_text?: () => string }).render_game_to_text;
    if (!render) return false;
    const state = JSON.parse(render()) as {
      phase: string;
      event: { type: string; attackerId?: string } | null;
      action: { kind: string; progress: number } | null;
      playback: { sceneMinute: number | null };
    };
    if (
      state.playback.sceneMinute !== 40
      || state.phase !== 'shooting'
      || state.event?.type !== 'goal'
      || state.event.attackerId !== 'home-11'
      || state.action?.kind !== 'shot'
      || state.action.progress >= 0.72
    ) return false;
    return document.querySelector('[aria-label="主队比分"]')?.textContent;
  }, undefined, { timeout: 12_000 });
  if (await secondPreImpact.jsonValue() !== '1') throw new Error('Same-minute goals collapsed before second impact');

  await page.waitForFunction(() => document.querySelector('[aria-label="主队比分"]')?.textContent === '2', undefined, { timeout: 8_000 });
  const screenshot = '/tmp/football-match-playback-sync.png';
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  if (errors.length > 0) throw new Error(`Runtime errors: ${errors.join(' | ')}`);

  console.log(JSON.stringify({
    passed: true,
    score: await score.textContent(),
    firstPreImpactScore: await preImpact.jsonValue(),
    secondPreImpactScore: await secondPreImpact.jsonValue(),
    screenshot,
  }, null, 2));
} finally {
  await browser.close();
}

import { chromium, type ConsoleMessage } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');

interface VerificationResult {
  viewport: string;
  canvas: { cssWidth: number; cssHeight: number; width: number; height: number; opaqueSamples: number };
  overlayZ: number;
  stickyZ: number;
  undersizedButtons: string[];
  ballMoved: boolean;
  screenshot: string;
}

function captureError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
}

async function verifyViewport(
  name: 'desktop' | 'mobile',
  viewport: { width: number; height: number },
  deviceScaleFactor: number,
): Promise<VerificationResult> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport, deviceScaleFactor });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', message => captureError(message, errors));
  page.on('pageerror', error => errors.push(error.message));

  try {
    await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean((window as typeof window & { __gameStore?: unknown }).__gameStore));
    await page.evaluate(() => {
      const store = (window as typeof window & {
        __gameStore?: { getState: () => Record<string, unknown> };
      }).__gameStore;
      const state = store?.getState() as {
        newGame: (seed: number) => void;
      };
      state.newGame(20260716);
    });
    await page.getByRole('button', { name: '比赛日' }).waitFor({ state: 'visible' });
    await page.evaluate(() => {
      const store = (window as typeof window & {
        __gameStore?: { getState: () => Record<string, unknown> };
      }).__gameStore;
      const state = store?.getState() as {
        getCurrentWindow: () => { fixtures: Array<{ id: string }> } | null;
        toggleStarFixture: (id: string) => void;
        advanceWindow: () => void;
      };
      let current = state.getCurrentWindow();
      for (let step = 0; step < 5 && !current?.fixtures.length; step++) {
        state.advanceWindow();
        current = state.getCurrentWindow();
      }
      const fixture = current?.fixtures[0];
      if (!fixture) throw new Error('No fixture available for match presentation verification');
      state.toggleStarFixture(fixture.id);
      state.advanceWindow();
    });

    const dialog = page.getByRole('dialog', { name: '比赛直播回放' });
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    const canvas = dialog.getByTestId('pitch-canvas');
    await canvas.waitFor({ state: 'visible' });
    await page.waitForTimeout(300);

    const before = await page.evaluate(() => {
      const render = (window as typeof window & { render_game_to_text?: () => string }).render_game_to_text;
      return render ? JSON.parse(render()) as { ball: { x: number; y: number } } : null;
    });
    await page.evaluate(() => (window as typeof window & { advanceTime?: (ms: number) => void }).advanceTime?.(500));
    const after = await page.evaluate(() => {
      const render = (window as typeof window & { render_game_to_text?: () => string }).render_game_to_text;
      return render ? JSON.parse(render()) as { ball: { x: number; y: number } } : null;
    });

    const metrics = await canvas.evaluate(element => {
      const pitch = element as HTMLCanvasElement;
      const rect = pitch.getBoundingClientRect();
      const context2d = pitch.getContext('2d');
      const pixels = context2d?.getImageData(0, 0, pitch.width, pitch.height).data;
      let opaqueSamples = 0;
      if (pixels) {
        const stride = Math.max(4, Math.floor(pixels.length / 512 / 4) * 4);
        for (let index = 3; index < pixels.length; index += stride) {
          if (pixels[index] > 0) opaqueSamples++;
        }
      }
      return { cssWidth: rect.width, cssHeight: rect.height, width: pitch.width, height: pitch.height, opaqueSamples };
    });
    const layers = await page.evaluate(() => {
      const overlay = document.querySelector('[role="dialog"][aria-label="比赛直播回放"]');
      const sticky = document.querySelector('.sticky');
      return {
        overlayZ: Number(overlay ? getComputedStyle(overlay).zIndex : 0),
        stickyZ: Number(sticky ? getComputedStyle(sticky).zIndex : 0),
      };
    });
    const undersizedButtons = await dialog.locator('button:visible').evaluateAll(buttons => buttons.flatMap(button => {
      const rect = button.getBoundingClientRect();
      return rect.width < 44 || rect.height < 44 ? [(button.textContent ?? button.getAttribute('aria-label') ?? '').trim()] : [];
    }));
    const screenshot = `/tmp/football-match-live-${name}.png`;
    await page.screenshot({ path: screenshot, fullPage: false });

    if (metrics.opaqueSamples < 20) throw new Error(`${name}: pitch canvas is blank`);
    if (metrics.width / metrics.cssWidth < deviceScaleFactor * 0.9) throw new Error(`${name}: pitch canvas backing buffer is not DPR-aware`);
    if (layers.overlayZ <= layers.stickyZ) throw new Error(`${name}: live overlay is below sticky controls`);
    if (name === 'mobile' && undersizedButtons.length > 0) throw new Error(`${name}: undersized live buttons: ${undersizedButtons.join(', ')}`);
    if (!before || !after || (before.ball.x === after.ball.x && before.ball.y === after.ball.y)) throw new Error(`${name}: deterministic time step did not move the ball`);
    if (errors.length > 0) throw new Error(`${name}: runtime errors: ${errors.join(' | ')}`);

    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    return {
      viewport: `${viewport.width}x${viewport.height}@${deviceScaleFactor}`,
      canvas: metrics,
      ...layers,
      undersizedButtons,
      ballMoved: true,
      screenshot,
    };
  } finally {
    await browser.close();
  }
}

const results = [
  await verifyViewport('desktop', { width: 1440, height: 900 }, 2),
  await verifyViewport('mobile', { width: 390, height: 844 }, 3),
];
console.log(JSON.stringify({ passed: true, results }, null, 2));

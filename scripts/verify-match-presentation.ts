import { chromium, type ConsoleMessage } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');

interface VerificationResult {
  viewport: string;
  canvas: { cssWidth: number; cssHeight: number; width: number; height: number; opaqueSamples: number; effectiveDpr: number };
  overlayZ: number;
  stickyZ: number;
  undersizedButtons: string[];
  ballMoved: boolean;
  rendering: {
    quality: string;
    particleCap: number;
    pauseFramesAdded: number;
    completedFramesAdded: number;
    completedPauseReason: string;
  };
  screenshot: string;
}

function captureError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
}

async function verifyViewport(
  name: 'desktop' | 'mobile' | 'mobile-reduced',
  viewport: { width: number; height: number },
  deviceScaleFactor: number,
  reducedMotion: 'reduce' | 'no-preference' = 'no-preference',
): Promise<VerificationResult> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport, deviceScaleFactor, reducedMotion });
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
    await page.evaluate(async () => {
      const store = (window as typeof window & {
        __gameStore?: { getState: () => Record<string, unknown> };
      }).__gameStore;
      const state = store?.getState() as {
        getCurrentWindow: () => { fixtures: Array<{ id: string }> } | null;
        toggleStarFixture: (id: string) => void;
        advanceWindow: () => Promise<void>;
      };
      let current = state.getCurrentWindow();
      for (let step = 0; step < 5 && !current?.fixtures.length; step++) {
        await state.advanceWindow();
        current = state.getCurrentWindow();
      }
      const fixture = current?.fixtures[0];
      if (!fixture) throw new Error('No fixture available for match presentation verification');
      state.toggleStarFixture(fixture.id);
      await state.advanceWindow();
    });

    const dialog = page.getByRole('dialog', { name: '比赛直播回放' });
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    const canvas = dialog.getByTestId('pitch-canvas');
    await canvas.waitFor({ state: 'visible' });
    await page.waitForTimeout(300);

    const before = await page.evaluate(() => {
      const render = (window as typeof window & { render_game_to_text?: () => string }).render_game_to_text;
      return render ? JSON.parse(render()) as {
        ball: { x: number; y: number };
        rendering: { renderedFrames: number; quality: string; particleCap: number; pauseReason: string };
      } : null;
    });
    await page.evaluate(() => (window as typeof window & { advanceTime?: (ms: number) => void }).advanceTime?.(500));
    const after = await page.evaluate(() => {
      const render = (window as typeof window & { render_game_to_text?: () => string }).render_game_to_text;
      return render ? JSON.parse(render()) as {
        ball: { x: number; y: number };
        rendering: { renderedFrames: number; quality: string; particleCap: number; pauseReason: string };
      } : null;
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
      return {
        cssWidth: rect.width,
        cssHeight: rect.height,
        width: pitch.width,
        height: pitch.height,
        opaqueSamples,
        effectiveDpr: pitch.width / rect.width,
      };
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
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    await page.screenshot({ path: screenshot, fullPage: false, animations: 'disabled' });

    if (metrics.opaqueSamples < 20) throw new Error(`${name}: pitch canvas is blank`);
    const expectedDpr = reducedMotion === 'reduce' ? 1.5 : name === 'desktop' ? 2 : 2;
    if (Math.abs(metrics.effectiveDpr - expectedDpr) > 0.15) {
      throw new Error(`${name}: expected capped DPR ${expectedDpr}, found ${metrics.effectiveDpr.toFixed(2)}`);
    }
    if (layers.overlayZ <= layers.stickyZ) throw new Error(`${name}: live overlay is below sticky controls`);
    if (name === 'mobile' && undersizedButtons.length > 0) throw new Error(`${name}: undersized live buttons: ${undersizedButtons.join(', ')}`);
    if (!before || !after || (before.ball.x === after.ball.x && before.ball.y === after.ball.y)) throw new Error(`${name}: deterministic time step did not move the ball`);
    if (errors.length > 0) throw new Error(`${name}: runtime errors: ${errors.join(' | ')}`);

    await dialog.getByRole('button', { name: '暂停' }).click();
    await page.waitForTimeout(150);
    const pausedStart = await page.evaluate(() => JSON.parse(
      (window as typeof window & { render_game_to_text: () => string }).render_game_to_text(),
    ).rendering.renderedFrames as number);
    await page.waitForTimeout(250);
    const pausedEnd = await page.evaluate(() => JSON.parse(
      (window as typeof window & { render_game_to_text: () => string }).render_game_to_text(),
    ).rendering.renderedFrames as number);
    const pauseFramesAdded = pausedEnd - pausedStart;
    if (pauseFramesAdded > 0) throw new Error(`${name}: canvas kept rendering while paused (${pauseFramesAdded} frames)`);

    await dialog.getByRole('button', { name: '继续' }).click();
    await page.waitForTimeout(100);
    await dialog.getByRole('button', { name: /跳过/ }).click();
    await page.waitForTimeout(100);
    const completedStart = await page.evaluate(() => JSON.parse(
      (window as typeof window & { render_game_to_text: () => string }).render_game_to_text(),
    ).rendering as { renderedFrames: number; pauseReason: string });
    await page.waitForTimeout(250);
    const completedEnd = await page.evaluate(() => JSON.parse(
      (window as typeof window & { render_game_to_text: () => string }).render_game_to_text(),
    ).rendering as { renderedFrames: number; pauseReason: string });
    const completedFramesAdded = completedEnd.renderedFrames - completedStart.renderedFrames;
    if (completedFramesAdded > 0 || completedEnd.pauseReason !== 'completed') {
      throw new Error(`${name}: completed canvas did not stop (${completedFramesAdded}, ${completedEnd.pauseReason})`);
    }

    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    return {
      viewport: `${viewport.width}x${viewport.height}@${deviceScaleFactor}`,
      canvas: metrics,
      ...layers,
      undersizedButtons,
      ballMoved: true,
      rendering: {
        quality: after.rendering.quality,
        particleCap: after.rendering.particleCap,
        pauseFramesAdded,
        completedFramesAdded,
        completedPauseReason: completedEnd.pauseReason,
      },
      screenshot,
    };
  } finally {
    await browser.close();
  }
}

const results = [
  await verifyViewport('desktop', { width: 1440, height: 900 }, 2),
  await verifyViewport('mobile', { width: 390, height: 844 }, 3),
  await verifyViewport('mobile-reduced', { width: 390, height: 844 }, 3, 'reduce'),
];
console.log(JSON.stringify({ passed: true, results }, null, 2));

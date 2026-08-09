import { chromium } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');

interface PitchState {
  minute: number;
  phase: string;
  event: { type: string; outcome: string } | null;
  ball: { x: number; y: number; elevation: number };
  camera: { zoom: number };
  playback: { holdingClock: boolean; sceneMinute: number | null; queuedScenes: number };
  rendering: { active: boolean; pauseReason: string; renderedFrames: number };
  action: {
    kind: 'pass' | 'shot';
    setPiece?: string;
    sourceOverride?: { x: number; y: number };
    progress: number;
  } | null;
  homeOnField: Array<{ id: string; slot: number; x: number; y: number }>;
  awayOnField: Array<{ id: string; slot: number; x: number; y: number }>;
}

async function verifyViewport(name: string, width: number, height: number) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: width < 600 ? 3 : 2,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));

  const readState = () => page.evaluate(() => JSON.parse(
    (window as typeof window & { render_game_to_text: () => string }).render_game_to_text(),
  ) as PitchState);
  const waitForSetPiece = async (type: 'corner' | 'free_kick', setPiece: string): Promise<PitchState> => {
    // Highlight playback now preserves the complete approach and halftime
    // rhythm, so later set pieces need room to arrive without treating the
    // intentionally slower presentation as a stalled canvas.
    const deadline = Date.now() + 45_000;
    const recentStates: string[] = [];
    const matchingStates: string[] = [];
    while (Date.now() < deadline) {
      const state = await readState();
      const summary = `${state.minute}:${state.event?.type ?? '-'}:${state.phase}:${state.action?.setPiece ?? '-'}:${state.action?.progress.toFixed(2) ?? '-'}:hold=${state.playback.holdingClock}:scene=${state.playback.sceneMinute ?? '-'}:queue=${state.playback.queuedScenes}:render=${state.rendering.active}/${state.rendering.pauseReason}/${state.rendering.renderedFrames}`;
      if (recentStates.at(-1) !== summary) {
        recentStates.push(summary);
        if (recentStates.length > 24) recentStates.shift();
      }
      if (state.event?.type === type && state.action?.setPiece === setPiece && matchingStates.at(-1) !== summary) {
        matchingStates.push(summary);
      }
      if (state.event?.type === type
        && state.action?.setPiece === setPiece
        && state.phase === 'holding') {
        return state;
      }
      await page.waitForTimeout(50);
    }
    throw new Error(`${name}: timed out waiting for ${type}/${setPiece}; runtime errors: ${errors.join(' | ') || 'none'}; matching states: ${matchingStates.join(', ')}; recent states: ${recentStates.join(', ')}`);
  };

  try {
    await page.goto(`${baseUrl}/scripts/fixtures/animation-preview.html`, { waitUntil: 'networkidle' });
    const dialog = page.getByRole('dialog', { name: '比赛直播回放' });
    await dialog.getByRole('button', { name: '精华', exact: true }).click();

    const corner = await waitForSetPiece('corner', 'corner');
    await dialog.getByRole('button', { name: '暂停', exact: true }).click();
    await page.screenshot({ path: `/tmp/football-set-piece-corner-${name}.png`, animations: 'disabled' });
    await dialog.getByRole('button', { name: '继续', exact: true }).click();

    const freeKick = await waitForSetPiece('free_kick', 'direct_free_kick');
    await dialog.getByRole('button', { name: '暂停', exact: true }).click();
    await page.screenshot({ path: `/tmp/football-set-piece-free-kick-${name}.png`, animations: 'disabled' });

    const cornerAttackersNearBox = corner.awayOnField.filter(player => player.slot !== 0 && player.x < 0.36).length;
    if (cornerAttackersNearBox < 4) throw new Error(`${name}: corner has only ${cornerAttackersNearBox} attackers near the box`);
    if (corner.ball.x >= 0.35) throw new Error(`${name}: corner delivery did not reach the attacking box`);

    const sourceX = freeKick.action?.sourceOverride?.x ?? 0;
    const wall = freeKick.awayOnField.filter(player => player.slot >= 1 && player.slot <= 4);
    if (wall.length < 3 || wall.some(player => player.x <= sourceX)) {
      throw new Error(`${name}: direct free-kick wall is not goal-side of the ball`);
    }
    const wallSpread = Math.max(...wall.map(player => player.y)) - Math.min(...wall.map(player => player.y));
    if (wallSpread < 0.07) throw new Error(`${name}: direct free-kick wall is not visibly formed`);
    if (width < 600 && Math.abs(freeKick.camera.zoom - 1) > 0.002) {
      throw new Error(`${name}: mobile set-piece camera should remain fixed (${freeKick.camera.zoom})`);
    }
    if (errors.length > 0) throw new Error(`${name}: runtime errors ${errors.join(' | ')}`);

    return {
      viewport: `${width}x${height}`,
      corner: { ball: corner.ball, attackersNearBox: cornerAttackersNearBox },
      freeKick: { ball: freeKick.ball, wallSpread, camera: freeKick.camera },
    };
  } finally {
    await browser.close();
  }
}

const results = [
  await verifyViewport('desktop', 1440, 900),
  await verifyViewport('mobile', 390, 844),
];

console.log(JSON.stringify({ passed: true, results }, null, 2));

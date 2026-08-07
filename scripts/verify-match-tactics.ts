import { chromium } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');

interface PitchState {
  phase: string;
  attackingSide: 'home' | 'away';
  ballHolderId: string | null;
  ball: { x: number; y: number; elevation: number };
  event: {
    type: string;
    attackerId?: string;
    creatorId?: string;
    defenderId?: string;
  } | null;
  lastTouchPlayerId: string | null;
  action: {
    kind: 'pass' | 'shot';
    passerIdx: number;
    sourceOverride?: { x: number; y: number };
  } | null;
  homeOnField: Array<{ id: string; x: number; y: number }>;
  awayOnField: Array<{ id: string; x: number; y: number }>;
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

  const waitForActors = async (
    type: string,
    attackerId: string,
    creatorId: string,
    defenderId?: string,
  ): Promise<PitchState> => {
    await page.waitForFunction(({ expectedType, expectedAttacker, expectedCreator, expectedDefender }) => {
      const render = (window as typeof window & { render_game_to_text?: () => string }).render_game_to_text;
      if (!render) return false;
      const state = JSON.parse(render()) as PitchState;
      return state.event?.type === expectedType
        && state.event.attackerId === expectedAttacker
        && state.event.creatorId === expectedCreator
        && (!expectedDefender || state.event.defenderId === expectedDefender)
        && (state.ballHolderId === expectedAttacker || state.lastTouchPlayerId === expectedAttacker)
        && state.action?.kind === 'shot'
        && state.action.sourceOverride !== undefined
        && (() => {
          const attacker = [...state.homeOnField, ...state.awayOnField].find(player => player.id === expectedAttacker);
          if (!attacker) return false;
          return expectedAttacker.startsWith('home-') ? attacker.x > 0.7 : attacker.x < 0.3;
        })();
    }, {
      expectedType: type,
      expectedAttacker: attackerId,
      expectedCreator: creatorId,
      expectedDefender: defenderId,
    }, { timeout: 20_000 });
    return readState();
  };

  try {
    await page.goto(`${baseUrl}/scripts/fixtures/animation-preview.html`, { waitUntil: 'networkidle' });
    const dialog = page.getByRole('dialog', { name: '比赛直播回放' });
    await dialog.getByRole('button', { name: '精华', exact: true }).click();

    const saveState = await waitForActors('gk_save', 'away-9', 'away-7', 'home-1');
    const saveScreenshot = `/tmp/football-match-tactics-save-${name}.png`;
    await page.screenshot({ path: saveScreenshot, animations: 'disabled' });

    const goalState = await waitForActors('goal', 'home-10', 'home-7');
    const goalScreenshot = `/tmp/football-match-tactics-goal-${name}.png`;
    await page.screenshot({ path: goalScreenshot, animations: 'disabled' });

    if (saveState.attackingSide !== 'away') throw new Error(`${name}: save scene attacks from ${saveState.attackingSide}`);
    if (goalState.attackingSide !== 'home') throw new Error(`${name}: goal scene attacks from ${goalState.attackingSide}`);
    if (errors.length > 0) throw new Error(`${name}: runtime errors ${errors.join(' | ')}`);

    return {
      viewport: `${width}x${height}`,
      save: {
        attacker: saveState.event?.attackerId,
        creator: saveState.event?.creatorId,
        defender: saveState.event?.defenderId,
        ballHolder: saveState.ballHolderId,
        attackerPosition: [...saveState.homeOnField, ...saveState.awayOnField].find(player => player.id === 'away-9'),
        ball: saveState.ball,
        phase: saveState.phase,
        action: saveState.action,
        screenshot: saveScreenshot,
      },
      goal: {
        attacker: goalState.event?.attackerId,
        creator: goalState.event?.creatorId,
        ballHolder: goalState.ballHolderId,
        attackerPosition: [...goalState.homeOnField, ...goalState.awayOnField].find(player => player.id === 'home-10'),
        ball: goalState.ball,
        phase: goalState.phase,
        action: goalState.action,
        screenshot: goalScreenshot,
      },
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

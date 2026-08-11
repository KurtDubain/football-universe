import { chromium } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');

interface PitchState {
  phase: string;
  attackingSide: 'home' | 'away';
  ballHolderId: string | null;
  ball: { x: number; y: number; elevation: number };
  camera: { focusX: number; focusY: number; zoom: number };
  event: {
    type: string;
    outcome: string;
    attackerId?: string;
    creatorId?: string;
    defenderId?: string;
    target: { x: number; y: number };
  } | null;
  lastTouchPlayerId: string | null;
  action: {
    kind: 'pass' | 'shot';
    passerIdx: number;
    sourceOverride?: { x: number; y: number };
    progress: number;
  } | null;
  formations: {
    home: { formation: string; approach: string };
    away: { formation: string; approach: string };
  };
  homeOnField: Array<{ id: string; x: number; y: number; featured: boolean }>;
  awayOnField: Array<{ id: string; x: number; y: number; featured: boolean }>;
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
    const deadline = Date.now() + 20_000;
    const matchingStates: string[] = [];
    while (Date.now() < deadline) {
      const state = await readState();
      if (state.event?.type === type) {
        const attacker = [...state.homeOnField, ...state.awayOnField].find(player => player.id === attackerId);
        const summary = `${state.phase}:${state.action?.kind ?? '-'}:${state.action?.passerIdx ?? '-'}:${state.action?.progress.toFixed(2) ?? '-'}:${state.event.attackerId ?? '-'}:${state.event.creatorId ?? '-'}:${state.lastTouchPlayerId ?? '-'}:${attacker?.x.toFixed(2) ?? '-'}:ball-${state.ball.x.toFixed(3)}`;
        if (matchingStates.at(-1) !== summary) matchingStates.push(summary);
      }
      const attacker = [...state.homeOnField, ...state.awayOnField].find(player => player.id === attackerId);
      const attackerInFinalThird = attacker
        && (attackerId.startsWith('home-') ? attacker.x > 0.7 : attacker.x < 0.3);
      if (state.event?.type === type
        && state.event.attackerId === attackerId
        && state.event.creatorId === creatorId
        && (!defenderId || state.event.defenderId === defenderId)
        && (state.ballHolderId === attackerId || state.lastTouchPlayerId === attackerId)
        && state.action?.kind === 'shot'
        && state.action.progress >= 0.99
        && state.phase === 'holding'
        && state.action.sourceOverride !== undefined
        && (type !== 'gk_save' || state.ball.x > 0.015)
        && attackerInFinalThird) {
        return state;
      }
      await page.waitForTimeout(50);
    }
    throw new Error(`${name}: timed out waiting for ${type}; matching states: ${matchingStates.join(', ')}`);
  };

  try {
    await page.goto(`${baseUrl}/scripts/fixtures/animation-preview.html`, { waitUntil: 'networkidle' });
    const dialog = page.getByRole('dialog', { name: '比赛直播回放' });
    const initialState = await readState();
    if (initialState.formations.home.formation !== '4-3-3'
      || initialState.formations.home.approach !== 'pressing'
      || initialState.formations.away.formation !== '5-4-1'
      || initialState.formations.away.approach !== 'low_block') {
      throw new Error(`${name}: canvas did not consume the frozen tactical snapshots`);
    }
    const featuredIds = [...initialState.homeOnField, ...initialState.awayOnField]
      .filter(player => player.featured)
      .map(player => player.id)
      .sort();
    if (featuredIds.join(',') !== 'away-2,home-1,home-10') {
      throw new Error(`${name}: canvas focus identities drifted (${featuredIds.join(',')})`);
    }
    const tacticsText = await page.getByTestId('live-tactics-strip').innerText();
    if (!tacticsText.includes('4-3-3') || !tacticsText.includes('5-4-1')
      || !tacticsText.includes('主动压迫') || !tacticsText.includes('低位防守')) {
      throw new Error(`${name}: live tactical strip is incomplete (${tacticsText})`);
    }
    const focusText = await page.getByTestId('live-featured-players').innerText();
    if (!focusText.includes('HOME 10') || !focusText.includes('AWAY 2') || !focusText.includes('HOME 1')) {
      throw new Error(`${name}: live focus strip is incomplete (${focusText})`);
    }
    await dialog.getByRole('button', { name: '精华', exact: true }).click();

    await waitForActors('gk_save', 'away-9', 'away-7', 'home-1');
    await dialog.getByRole('button', { name: '暂停', exact: true }).click();
    await page.getByRole('button', { name: '继续', exact: true }).waitFor({ state: 'visible' });
    await page.evaluate(() => (window as typeof window & { advanceTime?: (milliseconds: number) => void }).advanceTime?.(300));
    const saveState = await readState();
    const saveScreenshot = `/tmp/football-match-tactics-save-${name}.png`;
    await page.screenshot({ path: saveScreenshot, animations: 'disabled' });

    await dialog.getByRole('button', { name: '继续', exact: true }).click();
    await waitForActors('df_block', 'home-10', 'home-7', 'away-2');
    await dialog.getByRole('button', { name: '暂停', exact: true }).click();
    await page.getByRole('button', { name: '继续', exact: true }).waitFor({ state: 'visible' });
    await page.evaluate(() => (window as typeof window & { advanceTime?: (milliseconds: number) => void }).advanceTime?.(300));
    const blockState = await readState();
    const blockScreenshot = `/tmp/football-match-tactics-block-${name}.png`;
    await page.screenshot({ path: blockScreenshot, animations: 'disabled' });

    await dialog.getByRole('button', { name: '继续', exact: true }).click();
    await waitForActors('goal', 'home-10', 'home-7');
    await dialog.getByRole('button', { name: '暂停', exact: true }).click();
    await page.getByRole('button', { name: '继续', exact: true }).waitFor({ state: 'visible' });
    await page.evaluate(() => (window as typeof window & { advanceTime?: (milliseconds: number) => void }).advanceTime?.(250));
    const goalState = await readState();
    const goalScreenshot = `/tmp/football-match-tactics-goal-${name}.png`;
    await page.screenshot({ path: goalScreenshot, animations: 'disabled' });

    if (saveState.attackingSide !== 'away') throw new Error(`${name}: save scene attacks from ${saveState.attackingSide}`);
    if (saveState.event?.outcome !== 'save' || saveState.ball.x < 0.03 || saveState.ball.elevation <= 0) {
      throw new Error(`${name}: saved shot did not produce a visible second ball`);
    }
    if (width < 600 && (saveState.camera.zoom <= 1.01 || saveState.camera.zoom > 1.08)) {
      throw new Error(`${name}: mobile save camera left its restrained focus range (${saveState.camera.zoom})`);
    }
    if (width >= 600 && (saveState.camera.zoom <= 1.025 || saveState.camera.zoom > 1.12)) {
      throw new Error(`${name}: desktop save camera did not enter a restrained danger focus (${saveState.camera.zoom})`);
    }
    const creditedBlocker = blockState.awayOnField.find(player => player.id === 'away-2');
    if (!creditedBlocker || !blockState.event) throw new Error(`${name}: credited blocker is missing`);
    const blockerDistance = Math.hypot(
      creditedBlocker.x - blockState.event.target.x,
      creditedBlocker.y - blockState.event.target.y,
    );
    if (blockerDistance > 0.12) {
      throw new Error(`${name}: credited blocker stayed ${blockerDistance.toFixed(3)} pitch units away from the shot line`);
    }
    if (goalState.attackingSide !== 'home') throw new Error(`${name}: goal scene attacks from ${goalState.attackingSide}`);
    if (errors.length > 0) throw new Error(`${name}: runtime errors ${errors.join(' | ')}`);

    await page.goto(`${baseUrl}/scripts/fixtures/animation-preview.html?shape=alternate`, { waitUntil: 'networkidle' });
    const alternateState = await readState();
    if (alternateState.formations.home.formation !== '4-2-3-1'
      || alternateState.formations.home.approach !== 'control'
      || alternateState.formations.away.formation !== '4-4-2'
      || alternateState.formations.away.approach !== 'counter') {
      throw new Error(`${name}: alternate formation pair did not reach Canvas`);
    }
    const alternateTacticsText = await page.getByTestId('live-tactics-strip').innerText();
    if (!alternateTacticsText.includes('4-2-3-1') || !alternateTacticsText.includes('4-4-2')) {
      throw new Error(`${name}: alternate live tactical strip is incomplete (${alternateTacticsText})`);
    }
    const alternateScreenshot = `/tmp/football-match-tactics-alternate-${name}.png`;
    await page.screenshot({ path: alternateScreenshot, animations: 'disabled' });
    if (errors.length > 0) throw new Error(`${name}: alternate runtime errors ${errors.join(' | ')}`);

    return {
      viewport: `${width}x${height}`,
      formations: initialState.formations,
      alternateFormations: alternateState.formations,
      featuredIds,
      alternateScreenshot,
      save: {
        attacker: saveState.event?.attackerId,
        creator: saveState.event?.creatorId,
        defender: saveState.event?.defenderId,
        ballHolder: saveState.ballHolderId,
        attackerPosition: [...saveState.homeOnField, ...saveState.awayOnField].find(player => player.id === 'away-9'),
        ball: saveState.ball,
        camera: saveState.camera,
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
        camera: goalState.camera,
        phase: goalState.phase,
        action: goalState.action,
        screenshot: goalScreenshot,
      },
      block: {
        defender: blockState.event?.defenderId,
        defenderPosition: creditedBlocker,
        target: blockState.event?.target,
        distance: blockerDistance,
        screenshot: blockScreenshot,
      },
    };
  } finally {
    await browser.close();
  }
}

const results = [
  await verifyViewport('desktop', 1440, 900),
  await verifyViewport('mobile-compact', 320, 568),
  await verifyViewport('mobile', 390, 844),
];

console.log(JSON.stringify({ passed: true, results }, null, 2));

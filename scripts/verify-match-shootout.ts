import { chromium } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');

async function verifyViewport(name: string, width: number, height: number) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: width < 600 ? 3 : 2 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));

  try {
    await page.goto(`${baseUrl}/scripts/fixtures/animation-preview.html?shootout=1`, { waitUntil: 'networkidle' });
    const dialog = page.getByRole('dialog', { name: '比赛直播回放' });
    await dialog.getByRole('button', { name: '精华', exact: true }).click();
    const tracker = dialog.getByTestId('shootout-tracker');
    await tracker.waitFor({ state: 'visible', timeout: 20_000 });
    await dialog.getByRole('button', { name: '暂停', exact: true }).click();
    await page.waitForTimeout(150);

    const minuteLabel = await dialog.getByTestId('live-minute').textContent();
    const state = await page.evaluate(() => JSON.parse(
      (window as typeof window & { render_game_to_text: () => string }).render_game_to_text(),
    ) as { homeOnField: unknown[]; awayOnField: unknown[]; event: { outcome: string } | null });
    const controlsOverflow = await dialog.getByTestId('live-controls').evaluate(element => element.scrollWidth - element.clientWidth);
    const dialogBox = await dialog.locator(':scope > div').boundingBox();
    const undersizedButtons = width < 600
      ? await dialog.locator('button:visible').evaluateAll(buttons => buttons.flatMap(button => {
        const rect = button.getBoundingClientRect();
        return rect.width < 44 || rect.height < 44 ? [(button.textContent ?? '').trim()] : [];
      }))
      : [];
    const screenshot = `/tmp/football-match-shootout-${name}.png`;
    await page.screenshot({ path: screenshot, animations: 'disabled' });

    if (!minuteLabel?.startsWith('点')) throw new Error(`${name}: shootout is still displayed as a match minute (${minuteLabel})`);
    if (!state.event) throw new Error(`${name}: shootout event scene was not active`);
    if (state.homeOnField.length + state.awayOnField.length !== 2) {
      throw new Error(`${name}: shootout scene rendered ${state.homeOnField.length + state.awayOnField.length} players`);
    }
    if (controlsOverflow > 1) throw new Error(`${name}: controls overflow by ${controlsOverflow}px`);
    if (undersizedButtons.length > 0) throw new Error(`${name}: undersized buttons ${undersizedButtons.join(', ')}`);
    if (!dialogBox || dialogBox.width > width || dialogBox.height > height) throw new Error(`${name}: dialog exceeds viewport`);
    if (errors.length > 0) throw new Error(`${name}: runtime errors ${errors.join(' | ')}`);

    return {
      viewport: `${width}x${height}`,
      minuteLabel,
      visiblePlayers: state.homeOnField.length + state.awayOnField.length,
      shotOutcome: state.event.outcome,
      controlsOverflow,
      screenshot,
    };
  } finally {
    await browser.close();
  }
}

const results = [
  await verifyViewport('desktop', 1440, 900),
  await verifyViewport('mobile-320', 320, 568),
  await verifyViewport('mobile', 390, 844),
];

console.log(JSON.stringify({ passed: true, results }, null, 2));

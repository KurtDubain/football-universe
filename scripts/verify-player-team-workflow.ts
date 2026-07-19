import { chromium, type ConsoleMessage, type Page } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const seed = 20260719;

const viewports = [
  { name: 'mobile-compact', width: 320, height: 568, isMobile: true, hasTouch: true },
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
] as const;

function captureConsoleError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
}

async function initializeGame(page: Page): Promise<{ teamId: string; playerId: string; teamName: string; playerName: string }> {
  await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean((window as typeof window & { __gameStore?: unknown }).__gameStore));
  return page.evaluate((gameSeed) => {
    type AuditState = {
      world: {
        teamBases: Record<string, { name: string }>;
        squads: Record<string, Array<{ uuid: string; name?: string; number: number }>>;
      };
      newGame: (seed: number) => void;
    };
    const store = (window as typeof window & { __gameStore?: { getState: () => AuditState } }).__gameStore;
    if (!store) throw new Error('Audit store unavailable');
    store.getState().newGame(gameSeed);
    const state = store.getState();
    const teamId = Object.keys(state.world.teamBases)[0];
    const player = state.world.squads[teamId][0];
    return {
      teamId,
      playerId: player.uuid,
      teamName: state.world.teamBases[teamId].name,
      playerName: player.name ?? `${player.number}号`,
    };
  }, seed);
}

async function bodyOverflow(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const results: unknown[] = [];

  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch,
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('console', message => captureConsoleError(message, errors));
      page.on('pageerror', error => errors.push(error.message));

      const fixture = await initializeGame(page);

      await page.goto(`${baseUrl}/players?audit=1`, { waitUntil: 'networkidle' });
      const playerTabs = page.locator('[aria-label="球员榜单"] [role="tab"]');
      const lastPlayerTab = playerTabs.last();
      await lastPlayerTab.click();
      const playerTabsMetrics = await page.locator('[aria-label="球员榜单"]').evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        selectedVisible: (() => {
          const selected = element.querySelector<HTMLElement>('[aria-selected="true"]');
          if (!selected) return false;
          const parent = element.getBoundingClientRect();
          const child = selected.getBoundingClientRect();
          return child.left >= parent.left - 1 && child.right <= parent.right + 1;
        })(),
      }));
      if (await lastPlayerTab.getAttribute('aria-selected') !== 'true' || !playerTabsMetrics.selectedVisible) {
        throw new Error(`${viewport.name}: active Player tab is not visible`);
      }

      await page.goto(`${baseUrl}/player/${fixture.playerId}?audit=1`, { waitUntil: 'networkidle' });
      const emptyStateCount = await page.getByText('本赛季尚无出场数据', { exact: true }).count();
      const zeroMetricGridCount = await page.getByTestId('position-headline-metrics').count();
      const prematureRankCount = await page.getByText(/本季同位置表现第/).count();
      if (emptyStateCount !== 1 || zeroMetricGridCount !== 0 || prematureRankCount !== 0) {
        throw new Error(`${viewport.name}: invalid season-start Player Detail state`);
      }

      await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: '开始模拟', exact: true }).click();
      await page.waitForFunction(() => {
        type AuditState = { isAdvancing: boolean; lastResults: unknown[] };
        const store = (window as typeof window & { __gameStore?: { getState: () => AuditState } }).__gameStore;
        const state = store?.getState();
        return Boolean(state && !state.isAdvancing && state.lastResults.length > 0);
      });
      const activePlayer = await page.evaluate(() => {
        type AuditState = {
          world: {
            playerStats: Record<string, { appearances: number }>;
            squads: Record<string, Array<{ uuid: string; name?: string; number: number }>>;
          };
        };
        const store = (window as typeof window & { __gameStore?: { getState: () => AuditState } }).__gameStore;
        if (!store) throw new Error('Audit store unavailable after advance');
        const world = store.getState().world;
        const playerId = Object.entries(world.playerStats).find(([, stats]) => stats.appearances > 0)?.[0];
        if (!playerId) throw new Error('No player appearance found after advance');
        const player = Object.values(world.squads).flat().find(candidate => candidate.uuid === playerId);
        return { playerId, playerName: player?.name ?? `${player?.number ?? ''}号` };
      });
      await page.goto(`${baseUrl}/player/${activePlayer.playerId}?audit=1`, { waitUntil: 'networkidle' });
      const headlineGrid = page.getByTestId('position-headline-metrics');
      await headlineGrid.waitFor({ state: 'visible' });
      const headlineCount = await headlineGrid.locator(':scope > div').count();
      const positionHeading = page.getByRole('heading', { name: /位置表现/ });
      const efficiencyHeading = page.getByRole('heading', { name: '效率与球队贡献', exact: true });
      const positionBox = await positionHeading.boundingBox();
      const efficiencyBox = await efficiencyHeading.boundingBox();
      if (headlineCount !== 4 || !positionBox || !efficiencyBox || positionBox.y >= efficiencyBox.y) {
        throw new Error(`${viewport.name}: active Player Detail hierarchy is invalid`);
      }
      if (await page.getByText(/本季同位置表现第/).count() !== 0) {
        throw new Error(`${viewport.name}: ranking appeared before three appearances`);
      }
      const playerDetailScreenshot = `/tmp/football-player-detail-${viewport.name}.png`;
      await page.screenshot({ path: playerDetailScreenshot, animations: 'disabled', fullPage: false });

      await page.goto(`${baseUrl}/teams?audit=1`, { waitUntil: 'networkidle' });
      const teamRow = page.getByTestId('team-directory-row').filter({ hasText: fixture.teamName }).first();
      const teamRowBox = await teamRow.boundingBox();
      const teamNameMetrics = await teamRow.locator('span').filter({ hasText: fixture.teamName }).first().evaluate((element) => ({
        text: element.textContent?.trim(),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        whiteSpace: getComputedStyle(element).whiteSpace,
      }));
      if (!teamRowBox || teamRowBox.height < 44 || teamNameMetrics.text !== fixture.teamName || teamNameMetrics.whiteSpace === 'nowrap') {
        throw new Error(`${viewport.name}: team directory row is not readable or touchable`);
      }
      await Promise.all([
        page.waitForURL(url => url.pathname === `/team/${fixture.teamId}`),
        teamRow.click(),
      ]);

      const detailTabs = page.locator('[aria-label="球队详情分区"] [role="tab"]');
      await detailTabs.first().waitFor({ state: 'visible' });
      if (await detailTabs.count() !== 3) throw new Error(`${viewport.name}: Team Detail does not expose three sections`);
      await page.getByRole('tab', { name: '阵容', exact: true }).click();
      const squadRow = page.getByTestId('squad-player-row').filter({ hasText: fixture.playerName }).first();
      const squadRowBox = await squadRow.boundingBox();
      const squadName = squadRow.locator('span').filter({ hasText: fixture.playerName }).first();
      const squadNameText = (await squadName.textContent())?.trim();
      if (!squadRowBox || squadRowBox.height < 44 || squadNameText !== fixture.playerName) {
        throw new Error(`${viewport.name}: squad player row is not readable or touchable`);
      }
      await Promise.all([
        page.waitForURL(url => url.pathname === `/player/${fixture.playerId}`),
        squadRow.click(),
      ]);
      await page.getByRole('heading', { name: fixture.playerName, exact: true }).waitFor({ state: 'visible' });

      await page.goto(`${baseUrl}/team/${fixture.teamId}?audit=1`, { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: '历史', exact: true }).click();
      if (await page.getByRole('tab', { name: '历史', exact: true }).getAttribute('aria-selected') !== 'true') {
        throw new Error(`${viewport.name}: Team Detail history tab did not activate`);
      }

      const overflow = await bodyOverflow(page);
      if (overflow > 1) throw new Error(`${viewport.name}: page overflow ${overflow}px`);
      if (errors.length > 0) throw new Error(`${viewport.name}: runtime errors: ${errors.join(' | ')}`);

      const screenshot = `/tmp/football-player-team-${viewport.name}.png`;
      await page.goto(`${baseUrl}/team/${fixture.teamId}?audit=1`, { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: '阵容', exact: true }).click();
      await page.screenshot({ path: screenshot, animations: 'disabled', fullPage: false });

      results.push({
        viewport: `${viewport.width}x${viewport.height}`,
        teamRowHeight: teamRowBox.height,
        squadRowHeight: squadRowBox.height,
        playerTabsScrollable: playerTabsMetrics.scrollWidth > playerTabsMetrics.clientWidth,
        activePlayerTabVisible: playerTabsMetrics.selectedVisible,
        emptyStateCount,
        headlineCount,
        bodyOverflow: overflow,
        playerDetailScreenshot,
        screenshot,
      });
      await context.close();
    }

    console.log(JSON.stringify({ passed: true, results }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

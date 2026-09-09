import { chromium, type ConsoleMessage, type Page } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const viewports = [
  { name: 'desktop', width: 1280, height: 720, isMobile: false, hasTouch: false },
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
] as const;

type Standing = { teamId: string; played: number };
type AuditState = {
  world: {
    seed: number;
    seasonState: {
      seasonNumber: number;
      currentWindowIndex: number;
      calendar: Array<{ completed: boolean; label: string }>;
    };
    teamStates: Record<string, { leagueLevel: 1 | 2 | 3 }>;
    league1Standings: Standing[];
    league2Standings: Standing[];
    league3Standings: Standing[];
  };
  initialized: boolean;
  favoriteTeamId: string | null;
  observationThemePreference: string;
  advanceTick: number;
  isAdvancing: boolean;
  lastWorldResponse: { id: string; mode: string } | null;
};

type AuditWindow = Window & {
  __gameStore?: { getState: () => AuditState };
};

function captureConsoleIssue(message: ConsoleMessage, issues: string[]): void {
  if (message.type() === 'error' || message.type() === 'warning') {
    issues.push(`${message.type()}: ${message.text()}`);
  }
}

async function storeState(page: Page): Promise<AuditState> {
  return page.evaluate(() => (window as AuditWindow).__gameStore!.getState());
}

async function waitForAdvance(page: Page, previousTick: number, timeout = 90_000): Promise<void> {
  await page.waitForFunction((tick) => {
    const state = (window as AuditWindow).__gameStore?.getState();
    return Boolean(state && !state.isAdvancing && state.advanceTick > tick);
  }, previousTick, { timeout });
}

async function clickAdvanceAndWait(page: Page): Promise<void> {
  const before = await storeState(page);
  await page.getByTestId('dashboard-advance').click();
  await waitForAdvance(page, before.advanceTick);
}

async function assertWindowLabelsAgree(page: Page, expected: number): Promise<void> {
  const masthead = (await page.getByTestId('dashboard-window-progress').textContent())?.replace(/\s+/g, '') ?? '';
  const navigation = (await page.getByTestId('season-nav-window-progress').first().textContent())?.replace(/\s+/g, '') ?? '';
  if (!masthead.includes(`${expected}/48`) || !navigation.includes(`待赛${expected}/48`)) {
    throw new Error(`window labels disagree: ${JSON.stringify({ masthead, navigation })}`);
  }
}

async function assertNoHorizontalOverflow(page: Page, checkpoint: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (overflow > 1) throw new Error(`${checkpoint}: horizontal overflow ${overflow}px`);
}

async function runRoute(page: Page, viewportName: string): Promise<Record<string, unknown>> {
  await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '开始观察' }).waitFor();
  await page.getByRole('button', { name: '开始观察' }).click();
  await page.getByTestId('dashboard').waitFor();

  const opening = await storeState(page);
  if (
    opening.world.seed !== 20260709
    || opening.favoriteTeamId !== 'datong'
    || opening.observationThemePreference !== 'auto'
  ) {
    throw new Error(`${viewportName}: wrong recommended opening ${JSON.stringify({
      seed: opening.world.seed,
      favorite: opening.favoriteTeamId,
      preference: opening.observationThemePreference,
    })}`);
  }
  await page.getByTestId('favorite-team-standing').filter({ hasText: '排名未形成' }).waitFor();
  await assertWindowLabelsAgree(page, 1);

  await page.getByRole('button', { name: /查看 .+ 的赛前信息/ }).first().click();
  await page.getByTestId('expected-goals-label').filter({ hasText: '预期进球' }).waitFor();
  if (await page.getByText('预测比分', { exact: true }).count()) {
    throw new Error(`${viewportName}: pre-match xG is still labelled as a score prediction`);
  }
  await page.getByRole('button', { name: '关闭比赛详情' }).click();

  await page.getByRole('button', { name: /做出本轮观察判断/ }).click();
  const judgment = page.getByTestId('observation-panel');
  await judgment.getByRole('tab', { name: '总进球' }).click();
  await judgment.getByRole('button', { name: '3+ 球' }).click();
  await clickAdvanceAndWait(page);
  await page.getByTestId('observation-settlement').waitFor();

  const fullReportToggle = page.getByTestId('toggle-full-report');
  if (await fullReportToggle.count()) await fullReportToggle.click();
  const reportContent = page.getByTestId('dashboard-tab-content');
  const scrolled = await reportContent.evaluate((element) => {
    const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTop = Math.min(240, maximum);
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
    return element.scrollTop;
  });
  if (scrolled <= 0) throw new Error(`${viewportName}: result report did not provide a scrollable test surface`);

  await page.getByRole('tab', { name: '比赛日', exact: true }).click();
  await page.getByRole('tab', { name: /战报/ }).click();
  await page.waitForTimeout(50);
  const restored = await reportContent.evaluate(element => element.scrollTop);
  if (restored !== scrolled) {
    throw new Error(`${viewportName}: same-report scroll was not restored (${scrolled} -> ${restored})`);
  }

  await page.getByRole('tab', { name: '比赛日', exact: true }).click();
  await clickAdvanceAndWait(page);
  await page.getByRole('tab', { name: /战报/ }).waitFor();
  const reset = await reportContent.evaluate(element => element.scrollTop);
  if (reset !== 0) throw new Error(`${viewportName}: new report retained old scroll ${reset}`);

  await page.getByRole('button', { name: '打开快进菜单' }).click();
  const keyButton = page.getByTestId('advance-next-key-node');
  await keyButton.getByText('前往下一关键节点', { exact: true }).waitFor();
  const beforeKey = await storeState(page);
  await keyButton.click();
  await waitForAdvance(page, beforeKey.advanceTick);
  const afterKey = await storeState(page);
  await page.getByTestId('view-key-node').click();
  await page.getByTestId('key-node-brief').waitFor();

  await clickAdvanceAndWait(page);
  await page.getByRole('tab', { name: '比赛日', exact: true }).click();
  await page.getByRole('button', { name: '打开快进菜单' }).click();
  let fiveRound = page.getByRole('button', { name: '推进 5 轮', exact: true });
  let additionalGuardedLeagueNode = false;
  if (await fiveRound.isDisabled()) {
    additionalGuardedLeagueNode = true;
    await page.getByRole('button', { name: '打开快进菜单' }).click();
    await clickAdvanceAndWait(page);
    await page.getByRole('tab', { name: '比赛日', exact: true }).click();
    await page.getByRole('button', { name: '打开快进菜单' }).click();
    fiveRound = page.getByRole('button', { name: '推进 5 轮', exact: true });
  }
  const beforeFive = await storeState(page);
  await fiveRound.click();
  await waitForAdvance(page, beforeFive.advanceTick);
  const afterFive = await storeState(page);
  if (afterFive.world.seasonState.currentWindowIndex - beforeFive.world.seasonState.currentWindowIndex !== 5) {
    throw new Error(`${viewportName}: five-round advance did not settle exactly five windows`);
  }

  await page.getByRole('button', { name: '打开快进菜单' }).click();
  await page.getByTestId('stay-on-current-view-toggle').check();
  await page.getByTestId('skip-current-season').click();
  const beforeSkip = await storeState(page);
  await page.getByTestId('confirm-skip-current-season').click();
  await page.waitForFunction(() => {
    const state = (window as AuditWindow).__gameStore?.getState();
    return Boolean(state && !state.isAdvancing && state.world.seasonState.seasonNumber === 2);
  }, undefined, { timeout: 90_000 });
  const seasonTwo = await storeState(page);
  const datongLevel = seasonTwo.world.teamStates.datong.leagueLevel;
  const standings = datongLevel === 1
    ? seasonTwo.world.league1Standings
    : datongLevel === 2
      ? seasonTwo.world.league2Standings
      : seasonTwo.world.league3Standings;
  const datong = standings.find(entry => entry.teamId === 'datong');
  if (seasonTwo.world.seasonState.currentWindowIndex !== 0 || datong?.played !== 0) {
    throw new Error(`${viewportName}: S2 did not stop at the unplayed opener`);
  }
  await page.getByRole('tab', { name: '比赛日', exact: true }).click();
  await page.getByTestId('observation-theme').locator('span').filter({ hasText: '升级 / 保级' }).waitFor();
  await page.getByTestId('favorite-team-standing').filter({ hasText: '排名未形成' }).waitFor();
  await assertWindowLabelsAgree(page, 1);

  await page.getByRole('tab', { name: 'S1档案', exact: true }).click();
  const archive = page.getByTestId('dashboard-tab-content');
  const archiveText = (await archive.textContent())?.replace(/\s+/g, '') ?? '';
  if (archiveText.includes('常山龙和红太阳和北海道')) {
    throw new Error(`${viewportName}: multi-team season copy still chains repeated conjunctions`);
  }
  if (!archiveText.includes('常山龙、红太阳')) {
    throw new Error(`${viewportName}: natural Chinese list punctuation was not rendered`);
  }
  const storylineText = (await page.getByTestId('season-storylines').textContent())?.replace(/\s+/g, '') ?? '';
  if (storylineText.includes('推进至Final后止步') && storylineText.includes('最深阶段SF')) {
    throw new Error(`${viewportName}: cup conclusion and evidence still disagree`);
  }
  if (!storylineText.includes('推进至Final后止步') || !storylineText.includes('最深阶段Final')) {
    throw new Error(`${viewportName}: expected canonical Final cup campaign was not archived`);
  }
  await assertNoHorizontalOverflow(page, `${viewportName} archive`);
  await page.screenshot({
    path: `/tmp/football-experience-closure-${viewportName}-archive.png`,
    animations: 'disabled',
    fullPage: true,
  });

  await page.getByTestId('season-handoff-transfer').click();
  const manualClose = page.getByRole('button', { name: '按当前决定完成', exact: true });
  if (!(await manualClose.isDisabled())) {
    throw new Error(`${viewportName}: manual close was not distinguished while decisions remained`);
  }
  await page.getByRole('button', { name: '全自动剩余', exact: true }).click();
  const handoff = page.getByTestId('transfer-window-handoff-summary');
  await handoff.waitFor();
  await handoff.getByText('自动策略拒绝', { exact: false }).waitFor();
  await handoff.getByText('签约：', { exact: false }).waitFor();
  const finalState = await storeState(page);
  if (finalState.world.seasonState.seasonNumber !== 2 || finalState.world.seasonState.currentWindowIndex !== 0) {
    throw new Error(`${viewportName}: transfer handoff unexpectedly advanced the S2 opener`);
  }
  await assertNoHorizontalOverflow(page, `${viewportName} transfer handoff`);
  await page.screenshot({
    path: `/tmp/football-experience-closure-${viewportName}-handoff.png`,
    animations: 'disabled',
    fullPage: true,
  });

  return {
    seed: opening.world.seed,
    favorite: opening.favoriteTeamId,
    preference: opening.observationThemePreference,
    reportScroll: { scrolled, restored, reset },
    ordinaryRevealWindow: 2,
    keyNodeFrom: beforeKey.world.seasonState.currentWindowIndex,
    keyNodeTo: afterKey.world.seasonState.currentWindowIndex,
    additionalGuardedLeagueNode,
    fiveRoundAdvance: afterFive.world.seasonState.currentWindowIndex - beforeFive.world.seasonState.currentWindowIndex,
    skippedWindows: beforeSkip.world.seasonState.calendar.length - beforeSkip.world.seasonState.currentWindowIndex,
    seasonTwo: { leagueLevel: datongLevel, played: datong?.played ?? -1 },
  };
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const reports: unknown[] = [];

  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch,
      });
      const page = await context.newPage();
      const issues: string[] = [];
      page.on('console', message => captureConsoleIssue(message, issues));
      page.on('pageerror', error => issues.push(`pageerror: ${error.message}`));
      const route = await runRoute(page, viewport.name);
      if (issues.length > 0) throw new Error(`${viewport.name}: runtime issues ${issues.join(' | ')}`);
      reports.push({ viewport: `${viewport.width}x${viewport.height}`, ...route, runtimeIssues: 0 });
      await context.close();
    }
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({ passed: true, reports }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

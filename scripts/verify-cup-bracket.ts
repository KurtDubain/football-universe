import { chromium, type ConsoleMessage, type Page } from 'playwright';
import { executeCurrentWindow, initializeGameWorld, type GameWorld } from '../src/engine/season/season-manager';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const seed = Number(process.env.VERIFY_SEED ?? 20260810);
const preferenceKey = 'football-universe:cup-bracket-view-v1';

type AuditWindow = Window & {
  __gameStore?: {
    setState: (patch: {
      world: GameWorld;
      initialized: boolean;
      favoriteTeamId: string;
      favoriteTeamIds: string[];
    }) => void;
  };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function buildCupWorlds(): {
  activeWorld: GameWorld;
  completedWorld: GameWorld;
  advancesToActive: number;
  totalAdvances: number;
} {
  let world = initializeGameWorld(seed);
  let advances = 0;
  while (world.leagueCup.rounds.length < 2 && advances < 120) {
    world = executeCurrentWindow(world).world;
    advances++;
  }
  assert(world.leagueCup.rounds.length >= 2, 'League cup did not reach its second round');
  assert(world.leagueCup.rounds[0].completed, 'League cup first round is not complete');
  const activeWorld = structuredClone(world);
  assert(!activeWorld.leagueCup.completed, 'Active cup snapshot was already completed');
  const advancesToActive = advances;
  while (!world.leagueCup.completed && advances < 120) {
    world = executeCurrentWindow(world).world;
    advances++;
  }
  assert(world.leagueCup.completed && world.leagueCup.winnerId, 'League cup did not produce a champion');
  return { activeWorld, completedWorld: world, advancesToActive, totalAdvances: advances };
}

function collectConsoleError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
}

async function installWorld(page: Page, world: GameWorld): Promise<void> {
  const favoriteTeamId = Object.keys(world.teamBases)[0];
  await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean((window as AuditWindow).__gameStore));
  await page.evaluate(({ nextWorld, teamId, key }) => {
    localStorage.removeItem(key);
    const store = (window as AuditWindow).__gameStore;
    if (!store) throw new Error('Audit store unavailable');
    store.setState({
      world: nextWorld,
      initialized: true,
      favoriteTeamId: teamId,
      favoriteTeamIds: [teamId],
    });
  }, { nextWorld: world, teamId: favoriteTeamId, key: preferenceKey });
}

async function verifyViewport(page: Page, world: GameWorld, name: string): Promise<Record<string, unknown>> {
  await installWorld(page, world);
  await page.goto(`${baseUrl}/cup/league_cup?audit=1`, { waitUntil: 'networkidle' });

  const bracket = page.getByTestId('classic-bracket');
  await bracket.waitFor({ state: 'visible' });
  const bracketTab = page.getByRole('tab', { name: '晋级图', exact: true });
  const listTab = page.getByRole('tab', { name: '对阵列表', exact: true });
  assert(await bracketTab.getAttribute('aria-selected') === 'true', `${name}: classic bracket is not the default`);

  const currentRound = bracket.locator('[aria-label="晋级图轮次"] [data-active="true"]');
  assert(await currentRound.count() === 1, `${name}: current round marker is missing or duplicated`);
  await page.waitForTimeout(80);
  assert(await currentRound.getAttribute('aria-selected') === 'true', `${name}: current round was not auto-focused`);

  const layout = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('.cup-bracket-scroll');
    const stage = document.querySelector<HTMLElement>('.cup-bracket-stage');
    const cards = [...document.querySelectorAll<HTMLElement>('.cup-bracket-tie')];
    const viewTabs = [...document.querySelectorAll<HTMLElement>('[aria-label="淘汰赛视图"] button')];
    const roundTabs = [...document.querySelectorAll<HTMLElement>('[aria-label="晋级图轮次"] button')];
    if (!scroller || !stage) throw new Error('Bracket layout is missing');
    return {
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      scrollerClientWidth: scroller.clientWidth,
      scrollerScrollWidth: scroller.scrollWidth,
      scrollerClientHeight: scroller.clientHeight,
      scrollerScrollHeight: scroller.scrollHeight,
      stageWidth: stage.getBoundingClientRect().width,
      cardCount: cards.length,
      cardSizes: [...new Set(cards.map(card => `${Math.round(card.getBoundingClientRect().width)}x${Math.round(card.getBoundingClientRect().height)}`))],
      minViewTabHeight: Math.min(...viewTabs.map(tab => tab.getBoundingClientRect().height)),
      minRoundTabHeight: Math.min(...roundTabs.map(tab => tab.getBoundingClientRect().height)),
    };
  });
  assert(layout.pageOverflow <= 1, `${name}: page overflows by ${layout.pageOverflow}px`);
  assert(layout.scrollerScrollWidth > layout.scrollerClientWidth, `${name}: bracket has no internal horizontal route`);
  if (name !== 'desktop') {
    assert(layout.scrollerScrollHeight > layout.scrollerClientHeight, `${name}: bracket has no internal vertical route`);
  }
  assert(layout.cardCount >= 31, `${name}: future bracket route is incomplete (${layout.cardCount} cards)`);
  assert(layout.cardSizes.length === 1 && layout.cardSizes[0] === '172x82', `${name}: bracket cards are unstable (${layout.cardSizes.join(', ')})`);
  const minimumTarget = name === 'desktop' ? 36 : 44;
  assert(layout.minViewTabHeight >= minimumTarget, `${name}: view switch is too small (${layout.minViewTabHeight}px)`);
  assert(layout.minRoundTabHeight >= minimumTarget, `${name}: round navigation is too small (${layout.minRoundTabHeight}px)`);

  const beforeScroll = await bracket.locator('.cup-bracket-scroll').evaluate(element => element.scrollLeft);
  await bracket.getByRole('tab', { name: '冠军', exact: true }).click();
  await page.waitForTimeout(450);
  const afterScroll = await bracket.locator('.cup-bracket-scroll').evaluate(element => element.scrollLeft);
  assert(afterScroll > beforeScroll, `${name}: champion navigation did not move the bracket`);
  await currentRound.click();
  await page.waitForTimeout(450);

  const playableTie = bracket.locator('.cup-bracket-tie:not([disabled])').first();
  await playableTie.click();
  await page.getByRole('dialog').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });

  await listTab.click();
  await page.locator('#cup-list-panel').waitFor({ state: 'visible' });
  assert(await page.evaluate(key => localStorage.getItem(key), preferenceKey) === 'list', `${name}: list preference was not persisted`);
  await page.reload({ waitUntil: 'networkidle' });
  assert(await page.getByRole('tab', { name: '对阵列表', exact: true }).getAttribute('aria-selected') === 'true', `${name}: list preference was not restored`);
  await page.getByRole('tab', { name: '晋级图', exact: true }).click();
  await page.getByTestId('classic-bracket').waitFor({ state: 'visible' });

  const screenshot = `/tmp/football-cup-bracket-${name}.png`;
  await page.screenshot({ path: screenshot, animations: 'disabled', fullPage: false });
  return { ...layout, beforeScroll, afterScroll, screenshot };
}

async function verifyCompletedCup(page: Page, world: GameWorld): Promise<Record<string, unknown>> {
  await installWorld(page, world);
  await page.goto(`${baseUrl}/cup/league_cup?audit=1`, { waitUntil: 'networkidle' });
  const bracket = page.getByTestId('classic-bracket');
  await bracket.waitFor({ state: 'visible' });
  const championTab = bracket.getByRole('tab', { name: '冠军', exact: true });
  await page.waitForTimeout(80);
  assert(await championTab.getAttribute('data-active') === 'true', 'Completed cup did not mark the champion destination');
  assert(await championTab.getAttribute('aria-selected') === 'true', 'Completed cup did not auto-focus the champion');
  const champion = bracket.locator('.cup-bracket-champion[data-decided="true"]');
  assert(await champion.count() === 1, 'Completed cup has no decided champion cell');
  const winnerId = world.leagueCup.winnerId!;
  const winnerName = world.teamBases[winnerId]?.shortName ?? winnerId;
  assert((await champion.innerText()).includes(winnerName), 'Champion cell does not show the cup winner');
  const championVisible = await champion.evaluate(element => {
    const card = element.getBoundingClientRect();
    const scroller = element.closest('.cup-bracket-scroll')?.getBoundingClientRect();
    return Boolean(scroller && card.top >= scroller.top && card.bottom <= scroller.bottom);
  });
  assert(championVisible, 'Completed cup did not bring the champion into the mobile viewport');
  assert(await bracket.locator('.cup-bracket-champion-connector[data-advanced="true"]').count() === 1, 'Champion path is not highlighted');
  const screenshot = '/tmp/football-cup-bracket-champion-mobile-390.png';
  await page.screenshot({ path: screenshot, animations: 'disabled', fullPage: false });
  return { winnerId, winnerName, screenshot };
}

async function main(): Promise<void> {
  const { activeWorld, completedWorld, advancesToActive, totalAdvances } = buildCupWorlds();
  const browser = await chromium.launch({ headless: true });
  const errors: string[] = [];
  const reports: Record<string, unknown>[] = [];
  try {
    for (const viewport of [
      { name: 'mobile-320', width: 320, height: 568, isMobile: true, hasTouch: true },
      { name: 'mobile-390', width: 390, height: 844, isMobile: true, hasTouch: true },
      { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
    ]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch,
      });
      const page = await context.newPage();
      page.on('console', message => collectConsoleError(message, errors));
      page.on('pageerror', error => errors.push(error.message));
      reports.push({ viewport: `${viewport.width}x${viewport.height}`, ...(await verifyViewport(page, activeWorld, viewport.name)) });
      await context.close();
    }
    const championContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const championPage = await championContext.newPage();
    championPage.on('console', message => collectConsoleError(message, errors));
    championPage.on('pageerror', error => errors.push(error.message));
    reports.push({ completedCup: await verifyCompletedCup(championPage, completedWorld) });
    await championContext.close();
    assert(errors.length === 0, `Browser runtime errors: ${errors.join(' | ')}`);
    console.log(JSON.stringify({ passed: true, seed, advancesToActive, totalAdvances, reports }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

import { chromium, type ConsoleMessage } from 'playwright';
import type { ObservationThemePreference } from '../src/engine/observation/observation-theme';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const viewports = [
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
] as const;

type RouteSnapshot = {
  season: number;
  windowIndex: number;
  primary: string | null;
  primaryPlayed: number;
  primaryPoints: number;
  activeStories: number;
  rngState: number;
};

type AuditState = {
  favoriteTeamId: string | null;
  observationThemePreference: ObservationThemePreference;
  world: {
    seasonState: { seasonNumber: number; currentWindowIndex: number };
    teamStates: Record<string, { leagueLevel: 1 | 2 | 3 }>;
    league1Standings: Array<{ teamId: string; played: number; points: number }>;
    league2Standings: Array<{ teamId: string; played: number; points: number }>;
    league3Standings: Array<{ teamId: string; played: number; points: number }>;
    activeStorylines?: Array<{ id: string; phase: string }>;
    rngState: number;
  };
  advanceWindow: () => Promise<boolean>;
};

type AuditWindow = Window & {
  __gameStore?: { getState: () => AuditState };
};

function captureError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
}

function readRouteSnapshot(): RouteSnapshot {
  const state = (window as AuditWindow).__gameStore?.getState();
  if (!state) throw new Error('Audit store unavailable');
  const primary = state.favoriteTeamId;
  const level = primary ? state.world.teamStates[primary]?.leagueLevel : null;
  const standings = level === 1
    ? state.world.league1Standings
    : level === 2
      ? state.world.league2Standings
      : state.world.league3Standings;
  const row = standings.find(entry => entry.teamId === primary);
  return {
    season: state.world.seasonState.seasonNumber,
    windowIndex: state.world.seasonState.currentWindowIndex,
    primary,
    primaryPlayed: row?.played ?? 0,
    primaryPoints: row?.points ?? 0,
    activeStories: state.world.activeStorylines?.length ?? 0,
    rngState: state.world.rngState,
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
      const errors: string[] = [];
      page.on('console', message => captureError(message, errors));
      page.on('pageerror', error => errors.push(error.message));

      await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: '开始观察' }).click();
      await page.getByTestId('dashboard').waitFor();
      const theme = page.getByTestId('observation-theme');
      await theme.waitFor();
      const initialText = ((await theme.textContent()) ?? '').replace(/\s+/g, ' ').trim();
      if (!initialText.includes('黑马挑战') || !initialText.includes('下一观察：')) {
        throw new Error(`${viewport.name}: recommended observation theme is incomplete`);
      }
      const initial = await page.evaluate(readRouteSnapshot);

      const focusFixture = page.getByTestId('focus-matches').getByRole('button').first();
      await focusFixture.click();
      await page.getByRole('dialog').waitFor();
      await page.getByRole('button', { name: '关闭比赛详情' }).click();

      await page.getByRole('button', { name: /做出本轮观察判断/ }).click();
      await page.getByRole('button', { name: /主胜/ }).click();
      await page.getByTestId('dashboard-advance').click();
      await page.getByTestId('world-response').waitFor({ timeout: 15_000 });
      await page.getByTestId('observation-settlement').waitFor({ timeout: 15_000 });
      await page.screenshot({
        path: `/tmp/football-observation-route-${viewport.name}-response.png`,
        animations: 'disabled',
      });

      await page.getByRole('button', { name: '比赛日' }).click();
      await page.getByTestId('dashboard-advance').click();
      await page.getByTestId('world-response').waitFor({ timeout: 15_000 });
      const afterTwo = await page.evaluate(readRouteSnapshot);
      if (afterTwo.windowIndex < initial.windowIndex + 2 || afterTwo.primaryPlayed < 2) {
        throw new Error(`${viewport.name}: two ordinary windows did not settle`);
      }

      let storySnapshot = afterTwo;
      for (let step = 0; step < 10 && storySnapshot.activeStories === 0; step++) {
        const advanced = await page.evaluate(async () => {
          const state = (window as AuditWindow).__gameStore?.getState();
          return state?.advanceWindow() ?? false;
        });
        if (!advanced) throw new Error(`${viewport.name}: route advance stopped before a story update`);
        storySnapshot = await page.evaluate(readRouteSnapshot);
      }
      if (storySnapshot.activeStories === 0) {
        throw new Error(`${viewport.name}: no staged story update within the review route`);
      }

      await page.getByRole('button', { name: '比赛日' }).click();
      await theme.waitFor();
      const finalText = ((await theme.textContent()) ?? '').replace(/\s+/g, ' ').trim();
      if (finalText === initialText || storySnapshot.primaryPlayed <= initial.primaryPlayed) {
        throw new Error(`${viewport.name}: observation evidence did not visibly change`);
      }
      await page.getByTestId('storyline-signals').waitFor({ timeout: 10_000 });
      if (!((await page.getByTestId('storyline-signals').textContent()) ?? '').includes('下一观察：')) {
        throw new Error(`${viewport.name}: route ended without a continuing story hook`);
      }

      const beforeSwitch = await page.evaluate(readRouteSnapshot);
      const selector = page.getByRole('combobox', { name: '选择本赛季观察主题' });
      await selector.selectOption('player_growth');
      await theme.locator('span').filter({ hasText: /^球员成长$/ }).waitFor();
      await selector.selectOption('disabled');
      await page.getByText(/主题已关闭/).waitFor();
      await selector.selectOption('dark_horse_challenge');
      const afterSwitch = await page.evaluate(readRouteSnapshot);
      if (
        afterSwitch.rngState !== beforeSwitch.rngState
        || afterSwitch.windowIndex !== beforeSwitch.windowIndex
        || afterSwitch.primaryPoints !== beforeSwitch.primaryPoints
      ) {
        throw new Error(`${viewport.name}: changing a theme mutated simulation state`);
      }

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (overflow > 1) throw new Error(`${viewport.name}: horizontal overflow ${overflow}px`);
      const selectBox = await selector.boundingBox();
      if (!selectBox || selectBox.height < 36) {
        throw new Error(`${viewport.name}: theme selector target is undersized`);
      }
      await theme.scrollIntoViewIfNeeded();
      const screenshot = `/tmp/football-observation-route-${viewport.name}-theme.png`;
      await page.screenshot({ path: screenshot, animations: 'disabled' });
      if (errors.length > 0) throw new Error(`${viewport.name}: runtime errors ${errors.join(' | ')}`);

      reports.push({
        viewport: `${viewport.width}x${viewport.height}`,
        initial,
        afterTwo,
        storySnapshot,
        finalTheme: finalText,
        overflow,
        screenshot,
        runtimeErrors: errors.length,
      });
      await context.close();
    }
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({ passed: true, reports }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

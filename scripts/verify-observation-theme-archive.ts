import { chromium, type ConsoleMessage } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const viewports = [
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
] as const;

type AuditState = {
  world: {
    teamBases: Record<string, unknown>;
    observerSeasonTrajectories?: Array<{
      seasonNumber: number;
      teamId: string;
      theme?: { type: string; playerId?: string };
    }>;
  };
  newGame: (seed: number) => Promise<void>;
  setFavoriteTeams: (ids: string[]) => void;
  setPrimaryFavoriteTeam: (id: string) => void;
  setObservationThemePreference: (preference: 'player_growth') => void;
  advanceUntil: (type: 'season_end') => Promise<boolean>;
  advanceWindow: () => Promise<boolean>;
  closeTransferWindow: (autoResolveRest: boolean) => void;
};

type AuditWindow = Window & {
  __gameStore?: { getState: () => AuditState };
};

function captureError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
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
      await page.waitForFunction(() => Boolean((window as AuditWindow).__gameStore));
      const archived = await page.evaluate(async () => {
        const store = (window as AuditWindow).__gameStore;
        if (!store) throw new Error('Audit store unavailable');
        const state = store.getState();
        await state.newGame(20260718);
        const teamIds = Object.keys(store.getState().world.teamBases);
        store.getState().setFavoriteTeams(teamIds.slice(0, 2));
        store.getState().setObservationThemePreference('player_growth');
        if (!await store.getState().advanceUntil('season_end')) {
          throw new Error('Failed to reach season end');
        }
        if (!await store.getState().advanceWindow()) {
          throw new Error('Failed to archive season');
        }
        store.getState().closeTransferWindow(true);
        const trajectory = store.getState().world.observerSeasonTrajectories?.[0];
        if (!trajectory) throw new Error('Archived trajectory unavailable');
        store.getState().setPrimaryFavoriteTeam(teamIds[1]);
        return {
          seasonNumber: trajectory.seasonNumber,
          teamId: trajectory.teamId,
          theme: trajectory.theme,
          currentPrimary: teamIds[1],
        };
      });
      if (
        archived.theme?.type !== 'player_growth'
        || !archived.theme.playerId
        || archived.teamId === archived.currentPrimary
      ) {
        throw new Error(`${viewport.name}: theme archive is incomplete ${JSON.stringify(archived)}`);
      }

      await page.getByRole('button', { name: /S1回顾/ }).click();
      const themeResult = page.getByTestId('observer-theme-result');
      await themeResult.waitFor({ timeout: 15_000 });
      const resultText = ((await themeResult.textContent()) ?? '').replace(/\s+/g, ' ').trim();
      if (
        !resultText.includes('本季观察主题')
        || !resultText.includes('球员成长')
        || !/出场|历史保留范围/.test(resultText)
      ) {
        throw new Error(`${viewport.name}: season review theme result is incomplete`);
      }
      const resultOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (resultOverflow > 1) throw new Error(`${viewport.name}: review overflow ${resultOverflow}px`);
      await themeResult.scrollIntoViewIfNeeded();
      const reviewScreenshot = `/tmp/football-theme-archive-${viewport.name}-review.png`;
      await page.screenshot({ path: reviewScreenshot, animations: 'disabled' });

      await page.goto(`${baseUrl}/history?audit=1`, { waitUntil: 'networkidle' });
      const themeBadge = page.getByText('主题：球员成长', { exact: true });
      await themeBadge.waitFor();
      await page.reload({ waitUntil: 'networkidle' });
      await themeBadge.waitFor();
      const historyOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (historyOverflow > 1) throw new Error(`${viewport.name}: history overflow ${historyOverflow}px`);
      const historyScreenshot = `/tmp/football-theme-archive-${viewport.name}-history.png`;
      await themeBadge.scrollIntoViewIfNeeded();
      await page.screenshot({ path: historyScreenshot, animations: 'disabled' });
      if (errors.length > 0) throw new Error(`${viewport.name}: runtime errors ${errors.join(' | ')}`);

      reports.push({
        viewport: `${viewport.width}x${viewport.height}`,
        archived,
        resultText,
        resultOverflow,
        historyOverflow,
        reviewScreenshot,
        historyScreenshot,
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

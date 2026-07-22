import { chromium, type ConsoleMessage } from 'playwright';
import { RECOMMENDED_EXPERIENCE_SEED } from '../src/config/observer-experience';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const viewports = [
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
] as const;

type AuditState = {
  initialized: boolean;
  favoriteTeamId: string | null;
  favoriteTeamIds: string[];
  world: { seed: number; gameMode?: string } | null;
  setFavoriteTeams: (teamIds: string[]) => void;
  resetGame: () => void;
};

type AuditWindow = Window & {
  __gameStore?: { getState: () => AuditState };
};

function captureConsoleError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
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

      await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: '开始观察' }).waitFor();
      const startButton = page.getByRole('button', { name: '开始观察' });
      const startBox = await startButton.boundingBox();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (!startBox || startBox.height < 44) throw new Error(`${viewport.name}: start target is undersized`);
      if (viewport.isMobile && startBox.y + startBox.height > viewport.height) {
        throw new Error(`${viewport.name}: recommended start is below the first viewport`);
      }
      if (overflow > 1) throw new Error(`${viewport.name}: welcome overflow ${overflow}px`);
      await page.screenshot({
        path: `/tmp/football-observer-onboarding-${viewport.name}-welcome.png`,
        animations: 'disabled',
        fullPage: true,
      });

      await startButton.click();
      await page.getByTestId('dashboard').waitFor();
      const recommended = await page.evaluate(() => {
        const state = (window as AuditWindow).__gameStore?.getState();
        return {
          seed: state?.world?.seed,
          mode: state?.world?.gameMode,
          primary: state?.favoriteTeamId,
          favorites: state?.favoriteTeamIds ?? [],
        };
      });
      if (recommended.seed !== RECOMMENDED_EXPERIENCE_SEED || recommended.mode !== 'free') {
        throw new Error(`${viewport.name}: recommended universe mismatch ${JSON.stringify(recommended)}`);
      }
      if (!recommended.primary || recommended.favorites[0] !== recommended.primary) {
        throw new Error(`${viewport.name}: recommended primary focus mismatch`);
      }
      await page.getByText('主要观察', { exact: true }).first().waitFor();
      await page.getByText('主要观察球队出战', { exact: true }).first().waitFor();

      await page.evaluate(() => {
        const store = (window as AuditWindow).__gameStore;
        const state = store?.getState();
        if (!state?.favoriteTeamId) throw new Error('Primary favorite unavailable');
        state.setFavoriteTeams([state.favoriteTeamId, 'shimazu', 'xibei_wolf']);
      });
      await page.goto(`${baseUrl}/settings?audit=1`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: '设为主要' }).first().click();
      const reordered = await page.evaluate(() => {
        const state = (window as AuditWindow).__gameStore?.getState();
        return { primary: state?.favoriteTeamId, favorites: state?.favoriteTeamIds ?? [] };
      });
      if (!reordered.primary || reordered.favorites[0] !== reordered.primary) {
        throw new Error(`${viewport.name}: settings did not promote primary focus`);
      }

      await page.evaluate(() => (window as AuditWindow).__gameStore?.getState().resetGame());
      await page.getByRole('heading', { name: '开始观察' }).waitFor();
      await page.getByRole('button', { name: /纯观察/ }).click();
      await page.getByRole('button', { name: '开始观察' }).click();
      await page.getByTestId('dashboard').waitFor();
      const neutralFavorites = await page.evaluate(() => (
        window as AuditWindow
      ).__gameStore?.getState().favoriteTeamIds ?? []);
      if (neutralFavorites.length !== 0) throw new Error(`${viewport.name}: neutral mode retained favorites`);

      await page.evaluate(() => (window as AuditWindow).__gameStore?.getState().resetGame());
      await page.getByRole('tab', { name: '自选宇宙' }).click();
      await page.locator('#favorite-team').selectOption('gz_hengda');
      await page.getByRole('button', { name: '规则与种子' }).click();
      await page.locator('#universe-seed').fill('424242');
      await page.getByRole('button', { name: '开始观察' }).click();
      await page.getByTestId('dashboard').waitFor();
      const custom = await page.evaluate(() => {
        const state = (window as AuditWindow).__gameStore?.getState();
        return { seed: state?.world?.seed, primary: state?.favoriteTeamId };
      });
      if (custom.seed !== 424242 || custom.primary !== 'gz_hengda') {
        throw new Error(`${viewport.name}: custom universe mismatch ${JSON.stringify(custom)}`);
      }
      if (errors.length > 0) throw new Error(`${viewport.name}: runtime errors: ${errors.join(' | ')}`);

      results.push({
        viewport: `${viewport.width}x${viewport.height}`,
        recommendedSeed: recommended.seed,
        recommendedPrimary: recommended.primary,
        promotedPrimary: reordered.primary,
        neutralFavorites: neutralFavorites.length,
        custom,
      });
      await context.close();
    }
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({ passed: true, results }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

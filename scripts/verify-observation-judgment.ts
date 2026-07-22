import { chromium, type ConsoleMessage } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const viewports = [
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
] as const;

type AuditWindow = Window & {
  __gameStore?: {
    getState: () => {
      world: {
        pendingObservationJudgment?: { fixtureId: string; kind: string; selection: string } | null;
        observationRecord?: { total: number; correct: number; currentStreak: number; bestStreak: number };
      };
      newGame: (seed: number) => void;
    };
  };
};

function captureConsoleError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const verification: unknown[] = [];
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
      await page.waitForFunction(() => Boolean((window as AuditWindow).__gameStore));
      await page.evaluate(() => (window as AuditWindow).__gameStore?.getState().newGame(20260718));
      await page.getByTestId('dashboard').waitFor();

      const openJudgment = page.getByRole('button', { name: /做出本轮观察判断/ });
      await openJudgment.scrollIntoViewIfNeeded();
      await openJudgment.click();
      const panel = page.getByTestId('observation-panel');
      await panel.waitFor();
      await page.screenshot({
        path: `/tmp/football-observation-${viewport.name}-panel.png`,
        animations: 'disabled',
        fullPage: true,
      });
      await panel.getByRole('tab', { name: '总进球' }).click();
      await panel.getByRole('button', { name: '3+ 球' }).click();
      const pending = await page.evaluate(() => (
        window as AuditWindow
      ).__gameStore?.getState().world.pendingObservationJudgment);
      if (pending?.kind !== 'goals' || pending.selection !== 'over-2') {
        throw new Error(`${viewport.name}: judgment was not recorded ${JSON.stringify(pending)}`);
      }
      await page.screenshot({
        path: `/tmp/football-observation-${viewport.name}-pending.png`,
        animations: 'disabled',
        fullPage: true,
      });

      await page.getByRole('button', { name: '开始模拟', exact: true }).click();
      const summary = page.getByTestId('observation-settlement');
      await summary.waitFor({ timeout: 15_000 });
      await summary.getByText(/样本积累中/).waitFor();
      const hierarchy = await page.evaluate(() => {
        const settlement = document.querySelector('[data-testid="observation-settlement"]');
        const sequence = document.querySelector('[data-testid="result-sequence"]');
        return {
          settlementTop: settlement?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
          sequenceTop: sequence?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
          overflow: document.documentElement.scrollWidth - innerWidth,
        };
      });
      if (hierarchy.settlementTop >= hierarchy.sequenceTop) {
        throw new Error(`${viewport.name}: settlement feedback is below result sequence`);
      }
      if (hierarchy.overflow > 1) throw new Error(`${viewport.name}: horizontal overflow ${hierarchy.overflow}px`);
      const record = await page.evaluate(() => (
        window as AuditWindow
      ).__gameStore?.getState().world.observationRecord);
      if (record?.total !== 1) throw new Error(`${viewport.name}: record not settled ${JSON.stringify(record)}`);
      if (errors.length > 0) throw new Error(`${viewport.name}: runtime errors ${errors.join(' | ')}`);

      await page.screenshot({
        path: `/tmp/football-observation-${viewport.name}-settled.png`,
        animations: 'disabled',
        fullPage: true,
      });
      verification.push({ viewport: `${viewport.width}x${viewport.height}`, pending, record, hierarchy });
      await context.close();
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ passed: true, verification }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

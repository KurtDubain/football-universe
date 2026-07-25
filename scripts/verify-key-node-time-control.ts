import { chromium, type ConsoleMessage } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const viewports = [
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
] as const;

type AuditState = {
  world: {
    teamBases: Record<string, unknown>;
    seasonState: {
      currentWindowIndex: number;
      calendar: Array<{ type: string; label: string; completed: boolean }>;
    };
  };
  lastWorldResponse: {
    id: string;
    mode: string;
    advancedWindows: number;
    nextWindowLabel: string;
  } | null;
  newGame: (seed: number) => void;
  setFavoriteTeams: (ids: string[]) => void;
};

type AuditWindow = Window & {
  __gameStore?: {
    getState: () => AuditState;
  };
};

function captureConsoleError(message: ConsoleMessage, errors: string[]): void {
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
      page.on('console', message => captureConsoleError(message, errors));
      page.on('pageerror', error => errors.push(error.message));

      await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => Boolean((window as AuditWindow).__gameStore));
      await page.evaluate(() => {
        const store = (window as AuditWindow).__gameStore!;
        store.getState().newGame(20260726);
        store.getState().setFavoriteTeams([]);
      });
      await page.getByTestId('dashboard').waitFor();

      await page.getByRole('button', { name: '打开快进菜单' }).click();
      const menu = page.getByTestId('advance-menu');
      const keyButton = page.getByTestId('advance-next-key-node');
      await menu.waitFor();
      await keyButton.getByText('前往下一关键节点', { exact: true }).waitFor();
      await menu.getByText(/杯赛节点/).waitFor();
      await menu.getByText(/将结算 \d+ 个窗口，并在该节点前停下/).waitFor();

      const initialLayout = await page.evaluate(() => {
        const node = document.querySelector('[data-testid="advance-menu"]');
        const rect = node?.getBoundingClientRect();
        return {
          left: rect?.left ?? -1,
          right: rect?.right ?? -1,
          width: rect?.width ?? 0,
          overflow: document.documentElement.scrollWidth - innerWidth,
        };
      });
      if (initialLayout.left < 0 || initialLayout.right > viewport.width + 1) {
        throw new Error(`${viewport.name}: key-node menu escaped viewport ${JSON.stringify(initialLayout)}`);
      }
      if (initialLayout.overflow > 1) {
        throw new Error(`${viewport.name}: horizontal overflow ${initialLayout.overflow}px`);
      }
      await page.screenshot({
        path: `/tmp/football-key-node-${viewport.name}-preview.png`,
        animations: 'disabled',
      });

      await keyButton.click();
      await page.waitForFunction(() => (
        (window as AuditWindow).__gameStore?.getState().lastWorldResponse?.mode === 'key_node'
      ));
      const reached = await page.evaluate(() => {
        const state = (window as AuditWindow).__gameStore!.getState();
        const index = state.world.seasonState.currentWindowIndex;
        return {
          index,
          current: state.world.seasonState.calendar[index],
          response: state.lastWorldResponse,
        };
      });
      if (!reached.response || reached.response.advancedWindows <= 0) {
        throw new Error(`${viewport.name}: key-node advance produced no response`);
      }
      if (reached.current.completed) {
        throw new Error(`${viewport.name}: target node was simulated instead of left for observation`);
      }
      if (reached.response.nextWindowLabel !== reached.current.label) {
        throw new Error(`${viewport.name}: response target label does not match current node`);
      }

      await page.getByRole('button', { name: '打开快进菜单' }).click();
      await keyButton.getByText('当前就是关键节点', { exact: true }).waitFor();
      if (!(await keyButton.isDisabled())) {
        throw new Error(`${viewport.name}: current key node jump should be disabled`);
      }
      for (const label of ['推进 5 轮', '推进 10 轮']) {
        if (!(await menu.getByRole('button', { name: label, exact: true }).isDisabled())) {
          throw new Error(`${viewport.name}: ${label} should be guarded at current key node`);
        }
      }
      await menu.getByText(/当前关键内容处理完成后/).waitFor();
      await page.screenshot({
        path: `/tmp/football-key-node-${viewport.name}-guarded.png`,
        animations: 'disabled',
      });

      if (errors.length > 0) {
        throw new Error(`${viewport.name}: runtime errors ${errors.join(' | ')}`);
      }
      reports.push({
        viewport: `${viewport.width}x${viewport.height}`,
        initialLayout,
        reached: {
          index: reached.index,
          type: reached.current.type,
          label: reached.current.label,
          completed: reached.current.completed,
          mode: reached.response.mode,
          advancedWindows: reached.response.advancedWindows,
        },
        runtimeErrors: errors.length,
      });
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

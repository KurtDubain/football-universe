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
  newGame: (seed: number) => Promise<void>;
  setFavoriteTeams: (ids: string[]) => void;
  advanceWindow: () => Promise<boolean>;
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
      await page.evaluate(async () => {
        const store = (window as AuditWindow).__gameStore!;
        await store.getState().newGame(20260726);
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

      await page.getByTestId('world-response').waitFor();
      const reachedAction = page.getByTestId('results-next-action');
      await reachedAction.waitFor();
      if (await reachedAction.getAttribute('data-reached-key-node') !== 'true') {
        throw new Error(`${viewport.name}: reached node was not distinguished from an ordinary next window`);
      }
      await reachedAction.getByText('已抵达关键节点', { exact: true }).waitFor();
      const viewNodeButton = page.getByTestId('view-key-node');
      await viewNodeButton.waitFor();
      if (await page.getByTestId('dashboard-advance').count() > 0) {
        throw new Error(`${viewport.name}: reached key node still exposed the direct advance action`);
      }
      await page.screenshot({
        path: `/tmp/football-key-node-${viewport.name}-arrival.png`,
        animations: 'disabled',
      });
      await viewNodeButton.click();
      const nodeBrief = page.getByTestId('key-node-brief');
      await nodeBrief.waitFor();
      await nodeBrief.getByText(/KEY NODE/).waitFor();
      const afterViewing = await page.evaluate(() => {
        const state = (window as AuditWindow).__gameStore!.getState();
        const index = state.world.seasonState.currentWindowIndex;
        return {
          index,
          completed: state.world.seasonState.calendar[index].completed,
        };
      });
      if (afterViewing.index !== reached.index || afterViewing.completed) {
        throw new Error(`${viewport.name}: viewing a key node unexpectedly simulated it`);
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
      await page.getByRole('button', { name: '打开快进菜单' }).click();
      await menu.waitFor({ state: 'hidden' });

      await page.evaluate(async () => {
        const store = (window as AuditWindow).__gameStore!;
        await store.getState().newGame(20260726);
        store.getState().setFavoriteTeams([]);
        for (let step = 0; step < 80; step++) {
          const state = store.getState();
          const index = state.world.seasonState.currentWindowIndex;
          const current = state.world.seasonState.calendar[index];
          if (current?.type === 'super_cup_group' && /(?:R\s*6|第\s*6\s*轮)/i.test(current.label)) return;
          if (!(await state.advanceWindow())) {
            throw new Error('advance stopped before the Super Cup group finale');
          }
        }
        throw new Error('Super Cup group finale was not found');
      });

      const matchdayTab = page.getByRole('tab', { name: '比赛日', exact: true });
      await matchdayTab.click();
      const groupFinaleBrief = page.getByTestId('key-node-brief');
      await groupFinaleBrief.waitFor();
      await groupFinaleBrief.getByText(/KEY NODE · 小组赛收官/).waitFor();
      await page.getByText('小组收官', { exact: true }).first().waitFor();
      const groupFinaleBefore = await page.evaluate(() => {
        const state = (window as AuditWindow).__gameStore!.getState();
        const index = state.world.seasonState.currentWindowIndex;
        return { index, current: state.world.seasonState.calendar[index] };
      });
      if (groupFinaleBefore.current.completed) {
        throw new Error(`${viewport.name}: group finale was completed before observation`);
      }
      const groupFinaleScreenshot = `/tmp/football-key-node-${viewport.name}-group-finale.png`;
      await page.screenshot({ path: groupFinaleScreenshot, animations: 'disabled' });

      await page.getByTestId('dashboard-advance').click();
      await page.getByTestId('streamers-celebration').waitFor({ timeout: 10_000 });
      await page.getByTestId('world-response').waitFor({ timeout: 15_000 });
      const groupFinaleAfter = await page.evaluate(() => {
        const state = (window as AuditWindow).__gameStore!.getState();
        return {
          index: state.world.seasonState.currentWindowIndex,
          response: state.lastWorldResponse,
        };
      });
      if (groupFinaleAfter.index !== groupFinaleBefore.index + 1 || !groupFinaleAfter.response) {
        throw new Error(`${viewport.name}: group finale did not complete into one bounded world response`);
      }

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
          viewedBeforeSimulation: afterViewing.index === reached.index && !afterViewing.completed,
        },
        groupFinale: {
          label: groupFinaleBefore.current.label,
          viewedBeforeSimulation: !groupFinaleBefore.current.completed,
          responseMode: groupFinaleAfter.response.mode,
          screenshot: groupFinaleScreenshot,
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

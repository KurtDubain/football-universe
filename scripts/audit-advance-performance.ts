import { chromium, type CDPSession, type Page } from 'playwright';

const url = process.env.PERF_URL ?? 'http://127.0.0.1:4173/?audit';
const samples = Number(process.env.PERF_SAMPLES ?? 5);
const settleMs = Number(process.env.PERF_SETTLE_MS ?? 750);
const seed = Number(process.env.PERF_SEED ?? 20260716);

interface AdvanceSample {
  actionMs: number;
  feedbackFrameMs: number;
  busyImmediate: boolean;
  busyAtFirstFrame: boolean;
  maxLongTaskMs: number;
  maxTimerGapMs: number;
  maxPostMessageMs: number;
  workerSerializationMs: number;
  workerCompressionMs: number;
  compressedChars: number;
}

interface ProfileResult {
  cpuRate: number;
  samples: AdvanceSample[];
  p50ActionMs: number;
  p95ActionMs: number;
  maxLongTaskMs: number;
  maxTimerGapMs: number;
}

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

async function waitForAuditStore(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as typeof window & {
    __gameStore?: unknown;
  }).__gameStore));
}

async function restoreBaseline(page: Page, baseline: string): Promise<void> {
  await page.evaluate((save) => {
    const audit = (window as typeof window & {
      __gameAudit?: { importSave: (text: string) => void };
    }).__gameAudit;
    if (!audit) throw new Error('Audit save bridge unavailable');
    audit.importSave(save);
  }, baseline);
  await page.reload({ waitUntil: 'networkidle' });
  await waitForAuditStore(page);
}

async function runSample(page: Page): Promise<AdvanceSample> {
  return page.evaluate(async (waitMs) => {
    type AuditState = {
      isAdvancing: boolean;
      advanceWindow: () => Promise<void>;
    };
    const store = (window as typeof window & {
      __gameStore?: { getState: () => AuditState };
    }).__gameStore;
    if (!store) throw new Error('Audit store unavailable');

    const longTasks: number[] = [];
    const saveTimings: Array<{
      postMessageMs: number;
      serializationMs: number;
      compressionMs: number;
    }> = [];
    const timingController = new AbortController();
    window.addEventListener('football-save-performance', (event) => {
      saveTimings.push((event as CustomEvent<(typeof saveTimings)[number]>).detail);
    }, { signal: timingController.signal });
    const observer = typeof PerformanceObserver !== 'undefined'
      && PerformanceObserver.supportedEntryTypes.includes('longtask')
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) longTasks.push(entry.duration);
        })
      : null;
    observer?.observe({ entryTypes: ['longtask'] });

    let maxTimerGapMs = 0;
    let lastTimer = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      maxTimerGapMs = Math.max(maxTimerGapMs, now - lastTimer);
      lastTimer = now;
    }, 16);

    const start = performance.now();
    const advance = store.getState().advanceWindow();
    const busyImmediate = store.getState().isAdvancing;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const feedbackFrameMs = performance.now() - start;
    const busyButton = [...document.querySelectorAll('button')]
      .some((button) => button.textContent?.includes('模拟中') || button.textContent?.trim() === '...');
    const busyAtFirstFrame = store.getState().isAdvancing && busyButton;
    await advance;
    const actionMs = performance.now() - start;
    await new Promise((resolve) => setTimeout(resolve, waitMs));

    clearInterval(timer);
    observer?.disconnect();
    timingController.abort();
    const compressedChars = localStorage.getItem('football-universe-save')?.length ?? 0;
    return {
      actionMs,
      feedbackFrameMs,
      busyImmediate,
      busyAtFirstFrame,
      maxLongTaskMs: Math.max(0, ...longTasks),
      maxTimerGapMs,
      maxPostMessageMs: Math.max(0, ...saveTimings.map((timing) => timing.postMessageMs)),
      workerSerializationMs: Math.max(0, ...saveTimings.map((timing) => timing.serializationMs)),
      workerCompressionMs: Math.max(0, ...saveTimings.map((timing) => timing.compressionMs)),
      compressedChars,
    };
  }, settleMs);
}

async function runProfile(
  page: Page,
  cdp: CDPSession,
  baseline: string,
  cpuRate: number,
): Promise<ProfileResult> {
  await restoreBaseline(page, baseline);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
  const profileSamples: AdvanceSample[] = [];
  for (let index = 0; index < samples; index++) profileSamples.push(await runSample(page));
  const actions = profileSamples.map((sample) => sample.actionMs);
  return {
    cpuRate,
    samples: profileSamples,
    p50ActionMs: percentile(actions, 0.5),
    p95ActionMs: percentile(actions, 0.95),
    maxLongTaskMs: Math.max(...profileSamples.map((sample) => sample.maxLongTaskMs)),
    maxTimerGapMs: Math.max(...profileSamples.map((sample) => sample.maxTimerGapMs)),
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);

try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await waitForAuditStore(page);
  await page.evaluate(async (gameSeed) => {
    type AuditState = {
      newGame: (seed: number) => void;
      batchAdvance: (count: number) => Promise<void>;
    };
    const store = (window as typeof window & {
      __gameStore?: { getState: () => AuditState };
    }).__gameStore;
    if (!store) throw new Error('Audit store unavailable');
    store.getState().newGame(gameSeed);
    await store.getState().batchAdvance(35);
  }, seed);
  await page.waitForTimeout(1_000);

  const baseline = await page.evaluate(() => {
    const audit = (window as typeof window & {
      __gameAudit?: { exportSave: () => string };
    }).__gameAudit;
    if (!audit) throw new Error('Audit save bridge unavailable');
    return audit.exportSave();
  });

  const normal = await runProfile(page, cdp, baseline, 1);
  const throttled = await runProfile(page, cdp, baseline, 4);

  await restoreBaseline(page, baseline);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const rapid = await page.evaluate(async () => {
    type AuditState = {
      world: { seasonState: { currentWindowIndex: number } };
      advanceWindow: () => Promise<void>;
    };
    const store = (window as typeof window & {
      __gameStore?: { getState: () => AuditState };
    }).__gameStore;
    if (!store) throw new Error('Audit store unavailable');
    const before = store.getState().world.seasonState.currentWindowIndex;
    await Promise.all(Array.from({ length: 20 }, () => store.getState().advanceWindow()));
    const after = store.getState().world.seasonState.currentWindowIndex;
    return { before, after };
  });

  await page.waitForFunction(
    () => Boolean(localStorage.getItem('football-universe-save')),
    undefined,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(1_000);
  const expectedWindow = rapid.after;
  await page.reload({ waitUntil: 'networkidle' });
  await waitForAuditStore(page);
  const restoredWindow = await page.evaluate(() => {
    type AuditState = { world: { seasonState: { currentWindowIndex: number } } | null };
    return (window as typeof window & {
      __gameStore?: { getState: () => AuditState };
    }).__gameStore?.getState().world?.seasonState.currentWindowIndex ?? -1;
  });

  const result = {
    url,
    viewport: '390x844@3',
    samplesPerProfile: samples,
    normal,
    throttled,
    rapidInput: {
      attempts: 20,
      acceptedAdvances: rapid.after - rapid.before,
      expectedWindow,
      restoredWindow,
    },
  };
  console.log(JSON.stringify(result, null, 2));

  const allSamples = [...normal.samples, ...throttled.samples];
  const failures = [
    allSamples.every((sample) => sample.busyImmediate && sample.busyAtFirstFrame)
      ? null
      : 'advance feedback did not render before simulation',
    Math.max(normal.maxLongTaskMs, throttled.maxLongTaskMs) <= 100
      ? null
      : 'main-thread long task exceeded 100 ms',
    Math.max(normal.maxTimerGapMs, throttled.maxTimerGapMs) <= 200
      ? null
      : 'timer gap exceeded 200 ms',
    normal.p95ActionMs <= 50 ? null : 'normal-speed p95 exceeded 50 ms',
    throttled.p95ActionMs <= 100 ? null : '4x CPU p95 exceeded 100 ms',
    rapid.after - rapid.before === 1 ? null : 'rapid input executed more than one advance',
    restoredWindow === expectedWindow ? null : 'latest acknowledged advance did not survive reload',
  ].filter((failure): failure is string => failure !== null);

  if (failures.length > 0) throw new Error(`Advance performance audit failed: ${failures.join('; ')}`);
} finally {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => undefined);
  await browser.close();
}

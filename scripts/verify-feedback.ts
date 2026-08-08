import { chromium, type ConsoleMessage } from 'playwright';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');

function collectError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript({ content: `
    (() => {
      const probe = {
        contexts: 0,
        starts: [],
        suspends: 0,
        vibrations: [],
        deliveries: [],
      };
      window.__feedbackProbe = probe;
      window.addEventListener('football-feedback-played', event => {
        probe.deliveries.push(event.detail);
      });

      class FakeAudioParam {
        constructor() { this.value = 0; }
        setValueAtTime(value) { this.value = value; }
        exponentialRampToValueAtTime(value) { this.value = value; }
      }
      class FakeNode {
        connect(target) { return target || this; }
        disconnect() {}
      }
      class FakeOscillator extends FakeNode {
        constructor() {
          super();
          this.type = 'sine';
          this.frequency = new FakeAudioParam();
          this.ended = null;
        }
        addEventListener(type, listener) {
          if (type === 'ended') this.ended = listener;
        }
        start(at = 0) {
          probe.starts.push({ frequency: this.frequency.value, at });
        }
        stop() {
          queueMicrotask(() => this.ended?.());
        }
      }
      class FakeGain extends FakeNode {
        constructor() {
          super();
          this.gain = new FakeAudioParam();
        }
      }
      class FakeAudioContext {
        constructor() {
          this.state = 'suspended';
          this.currentTime = 0;
          this.destination = new FakeNode();
          probe.contexts += 1;
        }
        createOscillator() { return new FakeOscillator(); }
        createGain() { return new FakeGain(); }
        resume() { this.state = 'running'; return Promise.resolve(); }
        suspend() {
          this.state = 'suspended';
          probe.suspends += 1;
          return Promise.resolve();
        }
      }
      Object.defineProperty(window, 'AudioContext', {
        configurable: true,
        value: FakeAudioContext,
      });
      Object.defineProperty(navigator, 'vibrate', {
        configurable: true,
        value: pattern => {
          probe.vibrations.push(pattern);
          return true;
        },
      });
    })();
  ` });

  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', message => collectError(message, errors));
  page.on('pageerror', error => errors.push(error.message));

  try {
    await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle' });

    const beforeGesture = await page.evaluate(() => (
      window as typeof window & { __feedbackProbe?: { contexts: number } }
    ).__feedbackProbe?.contexts ?? -1);
    if (beforeGesture !== 0) throw new Error(`AudioContext created before gesture: ${beforeGesture}`);
    const listenerReady = await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('football-feedback-played', {
        detail: { cue: 'probe', audioPlayed: false, hapticPlayed: false },
      }));
      const probe = (window as typeof window & {
        __feedbackProbe?: { deliveries: Array<{ cue: string }> };
      }).__feedbackProbe;
      const ready = probe?.deliveries.some(item => item.cue === 'probe') ?? false;
      if (probe) probe.deliveries.length = 0;
      return ready;
    });
    if (!listenerReady) throw new Error('Feedback event probe was not installed');

    await page.getByRole('button', { name: '开始观察' }).click();
    await page.waitForTimeout(200);
    const startProbe = await page.evaluate(() => (
      window as typeof window & {
        __feedbackProbe?: {
          contexts: number;
          starts: unknown[];
          deliveries: Array<{ cue: string; audioPlayed: boolean }>;
        };
      }
    ).__feedbackProbe ? {
      ...(window as typeof window & {
        __feedbackProbe?: {
          contexts: number;
          starts: unknown[];
          deliveries: Array<{ cue: string; audioPlayed: boolean }>;
        };
      }).__feedbackProbe!,
      visibility: document.visibilityState,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      preference: localStorage.getItem('football-feedback-preferences-v1'),
      pathname: location.pathname,
      initialized: (window as typeof window & {
        __gameStore?: { getState: () => { initialized: boolean } };
      }).__gameStore?.getState().initialized,
      scripts: performance.getEntriesByType('resource')
        .map(entry => entry.name)
        .filter(name => name.includes('/assets/index-') || name.includes('game-feedback')),
    } : null);
    if (!startProbe?.deliveries.some(item => item.cue === 'start' && item.audioPlayed)) {
      throw new Error(`Start feedback did not play: ${JSON.stringify(startProbe)}`);
    }

    const soundToggle = page.getByTestId('global-sound-toggle');
    const toggleBox = await soundToggle.boundingBox();
    if (!toggleBox || toggleBox.width < 44 || toggleBox.height < 44) {
      throw new Error(`Global sound target is undersized: ${JSON.stringify(toggleBox)}`);
    }
    await soundToggle.click();
    if (await soundToggle.getAttribute('aria-pressed') !== 'false') {
      throw new Error('Global sound did not mute');
    }
    await page.reload({ waitUntil: 'networkidle' });
    if (await page.getByTestId('global-sound-toggle').getAttribute('aria-pressed') !== 'false') {
      throw new Error('Global mute did not persist');
    }

    await page.goto(`${baseUrl}/settings?audit=1`, { waitUntil: 'networkidle' });
    await page.getByTestId('sound-preference').check();
    await page.getByTestId('haptics-preference').check();
    await page.waitForTimeout(200);
    await page.waitForFunction(() => Boolean((
      window as typeof window & { __gameStore?: unknown }
    ).__gameStore));
    await page.evaluate(async () => {
      const store = (window as typeof window & {
        __gameStore?: {
          getState: () => {
            advanceUntil: (type: 'season_end') => Promise<boolean>;
          };
        };
      }).__gameStore;
      await store?.getState().advanceUntil('season_end');
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const probe = (window as typeof window & {
        __feedbackProbe?: { deliveries: unknown[]; starts: unknown[]; vibrations: unknown[] };
      }).__feedbackProbe;
      if (probe) {
        probe.deliveries.length = 0;
        probe.starts.length = 0;
        probe.vibrations.length = 0;
      }
    });
    await page.evaluate(async () => {
      const store = (window as typeof window & {
        __gameStore?: {
          getState: () => {
            advanceWindow: () => Promise<boolean>;
          };
        };
      }).__gameStore;
      await store?.getState().advanceWindow();
    });
    await page.waitForTimeout(300);
    const seasonProbe = await page.evaluate(() => ({
      probe: (
      window as typeof window & {
        __feedbackProbe?: {
          deliveries: Array<{ cue: string; audioPlayed: boolean; hapticPlayed: boolean }>;
          contexts: number;
          starts: unknown[];
          vibrations: unknown[];
        };
      }
    ).__feedbackProbe,
      preference: localStorage.getItem('football-feedback-preferences-v1'),
      world: (() => {
        const state = (window as typeof window & {
        __gameStore?: {
          getState: () => {
            world: { seasonState: { seasonNumber: number; currentWindowIndex: number } };
            lastWorldResponse: { seasonChanged: boolean; id: string } | null;
          };
        };
        }).__gameStore?.getState();
        return state ? {
          seasonNumber: state.world.seasonState.seasonNumber,
          currentWindowIndex: state.world.seasonState.currentWindowIndex,
          lastWorldResponse: state.lastWorldResponse,
        } : null;
      })(),
    }));
    if (!seasonProbe.probe?.deliveries.some(item => (
      item.cue === 'season_end' && item.audioPlayed && item.hapticPlayed
    ))) {
      throw new Error(`Season feedback did not play: ${JSON.stringify(seasonProbe)}`);
    }
    const seasonDelivery = await page.evaluate(() => {
      const probe = (window as typeof window & {
        __feedbackProbe?: {
          deliveries: Array<{ cue: string; audioPlayed: boolean; hapticPlayed: boolean }>;
          starts: unknown[];
          vibrations: unknown[];
        };
      }).__feedbackProbe!;
      return {
        deliveries: probe.deliveries.filter(item => item.cue === 'season_end'),
        tones: probe.starts.length,
        vibrations: probe.vibrations,
      };
    });
    if (seasonDelivery.deliveries.length !== 1 || seasonDelivery.tones !== 6
      || seasonDelivery.vibrations.length !== 1) {
      throw new Error(`Season feedback was not bounded: ${JSON.stringify(seasonDelivery)}`);
    }

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => {
      localStorage.setItem('football-feedback-preferences-v1', JSON.stringify({
        soundEnabled: false,
        hapticsEnabled: true,
      }));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(() => {
      const probe = (window as typeof window & {
        __feedbackProbe?: { deliveries: unknown[]; starts: unknown[]; vibrations: unknown[] };
      }).__feedbackProbe;
      if (probe) {
        probe.deliveries.length = 0;
        probe.starts.length = 0;
        probe.vibrations.length = 0;
      }
    });
    await page.getByTestId('global-sound-toggle').click();
    const reducedDelivery = await page.evaluate(() => (
      window as typeof window & {
        __feedbackProbe?: {
          deliveries: Array<{ cue: string; audioPlayed: boolean; hapticPlayed: boolean }>;
          starts: unknown[];
          vibrations: unknown[];
        };
      }
    ).__feedbackProbe);
    if (!reducedDelivery?.deliveries.some(item => item.cue === 'start' && !item.audioPlayed)
      || reducedDelivery.starts.length !== 0 || reducedDelivery.vibrations.length !== 0) {
      throw new Error(`Reduced-motion feedback was not suppressed: ${JSON.stringify(reducedDelivery)}`);
    }
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    await page.evaluate(() => navigator.serviceWorker?.ready);
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('feedback-settings').waitFor({ state: 'visible' });
    await context.setOffline(false);

    const overflow = await page.evaluate(() => (
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    ));
    if (overflow > 1) throw new Error(`Feedback settings overflow by ${overflow}px`);
    if (errors.length > 0) throw new Error(`Runtime errors: ${errors.join(' | ')}`);

    const screenshot = '/tmp/football-feedback-settings-390.png';
    await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });
    console.log(JSON.stringify({
      passed: true,
      beforeGesture,
      target: toggleBox,
      seasonDelivery,
      reducedMotionSuppressed: true,
      offlineRevisit: true,
      overflow,
      runtimeErrors: errors,
      screenshot,
    }, null, 2));
  } finally {
    await context.setOffline(false);
    await context.close();
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

export type PitchRuntimePauseReason = 'none' | 'hidden' | 'covered' | 'completed' | 'break' | 'paused';

/**
 * How much match time one stalled frame is allowed to owe the next one.
 *
 * A tab that was backgrounded, a garbage collection, or a long task can leave
 * the broadcast hundreds of milliseconds behind the wall clock. Paying all of
 * that back at once would mean rendering a burst of frames the viewer never
 * asked for; paying none of it means the match quietly runs long. This ceiling
 * splits the difference, and anything past it is dropped on purpose.
 */
const MAX_CATCHUP_MS = 250;

/** Rendered frames one animation-frame callback may run. 6 x 16.67ms = 100ms. */
const MAX_STEPS_PER_FRAME = 6;

interface RuntimeDocument {
  visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

interface RuntimeIntersectionObserver {
  observe(target: Element): void;
  disconnect(): void;
}

interface PitchRuntimeOptions {
  canvas: HTMLCanvasElement;
  getFrameStepMs: () => number;
  getPlaybackPauseReason: () => Exclude<PitchRuntimePauseReason, 'hidden' | 'covered'>;
  renderFrame: () => void;
  recordFrameInterval: (interval: number) => void;
  onPaused: (reason: PitchRuntimePauseReason) => void;
  onAvailabilityChange: (available: boolean) => void;
  document?: RuntimeDocument;
  createIntersectionObserver?: (
    listener: (visible: boolean) => void,
  ) => RuntimeIntersectionObserver | null;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  now?: () => number;
}

export interface PitchRuntime {
  wake(): void;
  advanceTime(milliseconds: number, fixedStepMs: number): void;
  dispose(): void;
}

export function mountPitchRuntime(options: PitchRuntimeOptions): PitchRuntime {
  const runtimeDocument = options.document ?? document;
  const requestFrame = options.requestFrame ?? requestAnimationFrame;
  const cancelFrame = options.cancelFrame ?? cancelAnimationFrame;
  const now = options.now ?? (() => performance.now());
  let pageVisible = runtimeDocument.visibilityState !== 'hidden';
  let intersectionVisible = true;
  let lastTimestamp = now();
  let accumulator = options.getFrameStepMs();
  let frameHandle = 0;
  let disposed = false;
  let lastPauseReason: PitchRuntimePauseReason = 'none';

  const getPauseReason = (): PitchRuntimePauseReason => {
    if (!pageVisible) return 'hidden';
    if (!intersectionVisible) return 'covered';
    return options.getPlaybackPauseReason();
  };

  const scheduleFrame = () => {
    if (!disposed && frameHandle === 0) frameHandle = requestFrame(animate);
  };

  const wake = () => {
    if (disposed) return;
    lastTimestamp = now();
    accumulator = options.getFrameStepMs();
    scheduleFrame();
  };

  function animate(timestamp: number): void {
    frameHandle = 0;
    if (disposed) return;
    const pauseReason = getPauseReason();
    if (pauseReason !== 'none') {
      if (
        pauseReason !== lastPauseReason
        && pauseReason !== 'hidden'
        && pauseReason !== 'covered'
      ) options.renderFrame();
      lastPauseReason = pauseReason;
      options.onPaused(pauseReason);
      return;
    }
    lastPauseReason = 'none';
    const rawElapsed = Math.max(0, timestamp - lastTimestamp);
    lastTimestamp = timestamp;
    // Report the interval that actually happened. This used to be the clamped
    // value, which capped p95FrameIntervalMs at the clamp and hid the worst
    // stalls from the very heuristics that are supposed to catch them.
    options.recordFrameInterval(rawElapsed);
    // A long stall must not cost the match time forever, but an unbounded
    // catch-up turns one stall into a spiral, so the debt is capped.
    accumulator += Math.min(rawElapsed, MAX_CATCHUP_MS);
    let steps = 0;
    const frameStepMs = options.getFrameStepMs();
    while (accumulator >= frameStepMs && steps < MAX_STEPS_PER_FRAME) {
      options.renderFrame();
      accumulator -= frameStepMs;
      steps++;
    }
    // Whatever is still owed once the step cap is reached is dropped rather
    // than carried: an accumulator that never drains grows every frame.
    if (accumulator >= frameStepMs) accumulator %= frameStepMs;
    scheduleFrame();
  }

  const stopForAvailability = (reason: 'hidden' | 'covered') => {
    if (frameHandle !== 0) cancelFrame(frameHandle);
    frameHandle = 0;
    options.onPaused(reason);
    options.onAvailabilityChange(false);
  };

  const handleVisibilityChange = () => {
    pageVisible = runtimeDocument.visibilityState !== 'hidden';
    if (!pageVisible) {
      stopForAvailability('hidden');
      return;
    }
    options.onAvailabilityChange(intersectionVisible);
    wake();
  };
  runtimeDocument.addEventListener('visibilitychange', handleVisibilityChange);

  const createObserver = options.createIntersectionObserver ?? (typeof IntersectionObserver === 'undefined'
    ? () => null
    : listener => new IntersectionObserver(entries => {
      listener(entries[0]?.isIntersecting ?? true);
    }, { threshold: 0.05 }));
  const intersectionObserver = createObserver(visible => {
    intersectionVisible = visible;
    if (!intersectionVisible) {
      stopForAvailability('covered');
      return;
    }
    options.onAvailabilityChange(pageVisible);
    wake();
  });
  intersectionObserver?.observe(options.canvas);
  wake();

  return {
    wake,
    advanceTime(milliseconds, fixedStepMs) {
      const steps = Math.max(1, Math.round(milliseconds / fixedStepMs));
      for (let step = 0; step < steps; step++) options.renderFrame();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frameHandle !== 0) cancelFrame(frameHandle);
      frameHandle = 0;
      intersectionObserver?.disconnect();
      runtimeDocument.removeEventListener('visibilitychange', handleVisibilityChange);
    },
  };
}

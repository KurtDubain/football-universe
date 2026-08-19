export type PitchRuntimePauseReason = 'none' | 'hidden' | 'covered' | 'completed' | 'break' | 'paused';

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
    const elapsed = Math.min(100, Math.max(0, timestamp - lastTimestamp));
    lastTimestamp = timestamp;
    accumulator += elapsed;
    options.recordFrameInterval(elapsed);
    let steps = 0;
    const frameStepMs = options.getFrameStepMs();
    while (accumulator >= frameStepMs && steps < 6) {
      options.renderFrame();
      accumulator -= frameStepMs;
      steps++;
    }
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

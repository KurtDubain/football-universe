import { describe, expect, it, vi } from 'vitest';
import { mountPitchRuntime, type PitchRuntimePauseReason } from './runtime';

interface FakeDocument {
  visibilityState: DocumentVisibilityState;
  listener?: () => void;
  addEventListener: (_type: 'visibilitychange', listener: () => void) => void;
  removeEventListener: (_type: 'visibilitychange', listener: () => void) => void;
}

function setup() {
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  let observerListener: ((visible: boolean) => void) | undefined;
  const fakeDocument: FakeDocument = {
    visibilityState: 'visible',
    addEventListener: (_type, listener) => { fakeDocument.listener = listener; },
    removeEventListener: (_type, listener) => {
      if (fakeDocument.listener === listener) fakeDocument.listener = undefined;
    },
  };
  const renderFrame = vi.fn();
  const onAvailabilityChange = vi.fn();
  const paused: PitchRuntimePauseReason[] = [];
  let playbackPauseReason: PitchRuntimePauseReason = 'none';
  const runtime = mountPitchRuntime({
    canvas: {} as HTMLCanvasElement,
    getFrameStepMs: () => 16,
    getPlaybackPauseReason: () => playbackPauseReason as Exclude<PitchRuntimePauseReason, 'hidden' | 'covered'>,
    renderFrame,
    recordFrameInterval: vi.fn(),
    onPaused: reason => paused.push(reason),
    onAvailabilityChange,
    document: fakeDocument,
    createIntersectionObserver: listener => {
      observerListener = listener;
      return { observe: vi.fn(), disconnect: vi.fn() };
    },
    requestFrame: callback => {
      const id = ++frameId;
      frames.set(id, callback);
      return id;
    },
    cancelFrame: id => frames.delete(id),
    now: () => 0,
  });
  const runNextFrame = (timestamp: number) => {
    const next = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (!next) throw new Error('No scheduled frame');
    frames.delete(next[0]);
    next[1](timestamp);
  };
  return {
    runtime,
    fakeDocument,
    renderFrame,
    onAvailabilityChange,
    paused,
    runNextFrame,
    setPlaybackPauseReason: (reason: PitchRuntimePauseReason) => { playbackPauseReason = reason; },
    setIntersectionVisible: (visible: boolean) => observerListener?.(visible),
    pendingFrames: () => frames.size,
  };
}

describe('pitch canvas runtime', () => {
  it('runs fixed-step frames and renders one final frame when playback pauses', () => {
    const harness = setup();
    harness.runNextFrame(16);
    expect(harness.renderFrame).toHaveBeenCalledTimes(2);
    harness.setPlaybackPauseReason('break');
    harness.runNextFrame(32);
    expect(harness.renderFrame).toHaveBeenCalledTimes(3);
    expect(harness.paused.at(-1)).toBe('break');
    expect(harness.pendingFrames()).toBe(0);
    harness.runtime.dispose();
  });

  it('pauses while hidden or covered and resumes without advancing unseen frames', () => {
    const harness = setup();
    harness.fakeDocument.visibilityState = 'hidden';
    harness.fakeDocument.listener?.();
    expect(harness.onAvailabilityChange).toHaveBeenLastCalledWith(false);
    expect(harness.pendingFrames()).toBe(0);

    harness.fakeDocument.visibilityState = 'visible';
    harness.fakeDocument.listener?.();
    expect(harness.onAvailabilityChange).toHaveBeenLastCalledWith(true);
    harness.setIntersectionVisible(false);
    expect(harness.onAvailabilityChange).toHaveBeenLastCalledWith(false);
    expect(harness.pendingFrames()).toBe(0);
    harness.setIntersectionVisible(true);
    expect(harness.onAvailabilityChange).toHaveBeenLastCalledWith(true);
    expect(harness.pendingFrames()).toBe(1);
    harness.runtime.dispose();
  });

  it('supports deterministic audit stepping and cleans every listener', () => {
    const harness = setup();
    harness.runtime.advanceTime(50, 10);
    expect(harness.renderFrame).toHaveBeenCalledTimes(5);
    harness.runtime.dispose();
    expect(harness.pendingFrames()).toBe(0);
    expect(harness.fakeDocument.listener).toBeUndefined();
  });
});

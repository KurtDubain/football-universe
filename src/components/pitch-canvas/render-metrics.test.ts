import { describe, expect, it } from 'vitest';
import { createRenderMetricsTracker, EMPTY_RENDER_METRICS } from './render-metrics';

describe('pitch render metrics', () => {
  it('starts with a complete zero-value snapshot', () => {
    expect(createRenderMetricsTracker().snapshot()).toEqual(EMPTY_RENDER_METRICS);
  });

  it('reports rolling average, p95, and maximum draw cost', () => {
    const tracker = createRenderMetricsTracker(4);
    for (const duration of [1, 2, 3, 100, 4]) tracker.recordRenderDuration(duration);

    expect(tracker.snapshot()).toMatchObject({
      renderedFrames: 5,
      averageRenderMs: 27.25,
      p95RenderMs: 100,
      maxRenderMs: 100,
    });
  });

  it('retains lifetime slow-frame streaks while bounding interval samples', () => {
    const tracker = createRenderMetricsTracker(3);
    for (const interval of [34, 35, 16, 40]) tracker.recordFrameInterval(interval);

    expect(tracker.snapshot()).toMatchObject({
      averageFrameIntervalMs: 91 / 3,
      p95FrameIntervalMs: 40,
      maxFrameIntervalMs: 40,
      maxConsecutiveSlowFrames: 2,
    });
  });
});

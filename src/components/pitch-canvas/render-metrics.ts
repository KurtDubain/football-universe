const DEFAULT_SAMPLE_LIMIT = 60;
const SLOW_FRAME_MS = 33;

export interface RenderMetricsSnapshot {
  renderedFrames: number;
  averageRenderMs: number;
  p95RenderMs: number;
  maxRenderMs: number;
  averageFrameIntervalMs: number;
  p95FrameIntervalMs: number;
  maxFrameIntervalMs: number;
  consecutiveSlowFrames: number;
  maxConsecutiveSlowFrames: number;
}

export const EMPTY_RENDER_METRICS: RenderMetricsSnapshot = {
  renderedFrames: 0,
  averageRenderMs: 0,
  p95RenderMs: 0,
  maxRenderMs: 0,
  averageFrameIntervalMs: 0,
  p95FrameIntervalMs: 0,
  maxFrameIntervalMs: 0,
  consecutiveSlowFrames: 0,
  maxConsecutiveSlowFrames: 0,
};

function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentileValue * ordered.length) - 1);
  return ordered[index];
}

function appendBounded(values: number[], value: number, sampleLimit: number): void {
  values.push(value);
  if (values.length > sampleLimit) values.shift();
}

export function createRenderMetricsTracker(sampleLimit = DEFAULT_SAMPLE_LIMIT) {
  const renderDurations: number[] = [];
  const frameIntervals: number[] = [];
  let renderedFrames = 0;
  let consecutiveSlowFrames = 0;
  let maxConsecutiveSlowFrames = 0;
  let maxFrameIntervalMs = 0;

  return {
    recordRenderDuration(duration: number): void {
      renderedFrames++;
      appendBounded(renderDurations, duration, sampleLimit);
    },
    recordFrameInterval(interval: number): void {
      appendBounded(frameIntervals, interval, sampleLimit);
      maxFrameIntervalMs = Math.max(maxFrameIntervalMs, interval);
      consecutiveSlowFrames = interval > SLOW_FRAME_MS ? consecutiveSlowFrames + 1 : 0;
      maxConsecutiveSlowFrames = Math.max(maxConsecutiveSlowFrames, consecutiveSlowFrames);
    },
    snapshot(): RenderMetricsSnapshot {
      return {
        renderedFrames,
        averageRenderMs: average(renderDurations),
        p95RenderMs: percentile(renderDurations, 0.95),
        maxRenderMs: Math.max(0, ...renderDurations),
        averageFrameIntervalMs: average(frameIntervals),
        p95FrameIntervalMs: percentile(frameIntervals, 0.95),
        maxFrameIntervalMs,
        consecutiveSlowFrames,
        maxConsecutiveSlowFrames,
      };
    },
  };
}

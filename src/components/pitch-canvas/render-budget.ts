export type RenderQuality = 'full' | 'constrained' | 'reduced' | 'degraded';

export interface RenderBudget {
  quality: RenderQuality;
  dprCap: number;
  particleCap: number;
  frameStepMs: number;
}

export interface RenderEnvironment {
  cssWidth: number;
  devicePixelRatio: number;
  reducedMotion: boolean;
  hardwareConcurrency?: number;
  deviceMemory?: number;
}

export interface FramePressure {
  renderedFrames: number;
  consecutiveSlowFrames: number;
  consecutiveFastFrames: number;
  p95FrameIntervalMs: number;
  p95RenderMs: number;
}

/**
 * Marker size per quality tier. Lower tiers lose backing-store pixels, so the
 * markers are drawn larger to stay readable.
 *
 * Callers must ease toward these values rather than snapping: a tier change in
 * the middle of a match used to jump players by 11.5% and the ball by 14.8%
 * between two frames, which reads as a rendering glitch rather than a quality
 * adjustment.
 */
export interface VisualScale {
  player: number;
  ball: number;
}

const SIXTY_FPS_MS = 1000 / 60;
const THIRTY_FPS_MS = 1000 / 30;

// The warm-up is longer than the first twenty frames on purpose: those include
// canvas creation, first paint and roster building, none of which repeat, and
// they used to be able to push the rolling average past the degrade line.
const DEGRADE_WARMUP_FRAMES = 45;
const DEGRADE_SLOW_STREAK = 6;
const DEGRADE_P95_INTERVAL_MS = 33;
const DEGRADE_P95_RENDER_MS = 24;

// Recovery is slower and stricter than degradation so one healthy stretch
// cannot undo a real performance problem. Percentiles are used instead of
// averages because a single stall used to be able to hold the average over the
// line for a full sample window.
const RESTORE_MIN_FRAMES = 150;
const RESTORE_FAST_STREAK = 150;
const RESTORE_P95_INTERVAL_MS = 20;
const RESTORE_P95_RENDER_MS = 14;

export function selectRenderBudget(environment: RenderEnvironment): RenderBudget {
  if (environment.reducedMotion) {
    return { quality: 'reduced', dprCap: 1.5, particleCap: 60, frameStepMs: SIXTY_FPS_MS };
  }

  const constrained = environment.cssWidth <= 480
    || (environment.hardwareConcurrency ?? 8) <= 4
    || (environment.deviceMemory ?? 8) <= 4;
  if (constrained) {
    return { quality: 'constrained', dprCap: 2, particleCap: 180, frameStepMs: SIXTY_FPS_MS };
  }
  return {
    quality: 'full',
    dprCap: Math.min(2.5, Math.max(1, environment.devicePixelRatio)),
    particleCap: 350,
    frameStepMs: SIXTY_FPS_MS,
  };
}

export function visualScaleForQuality(quality: RenderQuality): VisualScale {
  return {
    player: quality === 'full' ? 1.04 : quality === 'reduced' ? 1.08 : 1.16,
    ball: quality === 'full' ? 1.08 : 1.24,
  };
}

export function shouldDegradeRenderBudget(pressure: FramePressure): boolean {
  if (pressure.renderedFrames < DEGRADE_WARMUP_FRAMES) return false;
  return pressure.consecutiveSlowFrames >= DEGRADE_SLOW_STREAK
    || pressure.p95FrameIntervalMs > DEGRADE_P95_INTERVAL_MS
    || pressure.p95RenderMs > DEGRADE_P95_RENDER_MS;
}

/**
 * True when a degraded budget has held a healthy cadence long enough to be
 * worth restoring. Frame intervals are recorded from the animation-frame
 * callback rather than from render calls, so they stay meaningful while the
 * simulation cadence is clamped to 30fps.
 */
export function shouldRestoreRenderBudget(pressure: FramePressure): boolean {
  if (pressure.renderedFrames < RESTORE_MIN_FRAMES) return false;
  return pressure.consecutiveFastFrames >= RESTORE_FAST_STREAK
    && pressure.p95FrameIntervalMs <= RESTORE_P95_INTERVAL_MS
    && pressure.p95RenderMs <= RESTORE_P95_RENDER_MS;
}

/**
 * Drops the simulation cadence and the particle budget, but never the backing
 * store.
 *
 * Changing dprCap here would resize the canvas mid-match and rescale every
 * marker at once, which is what made a degraded match look "broken" rather
 * than "cheaper". Tier changes are reversible through restoreRenderBudget, so
 * a transient stall now costs a few seconds of 30fps instead of a permanent
 * downgrade.
 */
export function degradeRenderBudget(current: RenderBudget): RenderBudget {
  if (current.quality === 'reduced' || current.quality === 'degraded') return current;
  return {
    ...current,
    quality: 'degraded',
    particleCap: Math.min(current.particleCap, 100),
    frameStepMs: THIRTY_FPS_MS,
  };
}

/**
 * Returns a degraded budget to the tier the environment actually warrants.
 * 'reduced' reflects a user motion preference, so it is never restored away
 * from.
 *
 * Callers own oscillation control: a device sitting on the boundary can
 * degrade and restore repeatedly, so the caller should stop restoring after a
 * couple of cycles.
 */
export function restoreRenderBudget(
  current: RenderBudget,
  environment: RenderEnvironment,
): RenderBudget {
  if (current.quality !== 'degraded') return current;
  const fresh = selectRenderBudget(environment);
  return fresh.quality === 'reduced' ? current : fresh;
}

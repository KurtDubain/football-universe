import { describe, expect, it } from 'vitest';
import {
  degradeRenderBudget,
  restoreRenderBudget,
  selectRenderBudget,
  shouldDegradeRenderBudget,
  shouldRestoreRenderBudget,
  visualScaleForQuality,
  type FramePressure,
} from './render-budget';

const DESKTOP = {
  cssWidth: 1440,
  devicePixelRatio: 2,
  reducedMotion: false,
  hardwareConcurrency: 8,
  deviceMemory: 8,
};

const healthy: FramePressure = {
  renderedFrames: 200,
  consecutiveSlowFrames: 0,
  consecutiveFastFrames: 200,
  p95FrameIntervalMs: 17,
  p95RenderMs: 4,
};

describe('pitch render budget', () => {
  it('caps mobile pixels and particles without reducing simulation cadence', () => {
    expect(selectRenderBudget({
      cssWidth: 390,
      devicePixelRatio: 3,
      reducedMotion: false,
      hardwareConcurrency: 8,
      deviceMemory: 8,
    })).toEqual({ quality: 'constrained', dprCap: 2, particleCap: 180, frameStepMs: 1000 / 60 });
  });

  it('reduces decorative cost without stretching core match sequences', () => {
    expect(selectRenderBudget({
      cssWidth: 1440,
      devicePixelRatio: 2,
      reducedMotion: true,
    })).toEqual({ quality: 'reduced', dprCap: 1.5, particleCap: 60, frameStepMs: 1000 / 60 });
  });

  it('ignores pressure during the warm-up frames', () => {
    expect(shouldDegradeRenderBudget({
      ...healthy,
      renderedFrames: 44,
      consecutiveSlowFrames: 20,
      p95FrameIntervalMs: 90,
      p95RenderMs: 60,
    })).toBe(false);
  });

  it('degrades only after sustained measured pressure', () => {
    expect(shouldDegradeRenderBudget(healthy)).toBe(false);
    expect(shouldDegradeRenderBudget({ ...healthy, consecutiveSlowFrames: 6 })).toBe(true);
    expect(shouldDegradeRenderBudget({ ...healthy, p95FrameIntervalMs: 34 })).toBe(true);
    expect(shouldDegradeRenderBudget({ ...healthy, p95RenderMs: 25 })).toBe(true);
  });

  it('drops cadence and particles but never the backing store', () => {
    const degraded = degradeRenderBudget(selectRenderBudget(DESKTOP));
    expect(degraded).toEqual({
      quality: 'degraded',
      dprCap: 2,
      particleCap: 100,
      frameStepMs: 1000 / 30,
    });
    expect(degradeRenderBudget(degraded)).toBe(degraded);
  });

  it('restores a degraded budget to the tier the environment warrants', () => {
    const degraded = degradeRenderBudget(selectRenderBudget(DESKTOP));
    expect(restoreRenderBudget(degraded, DESKTOP)).toEqual(selectRenderBudget(DESKTOP));
    expect(restoreRenderBudget(selectRenderBudget(DESKTOP), DESKTOP))
      .toEqual(selectRenderBudget(DESKTOP));
  });

  it('never restores away from the reduced-motion preference', () => {
    const reducedEnv = { ...DESKTOP, reducedMotion: true };
    const degraded = { ...selectRenderBudget(reducedEnv), quality: 'degraded' as const };
    expect(restoreRenderBudget(degraded, reducedEnv).quality).toBe('degraded');
  });

  it('restores only after a long healthy stretch', () => {
    expect(shouldRestoreRenderBudget(healthy)).toBe(true);
    expect(shouldRestoreRenderBudget({ ...healthy, renderedFrames: 149 })).toBe(false);
    expect(shouldRestoreRenderBudget({ ...healthy, consecutiveFastFrames: 149 })).toBe(false);
    expect(shouldRestoreRenderBudget({ ...healthy, p95FrameIntervalMs: 21 })).toBe(false);
    expect(shouldRestoreRenderBudget({ ...healthy, p95RenderMs: 15 })).toBe(false);
  });

  it('exposes the marker scale per tier for eased transitions', () => {
    expect(visualScaleForQuality('full')).toEqual({ player: 1.04, ball: 1.08 });
    expect(visualScaleForQuality('reduced')).toEqual({ player: 1.08, ball: 1.24 });
    expect(visualScaleForQuality('constrained')).toEqual({ player: 1.16, ball: 1.24 });
    expect(visualScaleForQuality('degraded')).toEqual({ player: 1.16, ball: 1.24 });
  });
});

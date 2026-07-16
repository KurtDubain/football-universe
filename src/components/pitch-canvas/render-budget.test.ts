import { describe, expect, it } from 'vitest';
import { degradeRenderBudget, selectRenderBudget, shouldDegradeRenderBudget } from './render-budget';

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

  it('uses a quiet four-frame-per-second budget for reduced motion', () => {
    expect(selectRenderBudget({
      cssWidth: 1440,
      devicePixelRatio: 2,
      reducedMotion: true,
    })).toEqual({ quality: 'reduced', dprCap: 1.5, particleCap: 60, frameStepMs: 250 });
  });

  it('degrades only after sustained measured pressure', () => {
    const healthy = {
      renderedFrames: 60,
      consecutiveSlowFrames: 0,
      averageFrameIntervalMs: 17,
      averageRenderMs: 4,
    };
    expect(shouldDegradeRenderBudget(healthy)).toBe(false);
    expect(shouldDegradeRenderBudget({ ...healthy, consecutiveSlowFrames: 4 })).toBe(true);

    const degraded = degradeRenderBudget(selectRenderBudget({
      cssWidth: 390,
      devicePixelRatio: 3,
      reducedMotion: false,
    }));
    expect(degraded).toEqual({ quality: 'degraded', dprCap: 1.5, particleCap: 100, frameStepMs: 1000 / 30 });
    expect(degradeRenderBudget(degraded)).toBe(degraded);
  });
});


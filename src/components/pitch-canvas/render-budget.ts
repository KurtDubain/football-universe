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
  averageFrameIntervalMs: number;
  averageRenderMs: number;
}

const SIXTY_FPS_MS = 1000 / 60;
const THIRTY_FPS_MS = 1000 / 30;

export function selectRenderBudget(environment: RenderEnvironment): RenderBudget {
  if (environment.reducedMotion) {
    return { quality: 'reduced', dprCap: 1.5, particleCap: 60, frameStepMs: 250 };
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

export function shouldDegradeRenderBudget(pressure: FramePressure): boolean {
  if (pressure.renderedFrames < 20) return false;
  return pressure.consecutiveSlowFrames >= 4
    || pressure.averageFrameIntervalMs > 30
    || pressure.averageRenderMs > 20;
}

export function degradeRenderBudget(current: RenderBudget): RenderBudget {
  if (current.quality === 'reduced' || current.quality === 'degraded') return current;
  return {
    quality: 'degraded',
    dprCap: Math.min(current.dprCap, 1.5),
    particleCap: Math.min(current.particleCap, 100),
    frameStepMs: THIRTY_FPS_MS,
  };
}


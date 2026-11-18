import { describe, expect, it } from 'vitest';
import {
  broadcastPlayerHeight,
  drawBroadcastPlayer,
  SPRINT_REFERENCE_SPEED,
  STRIDE_RATE_SPRINT,
  STRIDE_RATE_WALK,
  strideRateFor,
} from './broadcast-figures';
import { createBroadcastView } from './broadcast-view';
import { rigForMoment } from './projection';

const W = 520;
const H = 344;

/**
 * The fastest the movement layer can push a forward: jog pace for the role,
 * times the sprint boost, times the directed-recovery boost.
 */
const FULL_SPRINT = 0.00098 * 1.55 * 1.15;
/** A midfielder at cruise, with no sprint and no recovery boost. */
const MIDFIELDER_JOG = 0.00094;

interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  round: boolean;
}

/**
 * A canvas context that records the stroked line segments instead of drawing
 * them, so a test can measure what the figure actually put on the pitch.
 */
function recordingContext(): { ctx: CanvasRenderingContext2D; segments: Segment[] } {
  const segments: Segment[] = [];
  let from: { x: number; y: number } | null = null;
  let round = false;
  const target = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    get lineCap() { return round ? 'round' : 'butt'; },
    set lineCap(value: string) { round = value === 'round'; },
    beginPath() { from = null; },
    moveTo(x: number, y: number) { from = { x, y }; },
    lineTo(x: number, y: number) {
      if (from) segments.push({ x0: from.x, y0: from.y, x1: x, y1: y, round });
    },
    stroke() {},
    fill() {},
    closePath() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    clip() {},
    setLineDash() {},
    fillRect() {},
    strokeRect() {},
    arc() {},
    ellipse() {},
    fillText() {},
    strokeText() {},
    measureText: () => ({ width: 10 }),
  };
  return { ctx: target as unknown as CanvasRenderingContext2D, segments };
}

function drawRunner(dirX: number, dirY: number, speed: number, stridePhase: number) {
  const view = createBroadcastView(rigForMoment('wide', true, 0.5, false), W, H, 'landscape');
  const ground = view.at(0.5, 0.5);
  const { ctx, segments } = recordingContext();
  drawBroadcastPlayer(ctx, {
    view,
    ground,
    dirX,
    dirY,
    color: '#2563eb',
    number: 9,
    seed: 3,
    frame: 0,
    stridePhase,
    speed,
    hasBall: false,
    highlighted: false,
    featured: false,
    teamSide: 'home',
  });
  const height = broadcastPlayerHeight(view, ground);
  // A leg is the only round-capped stroke that ends at the ground; the torso
  // the shorts and the kit pattern all stop well above it.
  const legs = segments.filter(
    segment => segment.round && Math.abs(segment.y1 - ground.y) < height * 0.3,
  );
  return {
    height,
    legs,
    swing: Math.max(0, ...legs.map(leg => Math.abs(leg.x1 - leg.x0))),
    lift: Math.max(0, ...legs.map(leg => ground.y - leg.y1)),
  };
}

describe('broadcast figure stride', () => {
  it('swings the legs the full amount at a sprint', () => {
    const sprint = drawRunner(1, 0, FULL_SPRINT, Math.PI / 2);

    expect(sprint.legs).toHaveLength(2);
    // 0.18 of the drawn height is 90% of the 0.2 the pose asks for. Under the
    // old 0.0055 reference this figure swung 0.064 of its height, which is
    // narrower than the line the leg is stroked with.
    expect(sprint.swing).toBeGreaterThan(sprint.height * 0.18);
  });

  it('keeps a jog visibly short of a sprint without going still', () => {
    const jog = drawRunner(1, 0, MIDFIELDER_JOG, Math.PI / 2);
    const sprint = drawRunner(1, 0, FULL_SPRINT, Math.PI / 2);

    expect(jog.swing).toBeGreaterThan(jog.height * 0.08);
    expect(jog.swing).toBeLessThan(sprint.swing * 0.85);
  });

  it('turns the stride into depth when the runner is coming at the lens', () => {
    const atLens = drawRunner(0, 1, FULL_SPRINT, Math.PI / 2);

    // Running straight at the camera there is no sideways stride to show, so
    // the legs must stop scissoring across the screen...
    expect(atLens.swing).toBeLessThan(atLens.height * 0.02);
    // ...and the motion has to survive as the near foot rising in frame.
    expect(atLens.lift).toBeGreaterThan(atLens.height * 0.05);
  });

  it('lifts the swinging foot by a share of the figure, not a fixed fraction of a pixel', () => {
    const across = drawRunner(1, 0, FULL_SPRINT, Math.PI / 2);

    expect(across.lift).toBeGreaterThan(across.height * 0.05);
  });

  it('paces the stride cycle between a walk and a sprint, never at a buzz', () => {
    const cyclesPerSecond = (rate: number) => (rate * 60) / (Math.PI * 2);

    expect(strideRateFor(0)).toBe(STRIDE_RATE_WALK);
    expect(strideRateFor(FULL_SPRINT)).toBeCloseTo(STRIDE_RATE_SPRINT, 10);
    // Two steps a second at a walk, four and a half at a sprint, and one
    // cycle here is two steps. The fixed 0.44 this replaced was 4.2 cycles a
    // second at every pace.
    expect(cyclesPerSecond(STRIDE_RATE_WALK)).toBeGreaterThan(1);
    expect(cyclesPerSecond(STRIDE_RATE_SPRINT)).toBeLessThan(2.4);
    expect(STRIDE_RATE_SPRINT).toBeGreaterThan(STRIDE_RATE_WALK * 1.8);
  });

  it('puts the fastest footballer the movement layer can produce at the top of the range', () => {
    expect(FULL_SPRINT / SPRINT_REFERENCE_SPEED).toBeGreaterThan(1);
    expect(MIDFIELDER_JOG / SPRINT_REFERENCE_SPEED).toBeGreaterThan(0.4);
    expect(MIDFIELDER_JOG / SPRINT_REFERENCE_SPEED).toBeLessThan(0.75);
  });
});

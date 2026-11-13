import type { PlaybackMode } from '../match-live/playback-mode';
import { PENALTY_AREA_DEPTH_METERS, STANDARD_PITCH_LENGTH_METERS } from './geometry';
import { clamp, lerp } from './math';
import type { RenderQuality } from './render-budget';

export type BroadcastCameraMoment = 'wide' | 'build' | 'attack' | 'set_piece' | 'finish' | 'outcome';

export interface BroadcastCameraTargetInput {
  moment: BroadcastCameraMoment;
  quality: RenderQuality;
  playbackMode: PlaybackMode;
  reducedMotion: boolean;
  ballX: number;
  ballY: number;
  canvasWidth: number;
  canvasHeight: number;
  padding: number;
  fieldWidth: number;
  fieldHeight: number;
  /** How far the goal is drawn past its goal line, from `createPitchGeometry`. */
  goalDepth: number;
}

/**
 * The world-space span the shot exists to show.
 *
 * The pan used to be bounded so the *focus point* stayed on screen. That
 * point is by construction somewhere between the centre and the ball, so the
 * floor protected a spot that is never the subject: measured at the tightest
 * framing with the ball on the goal line, the focus rode the right edge of
 * frame while the ball and the goal sat 132px outside it. Framing an explicit
 * span instead makes the floor mean what it was always meant to mean.
 */
export interface BroadcastCameraFrame {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface BroadcastCameraTarget {
  focusX: number;
  focusY: number;
  zoom: number;
  settle: number;
  frame: BroadcastCameraFrame;
}

/**
 * Hard ceilings. renderer.ts clamps against MAX_BROADCAST_ZOOM as well, so a
 * stale camera state can never scale the pitch past it.
 *
 * The pitch itself is a cached bitmap at backing-store resolution, so anything
 * above 1 magnifies it. Players and the ball are drawn as vectors after the
 * transform and stay sharp, which reads as a soft ground under crisp subjects.
 * Pushing much past 1.8 would make that mismatch obvious; rendering the pitch
 * directly per frame instead of from the cache is the fix if it ever bothers.
 */
export const MAX_BROADCAST_ZOOM = 1.8;
export const MAX_COMPACT_BROADCAST_ZOOM = 1.56;

/**
 * Screen-space gap kept between the framed subject and the edge of the canvas.
 * Small on purpose: the goal is drawn only 2 logical units from the end of the
 * pitch bitmap, so the margin is what the camera has to pan past it for.
 */
export const CAMERA_FRAME_MARGIN = 5;

/**
 * How far past the drawn pitch the camera may slide, in logical units.
 *
 * The overscan clamp exists so panning never reveals unpainted canvas. But the
 * goal occupies 510..518 of a 520-wide drawing, which leaves the frame
 * constraint and the overscan clamp with no overlap at all above ~1.1x: keeping
 * the goal 5px off the edge needs pan -188.8 while the overscan bound is -186.2.
 * Allowing a small reveal resolves it, and the exposed strip is painted with the
 * same colour `drawPitch` uses for its outer surround, so the seam is invisible
 * and the strip reads as the ground behind the goal.
 */
export const CAMERA_FRAME_BLEED = 24;

/**
 * The frame constraint only applies once the camera has actually pushed in.
 *
 * At `wide` (1.004) and `build` (1.034) the viewport already covers the whole
 * pitch, so framing the subject is free — and enforcing it would drag the
 * resting shot off centre to satisfy a margin nobody can see. Above this slack
 * the viewport is narrower than the pitch and the constraint starts to matter.
 */
export const CAMERA_FRAME_MIN_ZOOM_SLACK = 0.06;

/**
 * Framing per moment.
 *
 * The old table ran 1.004 → 1.115, an 11.5% push from the widest shot to a
 * goal. Measured against a real goal frame, that was indistinguishable from
 * the resting shot: the physics layer already differentiates six attacking
 * patterns and cross arcs, and none of it was legible at that scale.
 *
 * Wide and build stay near 1 — a broadcast camera does not creep in while play
 * is circulation — and the push is concentrated where the ball is actually
 * being struck. Compact tops out lower because its canvas is smaller and its
 * markers are already drawn 12% larger.
 */
const DESKTOP_ZOOM: Record<BroadcastCameraMoment, number> = {
  wide: 1.004,
  build: 1.034,
  attack: 1.12,
  set_piece: 1.36,
  finish: 1.62,
  outcome: 1.72,
};

const COMPACT_ZOOM: Record<BroadcastCameraMoment, number> = {
  wide: 1,
  build: 1.022,
  attack: 1.08,
  set_piece: 1.22,
  finish: 1.42,
  outcome: 1.5,
};

const FOCUS_WEIGHT: Record<BroadcastCameraMoment, number> = {
  wide: 0.1,
  build: 0.24,
  attack: 0.48,
  set_piece: 0.68,
  finish: 0.82,
  outcome: 0.86,
};

/**
 * Per-frame easing toward the target.
 *
 * Raised for the tight moments because the zoom gaps they now have to cross
 * are far larger: at the old 0.032 a 1.12 → 1.62 push needed about 70 frames
 * to close 90% of the gap, which is longer than the shot it was framing. At
 * 0.075 it lands in roughly 30 frames.
 */
const SETTLE: Record<BroadcastCameraMoment, number> = {
  wide: 0.014,
  build: 0.018,
  attack: 0.032,
  set_piece: 0.05,
  finish: 0.075,
  outcome: 0.085,
};

/**
 * Loose-follow pan with a visibility floor.
 *
 * The 0.22 / 0.18 drift is the broadcast feel — the camera leans toward the
 * ball rather than locking onto it. That was safe while the viewport covered
 * nearly the whole pitch, because the overscan clamp bound first and the drift
 * factor barely mattered. At 1.7x the viewport is a third of the pitch, and
 * the same drift lets the focus point walk off screen: the ball would leave
 * frame during the one moment the camera exists to show it.
 *
 * So the drift is kept, then clamped into the pan range that keeps the focus
 * point inside the viewport. Below roughly 1.2x that range already contains
 * the drift and the result is byte-identical to the old formula; above it the
 * floor takes over and the focus rides the edge of frame instead of leaving.
 *
 * `overscan` is how far the scaled pitch may slide before its own edge would
 * enter the canvas, so the pan never reveals past what has been drawn.
 *
 * When `frame` is supplied the floor switches from "keep the focus point on
 * screen" to "keep the whole subject span on screen, with `CAMERA_FRAME_MARGIN`
 * to spare", and the overscan bound is relaxed by `CAMERA_FRAME_BLEED` so that
 * span is reachable. Without `frame` the result is byte-identical to the
 * formula this replaced, which is what the wide framings still use.
 */
export function broadcastCameraPan(
  focusX: number,
  focusY: number,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number,
  frame?: BroadcastCameraFrame,
): { panX: number; panY: number } {
  const framed = frame !== undefined && zoom - 1 >= CAMERA_FRAME_MIN_ZOOM_SLACK;
  const bleed = framed ? CAMERA_FRAME_BLEED : 0;
  const overscanX = Math.max(0, (zoom - 1) * canvasWidth / 2 - 1) + bleed;
  const overscanY = Math.max(0, (zoom - 1) * canvasHeight / 2 - 1) + bleed;
  // A world point lands at (point - size / 2) * zoom + size / 2 + pan, so
  // keeping that point inside [0, size] bounds pan by keep ± size / 2.
  const keepX = (canvasWidth / 2 - focusX) * zoom;
  const keepY = (canvasHeight / 2 - focusY) * zoom;

  /**
   * Pan bounds for one axis.
   *
   * `focusLo`/`focusHi` are the legacy focus-point floor; `lo`/`hi` are what the
   * subject span needs. Both are intersected with the overscan clamp, and if
   * the span cannot be satisfied at this zoom the focus floor takes over — a
   * clipped goal beats a strip of unpainted canvas.
   */
  const bound = (
    drift: number,
    keep: number,
    size: number,
    overscan: number,
    min: number,
    max: number,
  ): number => {
    const focusLo = Math.max(-overscan, keep - size / 2);
    const focusHi = Math.min(overscan, keep + size / 2);
    if (!framed) return clamp(drift, focusLo, focusHi);
    // screen(min) >= margin bounds pan from below, screen(max) <= size - margin
    // from above — so the lower bound reads `min` and the upper bound reads `max`.
    const lo = Math.max(focusLo, (size / 2 - min) * zoom - size / 2 + CAMERA_FRAME_MARGIN);
    const hi = Math.min(focusHi, (size / 2 - max) * zoom + size / 2 - CAMERA_FRAME_MARGIN);
    return lo > hi ? clamp(drift, focusLo, focusHi) : clamp(drift, lo, hi);
  };

  return {
    panX: bound(
      (canvasWidth / 2 - focusX) * 0.22,
      keepX,
      canvasWidth,
      overscanX,
      frame ? frame.minX : focusX,
      frame ? frame.maxX : focusX,
    ),
    panY: bound(
      (canvasHeight / 2 - focusY) * 0.18,
      keepY,
      canvasHeight,
      overscanY,
      frame ? frame.minY : focusY,
      frame ? frame.maxY : focusY,
    ),
  };
}

export function broadcastCameraTarget(input: BroadcastCameraTargetInput): BroadcastCameraTarget {
  const {
    moment,
    quality,
    playbackMode,
    reducedMotion,
    ballX,
    ballY,
    canvasWidth,
    canvasHeight,
    padding,
    fieldWidth,
    fieldHeight,
    goalDepth,
  } = input;

  /**
   * What the shot owes the viewer.
   *
   * The ball always. Plus the goal it is attacking, once the ball is close
   * enough that the goal is the point of the frame — the penalty area is the
   * same 16.5 m the pitch geometry draws its box from. Outside that the goal
   * is scenery the wide shot already shows, and dragging it into frame would
   * only pull the camera off the ball.
   */
  const attackingRight = ballX >= canvasWidth / 2;
  const goalLine = attackingRight ? padding + fieldWidth : padding;
  const goalBack = attackingRight ? goalLine + goalDepth : goalLine - goalDepth;
  const penaltyDepth = fieldWidth * (PENALTY_AREA_DEPTH_METERS / STANDARD_PITCH_LENGTH_METERS);
  const goalInFrame = Math.abs(ballX - goalLine) <= penaltyDepth;
  const frame: BroadcastCameraFrame = {
    minX: goalInFrame ? Math.min(ballX, goalBack) : ballX,
    maxX: goalInFrame ? Math.max(ballX, goalBack) : ballX,
    minY: ballY,
    maxY: ballY,
  };

  if (reducedMotion) {
    return { focusX: canvasWidth / 2, focusY: canvasHeight / 2, zoom: 1, settle: 1, frame };
  }

  const compact = quality !== 'full';
  const zoomTable = compact ? COMPACT_ZOOM : DESKTOP_ZOOM;
  // Multiplicative rather than the old flat +0.008: an additive lift that was
  // sized for a 1.1x ceiling is invisible against a 1.7x framing, which would
  // have quietly made immersive mode identical to live at the tight moments.
  const immersiveLift = playbackMode === 'immersive' && moment !== 'wide'
    ? (compact ? 1.02 : 1.035)
    : 1;
  const maxZoom = compact ? MAX_COMPACT_BROADCAST_ZOOM : MAX_BROADCAST_ZOOM;
  const safeBallX = clamp(ballX, padding + fieldWidth * 0.1, padding + fieldWidth * 0.9);
  const safeBallY = clamp(ballY, padding + fieldHeight * 0.1, padding + fieldHeight * 0.9);
  const focusWeight = FOCUS_WEIGHT[moment];

  return {
    focusX: lerp(canvasWidth / 2, safeBallX, focusWeight),
    focusY: lerp(canvasHeight / 2, safeBallY, focusWeight),
    zoom: clamp(zoomTable[moment] * immersiveLift, 1, maxZoom),
    settle: SETTLE[moment],
    frame,
  };
}

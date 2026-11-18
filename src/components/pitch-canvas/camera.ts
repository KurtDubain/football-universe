// Framing is owned by the rig system in projection.ts: `rigForMoment` picks a
// lens and `createBroadcastView` builds the projection from it. What is left
// here is the pan solver that transform still runs through, plus the ceilings
// it clamps against.
//
// A zoom-and-focus director used to live here too, with a per-moment table
// running 1.004 at wide to 1.72 at a goal. It was never executed: the render
// loop parks the legacy camera at the centre of the canvas at 1x every frame,
// so the table, its easing curve and its focus weights were dead weight that
// read as though they were in charge of the shot.
import { clamp } from './math';

export type BroadcastCameraMoment = 'wide' | 'build' | 'attack' | 'set_piece' | 'finish' | 'outcome';

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

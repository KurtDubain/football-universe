// Broadcast camera rigs: how a normalized pitch point becomes a point on
// screen under a fixed, physical camera.
//
// The simulation is view-agnostic — every position in this pipeline is a
// normalized (length, width) pair — so a camera is purely a projection. That
// is what makes a broadcast view affordable: nothing in physics.ts or
// sequence.ts changes, only where the result is drawn.
//
// The model is a pinhole camera looking across the pitch width. Depth runs
// into the screen, so the touchlines map to a trapezoid and everything
// foreshortens toward the far side. Both the depth curve and the scale curve
// have closed forms, derived once here rather than approximated per frame.

import { clamp } from './math';
import { STANDARD_PITCH_LENGTH_METERS } from './geometry';
import type { BroadcastCameraMoment } from './camera';

export type CameraRigId = 'tactical' | 'sideline' | 'box';

export interface CameraRig {
  id: CameraRigId;
  /** Screen fraction, top of the drawing space, where the far touchline sits. */
  farEdgeY: number;
  /** Screen fraction where the near touchline sits. May exceed 1 to crop it. */
  nearEdgeY: number;
  /**
   * Near touchline length as a fraction of the drawing width. 1 fits the
   * whole pitch; above 1 pushes the ends out of frame, which is how a real
   * camera crops to the final third.
   */
  nearSpan: number;
  /**
   * Apparent width of the far touchline relative to the near one. 1 is
   * orthographic; lower is a closer, wider lens with stronger perspective.
   */
  depthRatio: number;
  /** Which slice of the pitch length is centred in frame, 0..1. */
  centerX: number;
}

/** A drawn footballer, in metres. Used to size sprites against the pitch. */
export const PLAYER_HEIGHT_METERS = 1.82;
/** A drawn ball, in metres. */
export const BALL_DIAMETER_METERS = 0.22;

/**
 * The three cameras a broadcast cuts between.
 *
 * They differ in lens and height, not in what they are pointed at, which is
 * what keeps the cut legible: the viewer always knows where they are standing.
 * `box` follows the attacking goal, so its `centerX` is resolved per frame by
 * `rigForMoment` rather than fixed here.
 */
export const CAMERA_RIGS: Record<CameraRigId, CameraRig> = {
  // High and long. Almost the whole pitch, mild perspective, tactics readable.
  tactical: {
    id: 'tactical',
    farEdgeY: 0.19,
    nearEdgeY: 0.98,
    nearSpan: 1.04,
    depthRatio: 0.82,
    centerX: 0.5,
  },
  // The default broadcast position: lower, closer, the stand fills the top.
  sideline: {
    id: 'sideline',
    farEdgeY: 0.27,
    nearEdgeY: 1.0,
    nearSpan: 1.32,
    depthRatio: 0.7,
    centerX: 0.5,
  },
  // Tight on the penalty area. Strong perspective, ends cropped.
  box: {
    id: 'box',
    farEdgeY: 0.31,
    nearEdgeY: 1.04,
    nearSpan: 2.45,
    depthRatio: 0.56,
    centerX: 0.5,
  },
};

export interface ProjectedPoint {
  /** Drawing-space x of the ground contact point. */
  x: number;
  /** Drawing-space y of the ground contact point. */
  y: number;
  /** 1 at the near touchline, `depthRatio` at the far one. */
  scale: number;
}

/**
 * `a` is the camera distance to the near touchline measured in pitch widths.
 *
 * Both curves below fall out of it: with depth `d(v) = a + 1 - v` in those
 * units, apparent size is `a / d` and the screen row is the same ratio
 * rescaled to the two edge rows. Clamped so a rig can never divide by zero
 * or ask for an orthographic camera it did not declare.
 */
function rigA(rig: CameraRig): number {
  const ratio = clamp(rig.depthRatio, 0.15, 0.97);
  return ratio / (1 - ratio);
}

/**
 * Project a normalized pitch point onto the drawing space.
 *
 * `lengthFraction` runs 0..1 along the pitch; `widthFraction` runs 0..1
 * across it, where 1 is the near touchline and 0 the far one.
 */
export function projectPitchPoint(
  rig: CameraRig,
  lengthFraction: number,
  widthFraction: number,
  W: number,
  H: number,
): ProjectedPoint {
  const a = rigA(rig);
  const depth = a + 1 - clamp(widthFraction, 0, 1);
  const scale = a / depth;
  const row = a * clamp(widthFraction, 0, 1) / depth;
  return {
    x: W / 2 + (lengthFraction - rig.centerX) * rig.nearSpan * W * scale,
    y: (rig.farEdgeY + (rig.nearEdgeY - rig.farEdgeY) * row) * H,
    scale,
  };
}

/** Apparent size multiplier at a given depth, without the x/y work. */
export function rigDepthScale(rig: CameraRig, widthFraction: number): number {
  const a = rigA(rig);
  return a / (a + 1 - clamp(widthFraction, 0, 1));
}

/** Drawing units per metre at the near touchline. */
export function rigUnitsPerMeter(rig: CameraRig, W: number): number {
  return rig.nearSpan * W / STANDARD_PITCH_LENGTH_METERS;
}

/**
 * How close to the goal the ball has to be before the tight camera earns its
 * cut, as a fraction of the pitch length. 0.26 is 27 m — a little past the
 * edge of the penalty area.
 */
export const BOX_CAMERA_REACH = 0.26;

/**
 * Which camera a moment is shot on, and where it is pointed.
 *
 * A real broadcast cuts between a fixed set of positions rather than flying
 * between them, so this is a lookup and not an interpolation. `attackingRight`
 * only moves the `box` camera: a tight shot belongs on the goal being
 * attacked, and pointing it at the other end would frame an empty penalty
 * area while the ball is a hundred metres away.
 *
 * The moment alone is not enough to justify that cut. `finish` covers every
 * shot including one hit from thirty metres, and `outcome` holds the frame
 * for more than a second afterwards, so keying purely on the moment put a
 * 2.45x lens on the centre circle with the goal it was supposedly framing
 * somewhere off the side of the picture. The ball has to be near the goal too.
 */
/**
 * How much further the ball may drift before the tight camera gives the shot
 * back, once it has taken it.
 *
 * `BOX_CAMERA_REACH` alone is a hard threshold on a value that jitters. A ball
 * hovering on the boundary flipped the lens every frame, which measured as a
 * burst of a dozen cuts inside half a second around every shot. Releasing
 * later than engaging is the standard fix and costs nothing here, because the
 * extra reach frames the same penalty area the camera was already on.
 */
export const BOX_CAMERA_RELEASE_REACH = BOX_CAMERA_REACH + 0.07;

/** Whether the tight camera owns the shot, with hysteresis. */
export function boxCameraEngaged(
  attackingRight: boolean,
  ballLengthFraction: number,
  wasEngaged: boolean,
): boolean {
  const goalLengthFraction = attackingRight ? 1 : 0;
  const distance = Math.abs(ballLengthFraction - goalLengthFraction);
  return distance <= (wasEngaged ? BOX_CAMERA_RELEASE_REACH : BOX_CAMERA_REACH);
}

export function rigForMoment(
  moment: BroadcastCameraMoment,
  attackingRight: boolean,
  ballLengthFraction: number,
  boxEngaged = boxCameraEngaged(attackingRight, ballLengthFraction, false),
): CameraRig {
  if (moment === 'set_piece' || moment === 'finish' || moment === 'outcome') {
    if (boxEngaged) {
      return { ...CAMERA_RIGS.box, centerX: attackingRight ? 0.79 : 0.21 };
    }
    return CAMERA_RIGS.sideline;
  }
  // Open play belongs to the main camera.
  //
  // This used to send `build` to the high camera and `attack` to the main
  // one, keyed on the stage of the pass currently in flight. Every possession
  // runs build -> progress -> create, so every possession cut from the high
  // camera to the main one at the same point and then back again: measured
  // over 3,000 generated sequences, 3,000 of them produced exactly one cut
  // and every one of those cuts was tactical -> sideline. A director holds
  // the main camera through circulation and cuts when there is a reason to.
  // `wide` is the only moment with no play in it at all.
  if (moment === 'wide') return CAMERA_RIGS.tactical;
  return CAMERA_RIGS.sideline;
}

/**
 * The four projected corners of the pitch, near-left first and going
 * clockwise. Used for the ground fill, the mow stripes and the surround mask.
 */
export function pitchCorners(
  rig: CameraRig,
  W: number,
  H: number,
): ProjectedPoint[] {
  return [
    projectPitchPoint(rig, 0, 1, W, H),
    projectPitchPoint(rig, 1, 1, W, H),
    projectPitchPoint(rig, 1, 0, W, H),
    projectPitchPoint(rig, 0, 0, W, H),
  ];
}

/**
 * Trace a straight line on the pitch as a projected polyline.
 *
 * A line that runs into the screen is not a straight line on screen under a
 * pinhole camera, so every pitch marking has to be walked. Eight segments is
 * well past the point where the bend stops being visible at these framings.
 */
export function tracePitchLine(
  ctx: CanvasRenderingContext2D,
  rig: CameraRig,
  from: { u: number; v: number },
  to: { u: number; v: number },
  W: number,
  H: number,
  segments = 8,
): void {
  for (let step = 0; step <= segments; step++) {
    const t = step / segments;
    const point = projectPitchPoint(
      rig,
      from.u + (to.u - from.u) * t,
      from.v + (to.v - from.v) * t,
      W,
      H,
    );
    if (step === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  }
}

/**
 * Trace a circle or arc marked on the pitch (centre circle, penalty arcs).
 */
export function tracePitchArc(
  ctx: CanvasRenderingContext2D,
  rig: CameraRig,
  centerU: number,
  centerV: number,
  radiusMeters: number,
  W: number,
  H: number,
  startAngle = 0,
  endAngle = Math.PI * 2,
  segments = 28,
): void {
  const uRadius = radiusMeters / STANDARD_PITCH_LENGTH_METERS;
  const vRadius = radiusMeters / 68;
  for (let step = 0; step <= segments; step++) {
    const angle = startAngle + (endAngle - startAngle) * (step / segments);
    const point = projectPitchPoint(
      rig,
      centerU + Math.cos(angle) * uRadius,
      centerV + Math.sin(angle) * vRadius,
      W,
      H,
    );
    if (step === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  }
}
// The per-frame bridge between the simulation and the broadcast camera.
//
// Everything upstream — physics, sequences, set pieces — still works in the
// flat drawing space the cached pitch bitmap used to be baked in, and nothing
// there knows a camera exists. This module is the single place those
// coordinates become screen positions, which is what makes a change of lens a
// change of numbers here and nowhere else.

import { clamp } from './math';
import {
  createPitchGeometry,
  LOGICAL_PITCH_HEIGHT,
  LOGICAL_PITCH_WIDTH,
  PITCH_PADDING,
  STANDARD_PITCH_LENGTH_METERS,
  type PitchOrientation,
} from './geometry';
import {
  projectPitchPoint,
  rigDepthScale,
  rigUnitsPerMeter,
  type CameraRig,
  type CameraRigId,
  type ProjectedPoint,
} from './projection';

/** Everything outside the grass: the dark the stadium is lit out of. */
export const BROADCAST_SURROUND_COLOR = '#070d0a';

const DRAWING_GEOMETRY = createPitchGeometry(
  LOGICAL_PITCH_WIDTH,
  LOGICAL_PITCH_HEIGHT,
  PITCH_PADDING,
);

/** Drawing-space pixels per metre before any projection is applied. */
export const BASE_UNITS_PER_METER =
  DRAWING_GEOMETRY.fieldWidth / STANDARD_PITCH_LENGTH_METERS;

/**
 * How far each camera drifts toward the ball, as a fraction of the gap
 * between its resting centre and the ball.
 *
 * A real operator tracks the ball; they do not pin it to the middle of frame.
 * A camera that centres it exactly stops reading as a camera at all, so these
 * numbers are the whole difference between following the play and bolting a
 * viewport to a dot.
 */
export const RIG_FOLLOW: Record<CameraRigId, number> = {
  tactical: 0.16,
  sideline: 0.24,
  box: 0.45,
};

/** Per-frame easing toward that target. Low enough to read as a pan. */
export const RIG_SETTLE: Record<CameraRigId, number> = {
  tactical: 0.03,
  sideline: 0.045,
  box: 0.06,
};

/** Where a rig wants to sit this frame, given where the ball is. */
export function rigFollowCenterX(rig: CameraRig, ballLengthFraction: number): number {
  const gap = clamp(ballLengthFraction - rig.centerX, -0.5, 0.5);
  return rig.centerX + gap * RIG_FOLLOW[rig.id];
}

export interface BroadcastView {
  rig: CameraRig;
  width: number;
  height: number;
  /** Drawing-space pixels per metre at the near touchline. */
  unitsPerMeter: number;
  /**
   * Drawing-space unit vector that points up on screen.
   *
   * Portrait framing turns the whole drawing space a quarter turn, so
   * screen-up stops being drawing -y there. Anything that has to stand up off
   * the ground — a goal frame, a corner flag, a footballer — reads its height
   * through this rather than assuming a vertical axis.
   */
  up: { x: number; y: number };
  /** Drawing-space unit vector that points right on screen. */
  right: { x: number; y: number };
  /** Raise a projected ground point by a height in metres. */
  liftPoint(point: ProjectedPoint, meters: number): ProjectedPoint;
  /** Project a normalized pitch point: u along the length, v across the width. */
  at(lengthFraction: number, widthFraction: number): ProjectedPoint;
  /** Project a point that is still in flat drawing coordinates. */
  fromDrawing(x: number, y: number): ProjectedPoint;
  /** Screen pixels per metre at a given depth. */
  metersAt(widthFraction: number): number;
  /** Convert a flat-drawing vertical lift into projected pixels. */
  liftPixels(arcLift: number, depthScale: number): number;
}

export function createBroadcastView(
  rig: CameraRig,
  width: number,
  height: number,
  orientation: PitchOrientation = 'landscape',
): BroadcastView {
  const unitsPerMeter = rigUnitsPerMeter(rig, width);
  // The portrait transform is translate(0, canvasHeight) then rotate(-90deg),
  // which maps drawing (x, y) to screen (y, canvasHeight - x): drawing +x is
  // screen-up and drawing +y is screen-right.
  const up = orientation === 'portrait' ? { x: 1, y: 0 } : { x: 0, y: -1 };
  const right = orientation === 'portrait' ? { x: 0, y: 1 } : { x: 1, y: 0 };
  return {
    rig,
    width,
    height,
    unitsPerMeter,
    up,
    right,
    liftPoint(point, meters) {
      const rise = meters * unitsPerMeter * point.scale;
      return { x: point.x + up.x * rise, y: point.y + up.y * rise, scale: point.scale };
    },
    at(lengthFraction, widthFraction) {
      return projectPitchPoint(rig, lengthFraction, widthFraction, width, height);
    },
    fromDrawing(x, y) {
      return projectPitchPoint(
        rig,
        (x - PITCH_PADDING) / DRAWING_GEOMETRY.fieldWidth,
        (y - PITCH_PADDING) / DRAWING_GEOMETRY.fieldHeight,
        width,
        height,
      );
    },
    metersAt(widthFraction) {
      return unitsPerMeter * rigDepthScale(rig, widthFraction);
    },
    liftPixels(arcLift, depthScale) {
      return (arcLift * unitsPerMeter * depthScale) / BASE_UNITS_PER_METER;
    },
  };
}

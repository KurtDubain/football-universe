export const LOGICAL_PITCH_WIDTH = 520;
export const LOGICAL_PITCH_HEIGHT = 344;
export const PITCH_PADDING = 10;

/** Drawn player body radius in logical units. Kept in step with `drawPlayer`. */
export const PLAYER_BODY_RADIUS = 5.7;

export const STANDARD_PITCH_LENGTH_METERS = 105;
export const STANDARD_PITCH_WIDTH_METERS = 68;
/** Penalty area depth. Shared with the camera, which frames the goal off it. */
export const PENALTY_AREA_DEPTH_METERS = 16.5;
export const NORMALIZED_PITCH_SCREEN_ASPECT = STANDARD_PITCH_WIDTH_METERS / STANDARD_PITCH_LENGTH_METERS;

/**
 * Which way the pitch is presented on screen.
 *
 * Drawing space is always the landscape 520 x 344 logical pitch — every
 * formation slot, pass arc, camera framing and physics constant is expressed
 * in it and never changes. `portrait` only rotates that space a quarter turn
 * when it is blitted, so a phone held upright can show the full 105 x 68 m
 * pitch across its width instead of squeezing it into a 225 px letterbox.
 */
export type PitchOrientation = 'landscape' | 'portrait';

/** Canvas-space logical dimensions. Drawing space stays 520 x 344 either way. */
export function canvasLogicalSize(orientation: PitchOrientation): { width: number; height: number } {
  return orientation === 'portrait'
    ? { width: LOGICAL_PITCH_HEIGHT, height: LOGICAL_PITCH_WIDTH }
    : { width: LOGICAL_PITCH_WIDTH, height: LOGICAL_PITCH_HEIGHT };
}

/** CSS `aspect-ratio` value for the canvas element. */
export function canvasAspectRatio(orientation: PitchOrientation): number {
  const { width, height } = canvasLogicalSize(orientation);
  return width / height;
}

/**
 * Minimum normalized x-distance two players must keep so their drawn bodies
 * do not overlap.
 *
 * This used to be a fixed 0.022 — exactly one body diameter at the default
 * visual scale, and therefore only correct while the canvas is the full
 * 520-unit logical pitch. Any narrower canvas drew the markers wider than the
 * gap meant to separate them: sampled over 60 frames on a 390 px phone, 40%
 * had two bodies overlapping and the jersey numbers stacked illegibly.
 * Deriving the bound from the drawn size holds the guarantee at every canvas
 * width and every quality tier's visual scale.
 */
export function playerSeparationDistance(visualScale = 1): number {
  return PLAYER_BODY_RADIUS * 2 * visualScale * 1.18 / LOGICAL_PITCH_WIDTH;
}

export interface PitchGeometry {
  canvasWidth: number;
  canvasHeight: number;
  padding: number;
  fieldWidth: number;
  fieldHeight: number;
  centerX: number;
  centerY: number;
  xScale: number;
  yScale: number;
  centerCircleRadiusX: number;
  centerCircleRadiusY: number;
  penaltyAreaDepth: number;
  penaltyAreaSpan: number;
  goalAreaDepth: number;
  goalAreaSpan: number;
  goalMouthSpan: number;
  goalDepth: number;
  penaltySpotOffset: number;
  penaltyArcRadiusX: number;
  penaltyArcRadiusY: number;
  cornerRadiusX: number;
  cornerRadiusY: number;
}

export function createPitchGeometry(
  canvasWidth = LOGICAL_PITCH_WIDTH,
  canvasHeight = LOGICAL_PITCH_HEIGHT,
  padding = PITCH_PADDING,
): PitchGeometry {
  const fieldWidth = canvasWidth - padding * 2;
  const fieldHeight = canvasHeight - padding * 2;
  const xScale = fieldWidth / STANDARD_PITCH_LENGTH_METERS;
  const yScale = fieldHeight / STANDARD_PITCH_WIDTH_METERS;

  return {
    canvasWidth,
    canvasHeight,
    padding,
    fieldWidth,
    fieldHeight,
    centerX: canvasWidth / 2,
    centerY: canvasHeight / 2,
    xScale,
    yScale,
    centerCircleRadiusX: 9.15 * xScale,
    centerCircleRadiusY: 9.15 * yScale,
    penaltyAreaDepth: PENALTY_AREA_DEPTH_METERS * xScale,
    penaltyAreaSpan: 40.32 * yScale,
    goalAreaDepth: 5.5 * xScale,
    goalAreaSpan: 18.32 * yScale,
    goalMouthSpan: 7.32 * yScale,
    goalDepth: Math.min(padding - 2, 2.4 * xScale),
    penaltySpotOffset: 11 * xScale,
    penaltyArcRadiusX: 9.15 * xScale,
    penaltyArcRadiusY: 9.15 * yScale,
    cornerRadiusX: xScale,
    cornerRadiusY: yScale,
  };
}

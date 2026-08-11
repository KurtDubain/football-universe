export const LOGICAL_PITCH_WIDTH = 520;
export const LOGICAL_PITCH_HEIGHT = 344;
export const PITCH_PADDING = 10;

export const STANDARD_PITCH_LENGTH_METERS = 105;
export const STANDARD_PITCH_WIDTH_METERS = 68;
export const NORMALIZED_PITCH_SCREEN_ASPECT = STANDARD_PITCH_WIDTH_METERS / STANDARD_PITCH_LENGTH_METERS;

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
    penaltyAreaDepth: 16.5 * xScale,
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

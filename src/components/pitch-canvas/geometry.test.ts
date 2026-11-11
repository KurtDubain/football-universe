import { describe, expect, it } from 'vitest';
import {
  canvasAspectRatio,
  canvasLogicalSize,
  createPitchGeometry,
  LOGICAL_PITCH_HEIGHT,
  LOGICAL_PITCH_WIDTH,
  NORMALIZED_PITCH_SCREEN_ASPECT,
  PITCH_PADDING,
  PLAYER_BODY_RADIUS,
  playerSeparationDistance,
} from './geometry';

describe('pitch geometry', () => {
  it('uses standard football proportions for the visible field', () => {
    const pitch = createPitchGeometry();

    expect(pitch.fieldWidth / pitch.fieldHeight).toBeCloseTo(105 / 68, 2);
    expect(pitch.canvasWidth).toBe(LOGICAL_PITCH_WIDTH);
    expect(pitch.canvasHeight).toBe(LOGICAL_PITCH_HEIGHT);
    expect(pitch.padding).toBe(PITCH_PADDING);
    expect(NORMALIZED_PITCH_SCREEN_ASPECT).toBeCloseTo(68 / 105, 5);
  });

  it('derives every marking from metric dimensions', () => {
    const pitch = createPitchGeometry();

    expect(pitch.penaltyAreaDepth / pitch.xScale).toBeCloseTo(16.5);
    expect(pitch.penaltyAreaSpan / pitch.yScale).toBeCloseTo(40.32);
    expect(pitch.goalAreaDepth / pitch.xScale).toBeCloseTo(5.5);
    expect(pitch.goalMouthSpan / pitch.yScale).toBeCloseTo(7.32);
    expect(pitch.penaltySpotOffset / pitch.xScale).toBeCloseTo(11);
  });

  it('derives the minimum player separation from the drawn body size', () => {
    // A fixed constant only holds when the canvas equals the 520-unit pitch.
    // Sampled over 60 frames on a 390 px phone, the old 0.022 bound left two
    // drawn bodies overlapping in 40% of frames with the numbers stacked.
    expect(playerSeparationDistance(1)).toBeCloseTo(
      PLAYER_BODY_RADIUS * 2 * 1.18 / LOGICAL_PITCH_WIDTH,
      6,
    );
    expect(playerSeparationDistance(1)).toBeGreaterThan(0.022);
    expect(playerSeparationDistance(1.16)).toBeGreaterThan(playerSeparationDistance(1));
  });

  it('swaps the canvas axes for portrait while the drawing space stays landscape', () => {
    expect(canvasLogicalSize('landscape')).toEqual({
      width: LOGICAL_PITCH_WIDTH,
      height: LOGICAL_PITCH_HEIGHT,
    });
    expect(canvasLogicalSize('portrait')).toEqual({
      width: LOGICAL_PITCH_HEIGHT,
      height: LOGICAL_PITCH_WIDTH,
    });
    expect(canvasAspectRatio('portrait')).toBeCloseTo(1 / canvasAspectRatio('landscape'), 6);
  });
});

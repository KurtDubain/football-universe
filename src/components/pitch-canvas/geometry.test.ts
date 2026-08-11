import { describe, expect, it } from 'vitest';
import {
  createPitchGeometry,
  LOGICAL_PITCH_HEIGHT,
  LOGICAL_PITCH_WIDTH,
  NORMALIZED_PITCH_SCREEN_ASPECT,
  PITCH_PADDING,
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
});

import { describe, expect, it } from 'vitest';
import {
  BOX_CAMERA_REACH,
  BOX_CAMERA_RELEASE_REACH,
  CAMERA_RIGS,
  boxCameraEngaged,
  pitchCorners,
  projectPitchPoint,
  rigDepthScale,
  rigForMoment,
  rigUnitsPerMeter,
  type CameraRig,
} from './projection';

const W = 520;
const H = 344;
const RIGS = Object.values(CAMERA_RIGS);

describe('broadcast camera projection', () => {
  it('lands each touchline exactly on its declared screen row', () => {
    for (const rig of RIGS) {
      const near = projectPitchPoint(rig, 0.5, 1, W, H);
      const far = projectPitchPoint(rig, 0.5, 0, W, H);
      expect(near.y).toBeCloseTo(rig.nearEdgeY * H, 6);
      expect(far.y).toBeCloseTo(rig.farEdgeY * H, 6);
    }
  });

  it('foreshortens the far touchline by exactly the declared ratio', () => {
    for (const rig of RIGS) {
      const nearSpan = Math.abs(
        projectPitchPoint(rig, 1, 1, W, H).x - projectPitchPoint(rig, 0, 1, W, H).x,
      );
      const farSpan = Math.abs(
        projectPitchPoint(rig, 1, 0, W, H).x - projectPitchPoint(rig, 0, 0, W, H).x,
      );
      expect(nearSpan).toBeCloseTo(rig.nearSpan * W, 6);
      expect(farSpan / nearSpan).toBeCloseTo(rig.depthRatio, 6);
    }
  });

  it('reports a scale that matches the span it actually drew', () => {
    for (const rig of RIGS) {
      for (const v of [0, 0.25, 0.5, 0.75, 1]) {
        expect(projectPitchPoint(rig, 0.5, v, W, H).scale).toBeCloseTo(rigDepthScale(rig, v), 9);
      }
      expect(rigDepthScale(rig, 1)).toBeCloseTo(1, 9);
      expect(rigDepthScale(rig, 0)).toBeCloseTo(rig.depthRatio, 9);
    }
  });

  it('keeps depth monotonic and the pitch a convex trapezoid', () => {
    for (const rig of RIGS) {
      let previousY = -Infinity;
      let previousScale = -Infinity;
      for (let step = 0; step <= 10; step++) {
        const v = step / 10;
        const point = projectPitchPoint(rig, 0.5, v, W, H);
        expect(point.y).toBeGreaterThan(previousY);
        expect(point.scale).toBeGreaterThan(previousScale);
        previousY = point.y;
        previousScale = point.scale;
      }
      const [nearLeft, nearRight, farRight, farLeft] = pitchCorners(rig, W, H);
      expect(nearLeft.y).toBeCloseTo(nearRight.y, 9);
      expect(farLeft.y).toBeCloseTo(farRight.y, 9);
      expect(nearLeft.x).toBeLessThan(nearRight.x);
      expect(farLeft.x).toBeLessThan(farRight.x);
      expect(farRight.x - farLeft.x).toBeLessThan(nearRight.x - nearLeft.x);
    }
  });

  it('centres the frame on the requested slice of the pitch', () => {
    const rig: CameraRig = { ...CAMERA_RIGS.sideline, centerX: 0.79 };
    expect(projectPitchPoint(rig, 0.79, 1, W, H).x).toBeCloseTo(W / 2, 6);
    expect(projectPitchPoint(rig, 0.5, 1, W, H).x).toBeLessThan(W / 2);
  });

  it('sizes a drawn footballer against the pitch it stands on', () => {
    const rig = CAMERA_RIGS.sideline;
    const perMeter = rigUnitsPerMeter(rig, W);
    // 105 m of touchline spans nearSpan * W, so a metre is that over 105.
    expect(perMeter).toBeCloseTo(rig.nearSpan * W / 105, 9);
    // A 1.82 m player is therefore a bit taller than the old 11.4-unit
    // top-down marker was wide, which is the point: it reads as a person.
    expect(1.82 * perMeter).toBeGreaterThan(11);
  });

  it('cuts to the box camera only for the moments that deserve it', () => {
    expect(rigForMoment('wide', true, 0.9).id).toBe('tactical');
    expect(rigForMoment('build', true, 0.5).id).toBe('sideline');
    expect(rigForMoment('attack', true, 0.8).id).toBe('sideline');
    expect(rigForMoment('set_piece', true, 0.95).id).toBe('box');
    expect(rigForMoment('finish', true, 0.9).id).toBe('box');
    expect(rigForMoment('outcome', true, 0.88).id).toBe('box');
  });

  it('releases the tight camera later than it engages it', () => {
    // A single hard threshold on a value that jitters flipped the lens every
    // frame. Measured on a real broadcast that was a burst of a dozen cuts
    // inside half a second around every shot.
    const between = 1 - (BOX_CAMERA_REACH + BOX_CAMERA_RELEASE_REACH) / 2;
    expect(BOX_CAMERA_RELEASE_REACH).toBeGreaterThan(BOX_CAMERA_REACH);
    expect(boxCameraEngaged(true, between, false)).toBe(false);
    expect(boxCameraEngaged(true, between, true)).toBe(true);
    // And a ball jittering across the boundary cannot flip it once engaged.
    for (const offset of [-0.02, -0.01, 0, 0.01, 0.02]) {
      expect(boxCameraEngaged(true, between + offset, true)).toBe(true);
    }
    // Still released once it genuinely leaves the area.
    expect(boxCameraEngaged(true, 1 - BOX_CAMERA_RELEASE_REACH - 0.02, true)).toBe(false);
    // Same from the other end.
    expect(boxCameraEngaged(false, 1 - between, true)).toBe(true);
  });

  it('refuses the tight camera when the ball is nowhere near the goal', () => {
    // A thirty-metre shot and the second of outcome framing that follows it
    // are not penalty-area scenes. Keying only on the moment put a 2.45x lens
    // on the centre circle with the goal it framed off the side of the picture.
    for (const moment of ['set_piece', 'finish', 'outcome'] as const) {
      expect(rigForMoment(moment, true, 0.5).id).toBe('sideline');
      expect(rigForMoment(moment, false, 0.5).id).toBe('sideline');
      expect(rigForMoment(moment, true, 0.3).id).toBe('sideline');
    }
    // Just inside the reach, from either end.
    expect(rigForMoment('finish', true, 1 - BOX_CAMERA_REACH).id).toBe('box');
    expect(rigForMoment('finish', false, BOX_CAMERA_REACH).id).toBe('box');
  });

  it('points the box camera at the goal being attacked', () => {
    const right = rigForMoment('finish', true, 0.92);
    const left = rigForMoment('finish', false, 0.08);
    expect(right.centerX).toBeGreaterThan(0.5);
    expect(left.centerX).toBeLessThan(0.5);
    expect(projectPitchPoint(right, 1, 0.5, W, H).x).toBeGreaterThan(W / 2);
    expect(projectPitchPoint(left, 0, 0.5, W, H).x).toBeLessThan(W / 2);
  });

  it('keeps the attacked goal inside the frame on the tight camera', () => {
    for (const attackingRight of [true, false]) {
      const rig = rigForMoment('finish', attackingRight, attackingRight ? 0.9 : 0.1);
      const goal = projectPitchPoint(rig, attackingRight ? 1 : 0, 0.5, W, H);
      expect(goal.x).toBeGreaterThan(0);
      expect(goal.x).toBeLessThan(W);
    }
  });
});

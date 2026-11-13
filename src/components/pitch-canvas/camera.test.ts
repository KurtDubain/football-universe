import { describe, expect, it } from 'vitest';
import {
  CAMERA_FRAME_BLEED,
  CAMERA_FRAME_MARGIN,
  MAX_BROADCAST_ZOOM,
  MAX_COMPACT_BROADCAST_ZOOM,
  broadcastCameraPan,
  broadcastCameraTarget,
  type BroadcastCameraMoment,
} from './camera';
import { createPitchGeometry } from './geometry';
import { cameraPointToScreen } from './renderer';

const pitch = createPitchGeometry();
const common = {
  playbackMode: 'live' as const,
  reducedMotion: false,
  ballX: 480,
  ballY: 120,
  canvasWidth: pitch.canvasWidth,
  canvasHeight: pitch.canvasHeight,
  padding: pitch.padding,
  fieldWidth: pitch.fieldWidth,
  fieldHeight: pitch.fieldHeight,
  goalDepth: pitch.goalDepth,
};

const goalLineLeft = pitch.padding;
const goalLineRight = pitch.padding + pitch.fieldWidth;
const goalBackOf = (x: number) =>
  x >= pitch.canvasWidth / 2 ? goalLineRight + pitch.goalDepth : goalLineLeft - pitch.goalDepth;

/** Solve the full camera for a ball position and project world points through it. */
function solve(
  ballX: number,
  ballY: number,
  moment: BroadcastCameraMoment,
  quality: 'full' | 'constrained' = 'full',
) {
  const target = broadcastCameraTarget({ ...common, ballX, ballY, moment, quality });
  const { panX, panY } = broadcastCameraPan(
    target.focusX,
    target.focusY,
    target.zoom,
    pitch.canvasWidth,
    pitch.canvasHeight,
    target.frame,
  );
  const screen = (x: number, y: number) => ({
    x: project(x, panX, target.zoom, pitch.canvasWidth),
    y: project(y, panY, target.zoom, pitch.canvasHeight),
  });
  return { target, panX, panY, screen };
}

/** Screen position of a world point under the camera transform. */
function project(
  value: number,
  pan: number,
  zoom: number,
  size: number,
): number {
  return (value - size / 2) * zoom + size / 2 + pan;
}

/** The pan formula this module replaced, kept to prove the wide shots match. */
function legacyPan(focus: number, size: number, gain: number, zoom: number): number {
  const overscan = Math.max(0, (zoom - 1) * size / 2 - 1);
  return Math.min(Math.max((size / 2 - focus) * gain, -overscan), overscan);
}

describe('broadcast camera director', () => {
  it('uses stable, increasingly close scene states', () => {
    const wide = broadcastCameraTarget({ ...common, quality: 'full', moment: 'wide' });
    const attack = broadcastCameraTarget({ ...common, quality: 'full', moment: 'attack' });
    const finish = broadcastCameraTarget({ ...common, quality: 'full', moment: 'finish' });

    expect(wide.zoom).toBeLessThan(attack.zoom);
    expect(attack.zoom).toBeLessThan(finish.zoom);
    expect(finish.zoom).toBeLessThanOrEqual(MAX_BROADCAST_ZOOM);
    expect(finish.focusX).toBeGreaterThan(attack.focusX);
  });

  it('pushes in far enough at a goal to read as a different shot', () => {
    const wide = broadcastCameraTarget({ ...common, quality: 'full', moment: 'wide' });
    const outcome = broadcastCameraTarget({ ...common, quality: 'full', moment: 'outcome' });

    // The table this replaced ran 1.004 → 1.115. Measured on a real goal frame
    // that was indistinguishable from the resting shot, which is the whole
    // reason the physics layer never became visible.
    expect(outcome.zoom / wide.zoom).toBeGreaterThan(1.5);
  });

  it('keeps a useful but restrained camera on compact screens', () => {
    const finish = broadcastCameraTarget({ ...common, quality: 'constrained', moment: 'finish' });
    const immersive = broadcastCameraTarget({
      ...common,
      quality: 'constrained',
      playbackMode: 'immersive',
      moment: 'outcome',
    });

    expect(finish.zoom).toBeGreaterThan(1);
    expect(finish.zoom).toBeLessThanOrEqual(MAX_COMPACT_BROADCAST_ZOOM);
    expect(immersive.zoom).toBeGreaterThan(finish.zoom);
    expect(immersive.zoom).toBeLessThanOrEqual(MAX_COMPACT_BROADCAST_ZOOM);
  });

  it('still separates immersive from live once the framing is wide', () => {
    // The lift used to be a flat +0.008, sized for a 1.12 ceiling. Against a
    // 1.7x framing that is under half a percent and would have silently made
    // the two modes identical at the moments that matter.
    const live = broadcastCameraTarget({ ...common, quality: 'full', moment: 'outcome' });
    const immersive = broadcastCameraTarget({
      ...common,
      quality: 'full',
      playbackMode: 'immersive',
      moment: 'outcome',
    });

    expect(immersive.zoom).toBeGreaterThan(live.zoom);
    expect(immersive.zoom).toBeLessThanOrEqual(MAX_BROADCAST_ZOOM);
  });

  it('disables movement for reduced-motion users', () => {
    expect(broadcastCameraTarget({
      ...common,
      quality: 'full',
      reducedMotion: true,
      moment: 'outcome',
    })).toEqual({
      focusX: pitch.canvasWidth / 2,
      focusY: pitch.canvasHeight / 2,
      zoom: 1,
      settle: 1,
      frame: {
        minX: common.ballX,
        maxX: goalLineRight + pitch.goalDepth,
        minY: common.ballY,
        maxY: common.ballY,
      },
    });
  });

  it('keeps event labels aligned after zoom, pan, and impact offset', () => {
    expect(cameraPointToScreen(100, 80, 520, 344, {
      zoom: 1.1,
      panX: 8,
      panY: -4,
      offX: 2,
      offY: 1,
    })).toEqual({ x: 94, y: 67.8 });
  });
});

describe('broadcast camera pan', () => {
  it('leaves wide framings exactly as the old drift formula left them', () => {
    // Below roughly 1.2x the overscan clamp already bound before the drift
    // factor mattered, so the visibility floor must be inert there.
    for (const zoom of [1, 1.004, 1.018, 1.048, 1.12]) {
      for (let step = 0; step <= 10; step++) {
        const focusX = pitch.padding + pitch.fieldWidth * (step / 10);
        const focusY = pitch.padding + pitch.fieldHeight * (step / 10);
        const { panX, panY } = broadcastCameraPan(
          focusX,
          focusY,
          zoom,
          pitch.canvasWidth,
          pitch.canvasHeight,
        );
        expect(panX).toBeCloseTo(legacyPan(focusX, pitch.canvasWidth, 0.22, zoom), 9);
        expect(panY).toBeCloseTo(legacyPan(focusY, pitch.canvasHeight, 0.18, zoom), 9);
      }
    }
  });

  it('keeps the focus point inside the frame at the tightest framing', () => {
    // Without the floor, the 0.22 drift leaves the ball off screen at 1.8x —
    // during the one moment the camera exists to show it.
    const minX = pitch.padding + pitch.fieldWidth * 0.1;
    const maxX = pitch.padding + pitch.fieldWidth * 0.9;
    const minY = pitch.padding + pitch.fieldHeight * 0.1;
    const maxY = pitch.padding + pitch.fieldHeight * 0.9;

    for (let step = 0; step <= 20; step++) {
      const ratio = step / 20;
      const focusX = minX + (maxX - minX) * ratio;
      const focusY = minY + (maxY - minY) * ratio;
      const { panX, panY } = broadcastCameraPan(
        focusX,
        focusY,
        MAX_BROADCAST_ZOOM,
        pitch.canvasWidth,
        pitch.canvasHeight,
      );
      const screenX = project(focusX, panX, MAX_BROADCAST_ZOOM, pitch.canvasWidth);
      const screenY = project(focusY, panY, MAX_BROADCAST_ZOOM, pitch.canvasHeight);

      expect(screenX).toBeGreaterThanOrEqual(-1e-6);
      expect(screenX).toBeLessThanOrEqual(pitch.canvasWidth + 1e-6);
      expect(screenY).toBeGreaterThanOrEqual(-1e-6);
      expect(screenY).toBeLessThanOrEqual(pitch.canvasHeight + 1e-6);
    }
  });

  it('never pans far enough to reveal past the drawn pitch', () => {
    for (const zoom of [1.12, 1.36, 1.62, MAX_BROADCAST_ZOOM]) {
      const overscanX = Math.max(0, (zoom - 1) * pitch.canvasWidth / 2 - 1);
      const overscanY = Math.max(0, (zoom - 1) * pitch.canvasHeight / 2 - 1);
      for (let step = 0; step <= 10; step++) {
        const focusX = pitch.padding + pitch.fieldWidth * (step / 10);
        const focusY = pitch.padding + pitch.fieldHeight * (step / 10);
        const { panX, panY } = broadcastCameraPan(
          focusX,
          focusY,
          zoom,
          pitch.canvasWidth,
          pitch.canvasHeight,
        );
        expect(Math.abs(panX)).toBeLessThanOrEqual(overscanX + 1e-9);
        expect(Math.abs(panY)).toBeLessThanOrEqual(overscanY + 1e-9);
      }
    }
  });

  it('still drifts rather than locking on at the tightest framing', () => {
    // The floor is a boundary, not a new behaviour: a focus point near the
    // middle of the pitch is still followed loosely, not centred.
    const focusX = pitch.canvasWidth / 2 - 60;
    const { panX } = broadcastCameraPan(
      focusX,
      pitch.canvasHeight / 2,
      MAX_BROADCAST_ZOOM,
      pitch.canvasWidth,
      pitch.canvasHeight,
    );
    expect(panX).toBeCloseTo(60 * 0.22, 9);
  });
});

describe('broadcast camera subject framing', () => {
  const PUSHED_IN: BroadcastCameraMoment[] = ['attack', 'set_piece', 'finish', 'outcome'];

  it('keeps the ball on screen at every framing that has pushed in', () => {
    // The bug this replaces: the pan floor protected the focus point, which is
    // by construction between the centre and the ball and therefore never the
    // subject. At 1.62/1.72 with the ball on the goal line the focus rode the
    // right edge of frame while the ball sat 109-132px outside it — the camera
    // pointed at empty grass during the only moments it exists to show.
    const xs = [goalLineLeft, pitch.padding + pitch.fieldWidth * 0.5, goalLineRight];
    const ys = [pitch.padding, pitch.centerY, pitch.padding + pitch.fieldHeight];
    for (const ballX of xs) {
      for (const ballY of ys) {
        for (const moment of PUSHED_IN) {
          for (const quality of ['full', 'constrained'] as const) {
            const { screen } = solve(ballX, ballY, moment, quality);
            const ball = screen(ballX, ballY);
            expect(ball.x).toBeGreaterThanOrEqual(-1e-6);
            expect(ball.x).toBeLessThanOrEqual(pitch.canvasWidth + 1e-6);
            expect(ball.y).toBeGreaterThanOrEqual(-1e-6);
            expect(ball.y).toBeLessThanOrEqual(pitch.canvasHeight + 1e-6);
          }
        }
      }
    }
  });

  it('keeps the whole goal on screen once the ball is inside the box', () => {
    for (const ballX of [goalLineLeft, goalLineRight]) {
      for (const moment of PUSHED_IN) {
        const { screen } = solve(ballX, pitch.centerY, moment);
        const back = screen(goalBackOf(ballX), pitch.centerY);
        expect(back.x).toBeGreaterThanOrEqual(-1e-6);
        expect(back.x).toBeLessThanOrEqual(pitch.canvasWidth + 1e-6);
        // And with the agreed breathing room rather than flush against the edge.
        expect(back.x).toBeGreaterThanOrEqual(CAMERA_FRAME_MARGIN - 1e-6);
        expect(back.x).toBeLessThanOrEqual(pitch.canvasWidth - CAMERA_FRAME_MARGIN + 1e-6);
      }
    }
  });

  it('does not widen the frame to a goal the ball is nowhere near', () => {
    const { target } = solve(pitch.centerX, pitch.centerY, 'outcome');
    expect(target.frame).toEqual({
      minX: pitch.centerX,
      maxX: pitch.centerX,
      minY: pitch.centerY,
      maxY: pitch.centerY,
    });
  });

  it('leaves the resting wide shot exactly where it was', () => {
    // Below the push-in threshold the viewport already covers the pitch, so
    // enforcing the margin would only drag the resting shot off centre.
    for (const moment of ['wide', 'build'] as const) {
      for (const ballX of [goalLineLeft, pitch.centerX, goalLineRight]) {
        const target = broadcastCameraTarget({ ...common, ballX, moment, quality: 'full' });
        const framed = broadcastCameraPan(
          target.focusX, target.focusY, target.zoom,
          pitch.canvasWidth, pitch.canvasHeight, target.frame,
        );
        const bare = broadcastCameraPan(
          target.focusX, target.focusY, target.zoom, pitch.canvasWidth, pitch.canvasHeight,
        );
        expect(framed).toEqual(bare);
      }
    }
  });

  it('never reveals more than the bleed past the drawn pitch', () => {
    for (const ballX of [goalLineLeft, pitch.centerX, goalLineRight]) {
      for (const ballY of [pitch.padding, pitch.centerY]) {
        for (const moment of PUSHED_IN) {
          const { target, panX, panY } = solve(ballX, ballY, moment);
          const overscanX = Math.max(0, (target.zoom - 1) * pitch.canvasWidth / 2 - 1);
          const overscanY = Math.max(0, (target.zoom - 1) * pitch.canvasHeight / 2 - 1);
          expect(Math.abs(panX)).toBeLessThanOrEqual(overscanX + CAMERA_FRAME_BLEED + 1e-9);
          expect(Math.abs(panY)).toBeLessThanOrEqual(overscanY + CAMERA_FRAME_BLEED + 1e-9);
        }
      }
    }
  });
});

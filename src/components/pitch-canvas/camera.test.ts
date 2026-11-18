import { describe, expect, it } from 'vitest';
import {
  broadcastCameraPan,
  MAX_BROADCAST_ZOOM,
} from './camera';
import { createPitchGeometry } from './geometry';
import { cameraPointToScreen } from './renderer';

const pitch = createPitchGeometry();

/** Screen position of a world point under the camera transform. */
function project(value: number, pan: number, zoom: number, size: number): number {
  return (value - size / 2) * zoom + size / 2 + pan;
}

/** The pan formula this module replaced, kept to prove the wide shots match. */
function legacyPan(focus: number, size: number, gain: number, zoom: number): number {
  const overscan = Math.max(0, (zoom - 1) * size / 2 - 1);
  return Math.min(Math.max((size / 2 - focus) * gain, -overscan), overscan);
}

describe('camera transform', () => {
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

  it('is inert for the parked camera the render loop actually uses', () => {
    // The render loop parks the legacy camera at the centre of the canvas at
    // 1x every frame, which is why the zoom director that used to live beside
    // this function never ran. That has to stay true: if this ever starts
    // moving the drawing space, the rig in projection.ts is being fought.
    const { panX, panY } = broadcastCameraPan(
      pitch.canvasWidth / 2,
      pitch.canvasHeight / 2,
      1,
      pitch.canvasWidth,
      pitch.canvasHeight,
    );
    expect(panX).toBe(0);
    expect(panY).toBe(0);
  });
});

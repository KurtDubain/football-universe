import { describe, expect, it } from 'vitest';
import {
  avoidFloatingObstacles,
  clampFloatingPosition,
  createFloatingPositionMemory,
  restoreFloatingPosition,
} from './floating-position';

describe('clampFloatingPosition', () => {
  const viewport = { left: 0, top: 0, width: 390, height: 844 };
  const control = { width: 112, height: 48 };

  it('keeps the control inside every viewport edge', () => {
    expect(clampFloatingPosition({ x: -50, y: -80 }, control, viewport)).toEqual({ x: 12, y: 12 });
    expect(clampFloatingPosition({ x: 500, y: 900 }, control, viewport)).toEqual({ x: 266, y: 784 });
  });

  it('accounts for visual viewport offsets such as mobile browser chrome', () => {
    expect(clampFloatingPosition(
      { x: 0, y: 0 },
      control,
      { left: 8, top: 44, width: 320, height: 500 },
    )).toEqual({ x: 20, y: 56 });
  });

  it('restores the same relative edge position after a viewport change', () => {
    const desktopViewport = { left: 0, top: 0, width: 1440, height: 900 };
    const desktopControl = { width: 96, height: 48 };
    const memory = createFloatingPositionMemory(
      { x: 1332, y: 432 },
      desktopControl,
      desktopViewport,
    );

    const restored = restoreFloatingPosition(memory, { width: 56, height: 56 }, viewport);
    expect(restored.x).toBe(322);
    expect(restored.y).toBeCloseTo(399.54, 1);
  });

  it('keeps exact coordinates when only browser chrome changes slightly', () => {
    const memory = createFloatingPositionMemory(
      { x: 12, y: 216 },
      { width: 56, height: 56 },
      { left: 0, top: 0, width: 320, height: 568 },
    );
    expect(restoreFloatingPosition(
      memory,
      { width: 56, height: 56 },
      { left: 0, top: 0, width: 320, height: 565.25 },
    )).toEqual({ x: 12, y: 216 });
  });

  it('clamps legacy absolute positions without edge metadata', () => {
    expect(restoreFloatingPosition(
      { x: 1400, y: 850 },
      { width: 56, height: 56 },
      viewport,
    )).toEqual({ x: 322, y: 776 });
  });
});

describe('avoidFloatingObstacles', () => {
  const viewport = { left: 200, top: 48, width: 1080, height: 672 };
  const control = { width: 96, height: 48 };

  it('moves the control above a visible bottom action region', () => {
    expect(avoidFloatingObstacles(
      { x: 1172, y: 656 },
      control,
      viewport,
      [{ left: 900, top: 620, right: 1280, bottom: 720 }],
    )).toEqual({ x: 1172, y: 560 });
  });

  it('keeps a dragged position unchanged when it is clear', () => {
    expect(avoidFloatingObstacles(
      { x: 212, y: 260 },
      control,
      viewport,
      [{ left: 900, top: 620, right: 1280, bottom: 720 }],
    )).toEqual({ x: 212, y: 260 });
  });

  it('avoids multiple action regions while staying inside the viewport', () => {
    const result = avoidFloatingObstacles(
      { x: 1172, y: 656 },
      control,
      viewport,
      [
        { left: 900, top: 620, right: 1280, bottom: 720 },
        { left: 1040, top: 540, right: 1280, bottom: 608 },
      ],
    );
    expect(result).toEqual({ x: 1172, y: 480 });
  });
});

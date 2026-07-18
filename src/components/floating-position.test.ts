import { describe, expect, it } from 'vitest';
import { clampFloatingPosition } from './floating-position';

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
});

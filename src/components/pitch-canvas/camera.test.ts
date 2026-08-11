import { describe, expect, it } from 'vitest';
import { broadcastCameraTarget } from './camera';
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
};

describe('broadcast camera director', () => {
  it('uses stable, increasingly close scene states', () => {
    const wide = broadcastCameraTarget({ ...common, quality: 'full', moment: 'wide' });
    const attack = broadcastCameraTarget({ ...common, quality: 'full', moment: 'attack' });
    const finish = broadcastCameraTarget({ ...common, quality: 'full', moment: 'finish' });

    expect(wide.zoom).toBeLessThan(attack.zoom);
    expect(attack.zoom).toBeLessThan(finish.zoom);
    expect(finish.zoom).toBeLessThanOrEqual(1.12);
    expect(finish.focusX).toBeGreaterThan(attack.focusX);
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
    expect(finish.zoom).toBeLessThanOrEqual(1.08);
    expect(immersive.zoom).toBeGreaterThan(finish.zoom);
    expect(immersive.zoom).toBeLessThanOrEqual(1.08);
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

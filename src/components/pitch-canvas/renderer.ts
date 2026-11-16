// Canvas drawing primitives for the pitch. Impure (touch ctx) but
// each function does ONE thing — pitch, players, ball, celebration etc.
//
// Magic timing constants (GOAL_CELEB_MAX_FRAMES, FLASH_MAX_FRAMES,
// CAMERA_SHAKE_MAX_FRAMES) live here because the renderer is what
// understands them; the orchestrator imports them when triggering effects.

import { clamp } from './math';
import type { ShotOutcome } from './event-scene';
import type { PitchOrientation } from './geometry';
import { MAX_BROADCAST_ZOOM, broadcastCameraPan, type BroadcastCameraFrame } from './camera';

/**
 * The dark ring `drawPitch` paints outside the touchlines.
 *
 * The canvas is filled with it before the camera transform so that a pan past
 * the edge of the cached pitch bitmap — which `CAMERA_FRAME_BLEED` now allows,
 * so the goal can sit inside the frame instead of outside it — reveals more of
 * the same colour rather than a transparent seam.
 */
export const PITCH_SURROUND_COLOR = '#091b11';

// Mutable {current: number} shape — matches React.MutableRefObject<number>
// without importing React, so this module stays UI-framework neutral.
type MutNum = { current: number };

export const GOAL_CELEB_MAX_FRAMES = 110;
export const FLASH_MAX_FRAMES = 8;
export const CAMERA_SHAKE_MAX_FRAMES = 18;
export const SHOT_OUTCOME_MAX_FRAMES = 72;

export interface BroadcastCameraState {
  focusX: number;
  focusY: number;
  zoom: number;
  /** World-space span the pan must keep on screen. See `broadcastCameraPan`. */
  frame?: BroadcastCameraFrame;
}

export interface BroadcastCameraTransform {
  offX: number;
  offY: number;
  panX: number;
  panY: number;
  zoom: number;
  /** Canvas-space dimensions, which differ from drawing space in portrait. */
  canvasWidth?: number;
  canvasHeight?: number;
  orientation?: PitchOrientation;
}

/**
 * Draw upright glyphs inside a rotated drawing space.
 *
 * The portrait transform turns the whole drawing space a quarter turn, which
 * would render every jersey number and label on its side. Rotating back about
 * the anchor for the duration of the text draw keeps them readable while the
 * surrounding shapes stay in drawing coordinates.
 */
export function withUpright(
  ctx: CanvasRenderingContext2D,
  anchorX: number,
  anchorY: number,
  orientation: PitchOrientation,
  draw: () => void,
): void {
  if (orientation !== 'portrait') {
    draw();
    return;
  }
  ctx.save();
  ctx.translate(anchorX, anchorY);
  ctx.rotate(Math.PI / 2);
  ctx.translate(-anchorX, -anchorY);
  draw();
  ctx.restore();
}

/**
 * Black overlay + "中场休息 / HALF TIME" centered text.
 */
export function drawHalftime(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  label = '中场休息',
  sublabel = 'HALF TIME',
  orientation: PitchOrientation = 'landscape',
): void {
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, W, H);
  withUpright(ctx, W / 2, H / 2, orientation, () => {
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(label, W / 2, H / 2 - 4);
    ctx.font = '11px sans-serif'; ctx.fillStyle = '#94a3b8';
    ctx.fillText(sublabel, W / 2, H / 2 + 14);
  });
}

/** Draw outcome copy in screen space so camera pan and zoom cannot clip it. */
export function drawShotOutcomeLabel(
  ctx: CanvasRenderingContext2D,
  remainingFrames: number,
  outcome: Exclude<ShotOutcome, 'goal'>,
  targetX: number,
  targetY: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const progress = 1 - remainingFrames / SHOT_OUTCOME_MAX_FRAMES;
  const alpha = Math.max(0, Math.min(1, (1 - progress) * 1.45));
  const label = outcome === 'save' ? '扑救' : outcome === 'block' ? '封堵' : '偏出';
  const color = outcome === 'save' ? '#bfdbfe' : outcome === 'block' ? '#fde68a' : '#e2e8f0';
  const border = outcome === 'save' ? '#60a5fa' : outcome === 'block' ? '#fbbf24' : '#94a3b8';

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = '700 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const width = ctx.measureText(label).width + 14;
  const height = 19;
  const x = clamp(targetX, width / 2 + 8, canvasWidth - width / 2 - 8);
  const y = clamp(targetY - 22 - progress * 5, height / 2 + 7, canvasHeight - height / 2 - 7);
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y - height / 2, width, height, 4);
  ctx.fillStyle = 'rgba(3,10,7,0.86)';
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(label, x, y + 0.4);
  ctx.restore();
}

/**
 * Compute the per-frame camera offset, decrement the shake ref, and apply
 * ctx.save() + translate + clearRect so subsequent drawing happens in
 * shaken coords. Caller MUST ctx.restore() at end of frame.
 */
export function applyCameraShake(
  ctx: CanvasRenderingContext2D,
  shakeRef: MutNum,
  shakeMaxRef: MutNum,
  W: number, H: number,
  camera: BroadcastCameraState = { focusX: W / 2, focusY: H / 2, zoom: 1 },
  orientation: PitchOrientation = 'landscape',
  canvasWidth = W,
  canvasHeight = H,
): BroadcastCameraTransform {
  let offX = 0, offY = 0;
  if (shakeRef.current > 0) {
    const t = 1 - shakeRef.current / shakeMaxRef.current;
    const decay = Math.exp(-t * 3); // exponential falloff
    const phase = (shakeMaxRef.current - shakeRef.current) * 0.85;
    offX = Math.sin(phase) * 0.9 * decay;
    offY = Math.cos(phase * 1.3) * 0.55 * decay;
    shakeRef.current--;
  }
  ctx.save();
  ctx.fillStyle = PITCH_SURROUND_COLOR;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  if (orientation === 'portrait') {
    // Quarter turn so the 520 x 344 drawing space fills a portrait canvas.
    // Everything downstream — pitch bitmap, players, ball, particles, camera —
    // keeps working in unrotated drawing coordinates. Only the handful of
    // elements that must read against the screen (text, shadows, ball lift)
    // compensate, via withUpright and the orientation-aware draws below.
    ctx.translate(0, canvasHeight);
    ctx.rotate(-Math.PI / 2);
  }
  const zoom = clamp(camera.zoom, 1, MAX_BROADCAST_ZOOM);
  const { panX, panY } = broadcastCameraPan(camera.focusX, camera.focusY, zoom, W, H, camera.frame);
  ctx.translate(W / 2 + panX + offX, H / 2 + panY + offY);
  ctx.scale(zoom, zoom);
  ctx.translate(-W / 2, -H / 2);
  return { offX, offY, panX, panY, zoom, canvasWidth, canvasHeight, orientation };
}

export function cameraPointToScreen(
  x: number,
  y: number,
  drawingWidth: number,
  drawingHeight: number,
  transform: BroadcastCameraTransform,
): { x: number; y: number } {
  const zoomedX = (x - drawingWidth / 2) * transform.zoom + drawingWidth / 2 + transform.panX + transform.offX;
  const zoomedY = (y - drawingHeight / 2) * transform.zoom + drawingHeight / 2 + transform.panY + transform.offY;
  if (transform.orientation === 'portrait') {
    return { x: zoomedY, y: (transform.canvasHeight ?? drawingWidth) - zoomedX };
  }
  return { x: zoomedX, y: zoomedY };
}

/**
 * White flash overlay (post-shake-restore). Decrements the flash ref.
 */
export function applyWhiteFlash(
  ctx: CanvasRenderingContext2D,
  flashRef: MutNum,
  W: number, H: number,
): void {
  if (flashRef.current > 0) {
    const fa = flashRef.current / FLASH_MAX_FRAMES;
    ctx.fillStyle = `rgba(255,255,255,${fa * 0.18})`;
    ctx.fillRect(0, 0, W, H);
    flashRef.current--;
  }
}

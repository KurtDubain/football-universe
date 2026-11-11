import type { PlaybackMode } from '../match-live/playback-mode';
import { clamp, lerp } from './math';
import type { RenderQuality } from './render-budget';

export type BroadcastCameraMoment = 'wide' | 'build' | 'attack' | 'set_piece' | 'finish' | 'outcome';

export interface BroadcastCameraTargetInput {
  moment: BroadcastCameraMoment;
  quality: RenderQuality;
  playbackMode: PlaybackMode;
  reducedMotion: boolean;
  ballX: number;
  ballY: number;
  canvasWidth: number;
  canvasHeight: number;
  padding: number;
  fieldWidth: number;
  fieldHeight: number;
}

export interface BroadcastCameraTarget {
  focusX: number;
  focusY: number;
  zoom: number;
  settle: number;
}

/**
 * Hard ceilings. renderer.ts clamps against MAX_BROADCAST_ZOOM as well, so a
 * stale camera state can never scale the pitch past it.
 *
 * The pitch itself is a cached bitmap at backing-store resolution, so anything
 * above 1 magnifies it. Players and the ball are drawn as vectors after the
 * transform and stay sharp, which reads as a soft ground under crisp subjects.
 * Pushing much past 1.8 would make that mismatch obvious; rendering the pitch
 * directly per frame instead of from the cache is the fix if it ever bothers.
 */
export const MAX_BROADCAST_ZOOM = 1.8;
export const MAX_COMPACT_BROADCAST_ZOOM = 1.56;

/**
 * Framing per moment.
 *
 * The old table ran 1.004 → 1.115, an 11.5% push from the widest shot to a
 * goal. Measured against a real goal frame, that was indistinguishable from
 * the resting shot: the physics layer already differentiates six attacking
 * patterns and cross arcs, and none of it was legible at that scale.
 *
 * Wide and build stay near 1 — a broadcast camera does not creep in while play
 * is circulation — and the push is concentrated where the ball is actually
 * being struck. Compact tops out lower because its canvas is smaller and its
 * markers are already drawn 12% larger.
 */
const DESKTOP_ZOOM: Record<BroadcastCameraMoment, number> = {
  wide: 1.004,
  build: 1.034,
  attack: 1.12,
  set_piece: 1.36,
  finish: 1.62,
  outcome: 1.72,
};

const COMPACT_ZOOM: Record<BroadcastCameraMoment, number> = {
  wide: 1,
  build: 1.022,
  attack: 1.08,
  set_piece: 1.22,
  finish: 1.42,
  outcome: 1.5,
};

const FOCUS_WEIGHT: Record<BroadcastCameraMoment, number> = {
  wide: 0.1,
  build: 0.24,
  attack: 0.48,
  set_piece: 0.68,
  finish: 0.82,
  outcome: 0.86,
};

/**
 * Per-frame easing toward the target.
 *
 * Raised for the tight moments because the zoom gaps they now have to cross
 * are far larger: at the old 0.032 a 1.12 → 1.62 push needed about 70 frames
 * to close 90% of the gap, which is longer than the shot it was framing. At
 * 0.075 it lands in roughly 30 frames.
 */
const SETTLE: Record<BroadcastCameraMoment, number> = {
  wide: 0.014,
  build: 0.018,
  attack: 0.032,
  set_piece: 0.05,
  finish: 0.075,
  outcome: 0.085,
};

/**
 * Loose-follow pan with a visibility floor.
 *
 * The 0.22 / 0.18 drift is the broadcast feel — the camera leans toward the
 * ball rather than locking onto it. That was safe while the viewport covered
 * nearly the whole pitch, because the overscan clamp bound first and the drift
 * factor barely mattered. At 1.7x the viewport is a third of the pitch, and
 * the same drift lets the focus point walk off screen: the ball would leave
 * frame during the one moment the camera exists to show it.
 *
 * So the drift is kept, then clamped into the pan range that keeps the focus
 * point inside the viewport. Below roughly 1.2x that range already contains
 * the drift and the result is byte-identical to the old formula; above it the
 * floor takes over and the focus rides the edge of frame instead of leaving.
 *
 * `overscan` is how far the scaled pitch may slide before its own edge would
 * enter the canvas, so the pan never reveals past what has been drawn.
 */
export function broadcastCameraPan(
  focusX: number,
  focusY: number,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number,
): { panX: number; panY: number } {
  const overscanX = Math.max(0, (zoom - 1) * canvasWidth / 2 - 1);
  const overscanY = Math.max(0, (zoom - 1) * canvasHeight / 2 - 1);
  // The focus point lands at (focus - size / 2) * zoom + size / 2 + pan, so
  // keeping it inside [0, size] bounds pan by keep ± size / 2.
  const keepX = (canvasWidth / 2 - focusX) * zoom;
  const keepY = (canvasHeight / 2 - focusY) * zoom;
  return {
    panX: clamp(
      (canvasWidth / 2 - focusX) * 0.22,
      Math.max(-overscanX, keepX - canvasWidth / 2),
      Math.min(overscanX, keepX + canvasWidth / 2),
    ),
    panY: clamp(
      (canvasHeight / 2 - focusY) * 0.18,
      Math.max(-overscanY, keepY - canvasHeight / 2),
      Math.min(overscanY, keepY + canvasHeight / 2),
    ),
  };
}

export function broadcastCameraTarget(input: BroadcastCameraTargetInput): BroadcastCameraTarget {
  const {
    moment,
    quality,
    playbackMode,
    reducedMotion,
    ballX,
    ballY,
    canvasWidth,
    canvasHeight,
    padding,
    fieldWidth,
    fieldHeight,
  } = input;
  if (reducedMotion) {
    return { focusX: canvasWidth / 2, focusY: canvasHeight / 2, zoom: 1, settle: 1 };
  }

  const compact = quality !== 'full';
  const zoomTable = compact ? COMPACT_ZOOM : DESKTOP_ZOOM;
  // Multiplicative rather than the old flat +0.008: an additive lift that was
  // sized for a 1.1x ceiling is invisible against a 1.7x framing, which would
  // have quietly made immersive mode identical to live at the tight moments.
  const immersiveLift = playbackMode === 'immersive' && moment !== 'wide'
    ? (compact ? 1.02 : 1.035)
    : 1;
  const maxZoom = compact ? MAX_COMPACT_BROADCAST_ZOOM : MAX_BROADCAST_ZOOM;
  const safeBallX = clamp(ballX, padding + fieldWidth * 0.1, padding + fieldWidth * 0.9);
  const safeBallY = clamp(ballY, padding + fieldHeight * 0.1, padding + fieldHeight * 0.9);
  const focusWeight = FOCUS_WEIGHT[moment];

  return {
    focusX: lerp(canvasWidth / 2, safeBallX, focusWeight),
    focusY: lerp(canvasHeight / 2, safeBallY, focusWeight),
    zoom: clamp(zoomTable[moment] * immersiveLift, 1, maxZoom),
    settle: SETTLE[moment],
  };
}

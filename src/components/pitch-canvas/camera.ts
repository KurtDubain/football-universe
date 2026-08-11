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

const DESKTOP_ZOOM: Record<BroadcastCameraMoment, number> = {
  wide: 1.004,
  build: 1.018,
  attack: 1.048,
  set_piece: 1.078,
  finish: 1.105,
  outcome: 1.115,
};

const COMPACT_ZOOM: Record<BroadcastCameraMoment, number> = {
  wide: 1,
  build: 1.008,
  attack: 1.028,
  set_piece: 1.048,
  finish: 1.068,
  outcome: 1.076,
};

const FOCUS_WEIGHT: Record<BroadcastCameraMoment, number> = {
  wide: 0.1,
  build: 0.24,
  attack: 0.48,
  set_piece: 0.68,
  finish: 0.82,
  outcome: 0.86,
};

const SETTLE: Record<BroadcastCameraMoment, number> = {
  wide: 0.014,
  build: 0.016,
  attack: 0.021,
  set_piece: 0.026,
  finish: 0.032,
  outcome: 0.036,
};

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
  const immersiveLift = playbackMode === 'immersive' && moment !== 'wide' ? (compact ? 0.004 : 0.008) : 0;
  const maxZoom = compact ? 1.08 : 1.12;
  const safeBallX = clamp(ballX, padding + fieldWidth * 0.1, padding + fieldWidth * 0.9);
  const safeBallY = clamp(ballY, padding + fieldHeight * 0.1, padding + fieldHeight * 0.9);
  const focusWeight = FOCUS_WEIGHT[moment];

  return {
    focusX: lerp(canvasWidth / 2, safeBallX, focusWeight),
    focusY: lerp(canvasHeight / 2, safeBallY, focusWeight),
    zoom: clamp(zoomTable[moment] + immersiveLift, 1, maxZoom),
    settle: SETTLE[moment],
  };
}

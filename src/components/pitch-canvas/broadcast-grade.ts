// The last pass over a finished frame: colour temperature and a vignette.
//
// A broadcast picture is not the raw scene. It is graded — cooled toward the
// stadium's white floodlights, warmed when the crowd is on its feet, pushed
// toward the home colour when the ball goes in — and it carries a lens
// vignette. None of that changes what happened on the pitch, and together it
// is most of the reason a frame reads as television rather than as a diagram.

import type { BroadcastView } from './broadcast-view';

export interface BroadcastGradeOptions {
  /** 0..1 how dangerous the moment is. Warms the picture. */
  danger?: number;
  /** 0..1 goal celebration intensity. Pushes the home colour through. */
  flash?: number;
  homeColor?: string;
}

/** The cool white of floodlights, laid over everything. */
const COOL_WASH = 'rgba(196,218,255,0.04)';
/** How dark the corners go. Real glass falls off; flat frames look drawn. */
const VIGNETTE_STRENGTH = 0.44;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function rgbaOf(hex: string, alpha: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return 'rgba(255,255,255,' + alpha.toFixed(3) + ')';
  const value = parseInt(match[1], 16);
  return 'rgba(' + ((value >> 16) & 255) + ',' + ((value >> 8) & 255) + ','
    + (value & 255) + ',' + alpha.toFixed(3) + ')';
}

/**
 * Grade one finished frame.
 *
 * Runs in drawing space, so a portrait frame is covered by the same rectangle
 * as a landscape one: the rotation is already on the context, and the drawing
 * rectangle is the whole canvas either way.
 */
export function drawBroadcastGrade(
  ctx: CanvasRenderingContext2D,
  view: BroadcastView,
  options: BroadcastGradeOptions = {},
): void {
  const W = view.width;
  const H = view.height;
  const danger = clamp01(options.danger ?? 0);
  const flash = clamp01(options.flash ?? 0);

  ctx.fillStyle = COOL_WASH;
  ctx.fillRect(0, 0, W, H);

  if (danger > 0.01) {
    ctx.fillStyle = 'rgba(255,228,182,' + (danger * 0.05).toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);
  }

  if (flash > 0.02 && options.homeColor) {
    ctx.fillStyle = rgbaOf(options.homeColor, flash * 0.1);
    ctx.fillRect(0, 0, W, H);
  }

  const inner = Math.min(W, H) * 0.34;
  const outer = Math.max(W, H) * 0.76;
  const vignette = ctx.createRadialGradient(W / 2, H * 0.52, inner, W / 2, H * 0.52, outer);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(0.62, 'rgba(0,0,0,' + (VIGNETTE_STRENGTH * 0.26).toFixed(3) + ')');
  vignette.addColorStop(1, 'rgba(0,0,0,' + VIGNETTE_STRENGTH.toFixed(3) + ')');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);
}
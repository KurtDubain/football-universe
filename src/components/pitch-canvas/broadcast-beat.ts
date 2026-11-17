import type { PitchOrientation } from './geometry';
import type { BroadcastView } from './broadcast-view';
import { withUpright } from './renderer';

/**
 * How long a beat holds the frame.
 *
 * Just under two seconds: long enough to read a name, short enough that a
 * match with six cards does not spend twelve seconds not playing football.
 */
export const BEAT_MAX_FRAMES = 108;

export interface BroadcastBeatOptions {
  view: BroadcastView;
  /** Frames remaining, counting down from BEAT_MAX_FRAMES. */
  frame: number;
  beat: 'yellow_card' | 'red_card' | 'substitution';
  /** Where on the pitch, in normalised pitch coordinates. */
  at: { x: number; y: number };
  teamColor: string;
  /** Already-resolved player name, or an empty string when the event has none. */
  label: string;
  orientation?: PitchOrientation;
}

/**
 * A card or a substitution, shown at the touchline.
 *
 * Deliberately the flattest thing the renderer draws: a printed plate with a
 * hard edge and a caption, no glow and no burst. A booking is an
 * administrative event, and dressing it as a highlight would tell the viewer
 * something the simulation never said.
 */
export function drawBroadcastBeat(
  ctx: CanvasRenderingContext2D,
  options: BroadcastBeatOptions,
): void {
  const { view, frame, beat, at, teamColor, label } = options;
  const t = 1 - frame / BEAT_MAX_FRAMES;
  const ground = view.at(at.x, at.y);
  const unit = view.unitsPerMeter * ground.scale;

  // Rise, hold, fade. The plate is already legible on its first frame so a
  // viewer who blinks still gets the information rather than an entrance.
  const rise = Math.min(1, t / 0.22);
  const fade = t > 0.82 ? Math.max(0, (1 - t) / 0.18) : 1;
  const lift = (1 - (1 - rise) ** 3) * unit * 1.35;
  const alpha = Math.min(1, rise * 1.6) * fade;
  if (alpha <= 0.01) return;

  withUpright(ctx, ground.x, ground.y, options.orientation ?? 'landscape', () => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(ground.x, ground.y - lift);

    if (beat === 'substitution') {
      const boardW = unit * 1.5;
      const boardH = unit * 1.05;
      ctx.fillStyle = 'rgba(16,18,24,0.9)';
      ctx.fillRect(-boardW / 2, -boardH, boardW, boardH);
      ctx.strokeStyle = 'rgba(232,226,208,0.55)';
      ctx.lineWidth = Math.max(1, unit * 0.05);
      ctx.strokeRect(-boardW / 2, -boardH, boardW, boardH);
      // Two arrows: one coming on, one going off.
      const arrow = (offsetX: number, up: boolean, color: string) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        const tipY = up ? -boardH * 0.78 : -boardH * 0.22;
        const tailY = up ? -boardH * 0.22 : -boardH * 0.78;
        const halfW = boardW * 0.16;
        ctx.moveTo(offsetX, tipY);
        ctx.lineTo(offsetX - halfW, tipY + (up ? halfW * 1.5 : -halfW * 1.5));
        ctx.lineTo(offsetX - halfW * 0.42, tipY + (up ? halfW * 1.5 : -halfW * 1.5));
        ctx.lineTo(offsetX - halfW * 0.42, tailY);
        ctx.lineTo(offsetX + halfW * 0.42, tailY);
        ctx.lineTo(offsetX + halfW * 0.42, tipY + (up ? halfW * 1.5 : -halfW * 1.5));
        ctx.lineTo(offsetX + halfW, tipY + (up ? halfW * 1.5 : -halfW * 1.5));
        ctx.closePath();
        ctx.fill();
      };
      arrow(-boardW * 0.22, true, '#4fae72');
      arrow(boardW * 0.22, false, '#c9524f');
    } else {
      const cardW = unit * 0.92;
      const cardH = unit * 1.32;
      ctx.rotate(beat === 'red_card' ? -0.13 : 0.09);
      ctx.fillStyle = beat === 'red_card' ? '#cf3f3f' : '#e8c33f';
      ctx.fillRect(-cardW / 2, -cardH, cardW, cardH);
      ctx.strokeStyle = 'rgba(18,16,12,0.55)';
      ctx.lineWidth = Math.max(1, unit * 0.05);
      ctx.strokeRect(-cardW / 2, -cardH, cardW, cardH);
      ctx.rotate(beat === 'red_card' ? 0.13 : -0.09);
    }

    if (label) {
      const fontSize = Math.max(9, unit * 0.52);
      ctx.font = '600 ' + fontSize.toFixed(1) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const metrics = ctx.measureText(label);
      const padX = fontSize * 0.5;
      const plateW = metrics.width + padX * 2;
      const plateH = fontSize * 1.5;
      ctx.fillStyle = 'rgba(14,16,21,0.86)';
      ctx.fillRect(-plateW / 2, unit * 0.16, plateW, plateH);
      ctx.fillStyle = teamColor;
      ctx.fillRect(-plateW / 2, unit * 0.16, Math.max(2, unit * 0.08), plateH);
      ctx.fillStyle = '#efe9d8';
      ctx.fillText(label, 0, unit * 0.16 + plateH * 0.24);
    }

    ctx.restore();
  });
}

// A club crest painted with canvas paths.
//
// `Path2D` accepts SVG path data verbatim, so this reads the exact strings
// the React badge renders as `<path d>`. That is what keeps the crest on the
// centre circle identical to the crest in the team list: there is one table
// of shapes, and two renderers.

import {
  BADGE_NAMEPLATE_PATH,
  BADGE_PATTERN_SHAPES,
  BADGE_SASH_PATH,
  BADGE_SYMBOL_PATHS,
  BADGE_VIEWBOX,
  badgeShade,
  teamBadgeParts,
} from '../team-badge-geometry';

/**
 * Path objects are immutable and reusable, and a crest is repainted every
 * frame. Building them once keeps the per-frame cost to fills and strokes.
 */
const pathCache = new Map<string, Path2D>();

function crestPath(d: string): Path2D {
  let path = pathCache.get(d);
  if (!path) {
    path = new Path2D(d);
    pathCache.set(d, path);
  }
  return path;
}

export interface TeamCrestOptions {
  /** Centre of the crest, in drawing space. */
  cx: number;
  cy: number;
  /** Side of the crest square, in drawing units. */
  size: number;
  teamId?: string;
  shortName: string;
  color: string;
  /** 0..1 overall opacity. */
  alpha?: number;
  /**
   * Vertical squash, 1 for a square crest.
   *
   * A crest painted on grass is seen from a low camera, so it foreshortens
   * with the turf. Passing the centre circle's projected height over its
   * projected width is enough to lay it flat on the pitch.
   */
  flatten?: number;
  /** Draw the two-letter nameplate. Off for crests painted on grass. */
  nameplate?: boolean;
}

/**
 * Paint one crest centred on `(cx, cy)`.
 *
 * Sizes below about three pixels are skipped outright: at that scale the
 * crest is a smudge, and a tifo across the far stand is exactly the case
 * where a wrong-looking smudge is worse than nothing.
 */
export function drawTeamCrest(
  ctx: CanvasRenderingContext2D,
  options: TeamCrestOptions,
): void {
  const size = options.size;
  const alpha = options.alpha ?? 1;
  if (size < 3 || alpha <= 0.01 || typeof Path2D === 'undefined') return;

  const parts = teamBadgeParts(options.teamId, options.shortName);
  const scale = size / BADGE_VIEWBOX;
  const flatten = options.flatten ?? 1;
  const dark = badgeShade(options.color, -0.52);
  const light = badgeShade(options.color, 0.34);
  const frame = crestPath(parts.frame);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(options.cx - size / 2, options.cy - (size * flatten) / 2);
  ctx.scale(scale, scale * flatten);

  ctx.fillStyle = dark;
  ctx.fill(frame);

  ctx.save();
  ctx.clip(frame);
  ctx.fillStyle = options.color;
  ctx.fillRect(0, 0, BADGE_VIEWBOX, BADGE_VIEWBOX);
  for (const shape of BADGE_PATTERN_SHAPES[parts.patternIndex]) {
    ctx.globalAlpha = alpha * shape.opacity;
    ctx.fillStyle = shape.tone === 'light' ? light : dark;
    ctx.fill(crestPath(shape.d));
  }
  ctx.globalAlpha = alpha * 0.26;
  ctx.fillStyle = dark;
  ctx.fill(crestPath(BADGE_SASH_PATH));
  ctx.restore();

  ctx.globalAlpha = alpha * 0.72;
  ctx.strokeStyle = dark;
  ctx.lineWidth = 2.2;
  ctx.stroke(frame);
  ctx.globalAlpha = alpha * 0.44;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 0.75;
  ctx.stroke(frame);

  ctx.globalAlpha = alpha * 0.32;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.35;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const d of BADGE_SYMBOL_PATHS[parts.symbolIndex]) {
    ctx.stroke(crestPath(d));
  }

  if (options.nameplate !== false) {
    ctx.globalAlpha = alpha * 0.82;
    ctx.fillStyle = dark;
    ctx.fill(crestPath(BADGE_NAMEPLATE_PATH));
    const label = parts.label;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 ' + (label.length > 1 ? 8.4 : 10) + 'px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, BADGE_VIEWBOX / 2, 29.2);
  }

  ctx.restore();
}
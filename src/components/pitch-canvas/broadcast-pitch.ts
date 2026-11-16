// The pitch as a broadcast camera sees it: a trapezoid of grass with real
// markings walked through the projection, plus the goals standing up off it.
//
// This replaces the cached top-down bitmap. Drawing it per frame costs a few
// hundred path operations — nothing next to twenty-two players — and buys two
// things the bitmap could not give: the markings stay sharp at any zoom, and
// the camera can change lens without re-baking anything.

import {
  pitchCorners,
  tracePitchArc,
  tracePitchLine,
  type ProjectedPoint,
} from './projection';
import type { BroadcastView } from './broadcast-view';

export const BROADCAST_SURROUND_COLOR = '#070d0a';

const STRIPE_COUNT = 10;
const GRASS_DARK = '#164327';
const GRASS_LIGHT = '#22603a';
const LINE_COLOR = 'rgba(240,248,238,0.72)';

// Pitch markings in metres, converted once. The pitch is 105 x 68.
const LENGTH_M = 105;
const WIDTH_M = 68;
const PENALTY_DEPTH = 16.5 / LENGTH_M;
const PENALTY_SPAN = 40.32 / WIDTH_M;
const GOAL_AREA_DEPTH = 5.5 / LENGTH_M;
const GOAL_AREA_SPAN = 18.32 / WIDTH_M;
const PENALTY_SPOT = 11 / LENGTH_M;
const GOAL_MOUTH_SPAN = 7.32 / WIDTH_M;
const CENTER_CIRCLE_M = 9.15;
const CORNER_ARC_M = 1;
const GOAL_HEIGHT_M = 2.44;
const GOAL_DEPTH_M = 2;

function line(
  ctx: CanvasRenderingContext2D,
  view: BroadcastView,
  from: { u: number; v: number },
  to: { u: number; v: number },
  segments = 8,
): void {
  tracePitchLine(ctx, view.rig, from, to, view.width, view.height, segments);
}

function arc(
  ctx: CanvasRenderingContext2D,
  view: BroadcastView,
  centerU: number,
  centerV: number,
  radiusMeters: number,
  startAngle = 0,
  endAngle = Math.PI * 2,
  segments = 28,
): void {
  tracePitchArc(
    ctx, view.rig, centerU, centerV, radiusMeters,
    view.width, view.height, startAngle, endAngle, segments,
  );
}

function mix(a: ProjectedPoint, b: ProjectedPoint, t: number): ProjectedPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, scale: a.scale };
}

function fillQuad(
  ctx: CanvasRenderingContext2D,
  points: ProjectedPoint[],
  fill: string,
): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index++) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * Mow stripes. Each band is a trapezoid because the far edge of every band is
 * narrower than its near edge — the single cheapest cue that the pitch has
 * depth at all.
 */
function drawStripes(ctx: CanvasRenderingContext2D, view: BroadcastView): void {
  for (let index = 0; index < STRIPE_COUNT; index++) {
    const u0 = index / STRIPE_COUNT;
    const u1 = (index + 1) / STRIPE_COUNT;
    fillQuad(ctx, [
      view.at(u0, 1),
      view.at(u1, 1),
      view.at(u1, 0),
      view.at(u0, 0),
    ], index % 2 === 0 ? GRASS_LIGHT : GRASS_DARK);
  }
}

/**
 * Worn turf. Goalmouths and the centre circle take the most traffic in any
 * real match, and the discolouration is most of what stops a pitch reading as
 * a flat green rectangle.
 */
function drawWear(ctx: CanvasRenderingContext2D, view: BroadcastView): void {
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#5c5a3c';
  for (const u of [0.055, 0.945]) {
    ctx.beginPath();
    arc(ctx, view, u, 0.5, 7.5, 0, Math.PI * 2, 20);
    ctx.fill();
  }
  ctx.globalAlpha = 0.09;
  ctx.beginPath();
  arc(ctx, view, 0.5, 0.5, 11, 0, Math.PI * 2, 24);
  ctx.fill();
  ctx.restore();
}

function drawMarkings(ctx: CanvasRenderingContext2D, view: BroadcastView): void {
  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = 1.3;
  ctx.lineJoin = 'round';

  // Touchlines and goal lines.
  ctx.beginPath();
  line(ctx, view, { u: 0, v: 1 }, { u: 1, v: 1 }, 16);
  line(ctx, view, { u: 0, v: 0 }, { u: 1, v: 0 }, 16);
  line(ctx, view, { u: 0, v: 1 }, { u: 0, v: 0 }, 10);
  line(ctx, view, { u: 1, v: 1 }, { u: 1, v: 0 }, 10);
  ctx.stroke();

  // Halfway line and centre circle.
  ctx.beginPath();
  line(ctx, view, { u: 0.5, v: 1 }, { u: 0.5, v: 0 }, 12);
  ctx.stroke();
  ctx.beginPath();
  arc(ctx, view, 0.5, 0.5, CENTER_CIRCLE_M);
  ctx.stroke();

  // Boxes and arcs at both ends.
  for (const end of [0, 1]) {
    const inward = end === 0 ? 1 : -1;
    const boxU = end + inward * PENALTY_DEPTH;
    const sixU = end + inward * GOAL_AREA_DEPTH;
    ctx.beginPath();
    line(ctx, view, { u: end, v: 0.5 - PENALTY_SPAN / 2 }, { u: boxU, v: 0.5 - PENALTY_SPAN / 2 }, 6);
    line(ctx, view, { u: boxU, v: 0.5 - PENALTY_SPAN / 2 }, { u: boxU, v: 0.5 + PENALTY_SPAN / 2 }, 8);
    line(ctx, view, { u: boxU, v: 0.5 + PENALTY_SPAN / 2 }, { u: end, v: 0.5 + PENALTY_SPAN / 2 }, 6);
    line(ctx, view, { u: end, v: 0.5 - GOAL_AREA_SPAN / 2 }, { u: sixU, v: 0.5 - GOAL_AREA_SPAN / 2 }, 4);
    line(ctx, view, { u: sixU, v: 0.5 - GOAL_AREA_SPAN / 2 }, { u: sixU, v: 0.5 + GOAL_AREA_SPAN / 2 }, 6);
    line(ctx, view, { u: sixU, v: 0.5 + GOAL_AREA_SPAN / 2 }, { u: end, v: 0.5 + GOAL_AREA_SPAN / 2 }, 4);
    ctx.stroke();

    const spotU = end + inward * PENALTY_SPOT;
    const arcReach = (PENALTY_DEPTH - PENALTY_SPOT) * LENGTH_M;
    const halfAngle = Math.acos(Math.min(1, arcReach / CENTER_CIRCLE_M));
    ctx.beginPath();
    arc(
      ctx, view, spotU, 0.5, CENTER_CIRCLE_M,
      end === 0 ? -halfAngle : Math.PI - halfAngle,
      end === 0 ? halfAngle : Math.PI + halfAngle,
      16,
    );
    ctx.stroke();
  }

  // Corner arcs.
  ctx.beginPath();
  for (const u of [0, 1]) {
    for (const v of [0, 1]) {
      const start = u === 0
        ? (v === 1 ? 0 : -Math.PI / 2)
        : (v === 1 ? Math.PI / 2 : Math.PI);
      arc(ctx, view, u, v, CORNER_ARC_M, start, start + Math.PI / 2, 6);
    }
  }
  ctx.stroke();

  // Spots.
  ctx.fillStyle = LINE_COLOR;
  for (const [u, v] of [[0.5, 0.5], [PENALTY_SPOT, 0.5], [1 - PENALTY_SPOT, 0.5]] as const) {
    const point = view.at(u, v);
    ctx.beginPath();
    ctx.ellipse(point.x, point.y, 1.6 * point.scale, 0.8 * point.scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * A goal standing up off the goal line: posts, crossbar and a net suggested
 * with a handful of threads. Drawn back-to-front so the far post sits behind
 * the near one, and raised along the screen vertical rather than the drawing
 * one so a portrait frame does not lay the frame on its side.
 */
function drawGoal(ctx: CanvasRenderingContext2D, view: BroadcastView, end: 0 | 1): void {
  const inward = end === 0 ? 1 : -1;
  const backU = end - inward * (GOAL_DEPTH_M / LENGTH_M);
  const nearV = 0.5 + GOAL_MOUTH_SPAN / 2;
  const farV = 0.5 - GOAL_MOUTH_SPAN / 2;
  const corners = [
    { u: end, v: nearV },
    { u: end, v: farV },
    { u: backU, v: farV },
    { u: backU, v: nearV },
  ].map(corner => view.at(corner.u, corner.v));
  const top = corners.map(point => view.liftPoint(point, GOAL_HEIGHT_M));

  // Net volume: the ground footprint plus the back panel lifted to the bar.
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let index = 1; index < corners.length; index++) ctx.lineTo(corners[index].x, corners[index].y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(226,240,226,0.05)';
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(top[2].x, top[2].y);
  ctx.lineTo(top[3].x, top[3].y);
  ctx.lineTo(corners[3].x, corners[3].y);
  ctx.lineTo(corners[2].x, corners[2].y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(226,240,226,0.07)';
  ctx.fill();

  // Net threads on the back panel.
  ctx.strokeStyle = 'rgba(232,244,232,0.2)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let row = 1; row < 5; row++) {
    const t = row / 5;
    const a = mix(corners[2], top[2], t);
    const b = mix(corners[3], top[3], t);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  for (let column = 0; column <= 4; column++) {
    const t = column / 4;
    const a = mix(corners[2], corners[3], t);
    const b = mix(top[2], top[3], t);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();

  // Frame.
  ctx.strokeStyle = 'rgba(248,252,246,0.9)';
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  ctx.lineTo(top[0].x, top[0].y);
  ctx.lineTo(top[1].x, top[1].y);
  ctx.lineTo(corners[1].x, corners[1].y);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(248,252,246,0.45)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(top[0].x, top[0].y);
  ctx.lineTo(top[3].x, top[3].y);
  ctx.moveTo(top[1].x, top[1].y);
  ctx.lineTo(top[2].x, top[2].y);
  ctx.stroke();
}

export interface BroadcastPitchOptions {
  /** Corner flag colour, normally the home club's. */
  flagColor?: string;
}

/**
 * Draw the whole pitch for one camera rig. Fills the canvas, so it must be the
 * first thing drawn inside the camera transform.
 */
export function drawBroadcastPitch(
  ctx: CanvasRenderingContext2D,
  view: BroadcastView,
  options: BroadcastPitchOptions = {},
): void {
  const W = view.width;
  const H = view.height;
  ctx.fillStyle = BROADCAST_SURROUND_COLOR;
  ctx.fillRect(0, 0, W, H);

  const corners = pitchCorners(view.rig, W, H);
  // A soft dark apron just outside the grass so the touchline reads as an
  // edge rather than a seam against the surround.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 18;
  fillQuad(ctx, corners, GRASS_DARK);
  ctx.restore();

  drawStripes(ctx, view);
  drawWear(ctx, view);

  // Light falls off toward the far side and the corners.
  const shade = ctx.createLinearGradient(0, corners[3].y, 0, corners[0].y);
  shade.addColorStop(0, 'rgba(0,0,0,0.22)');
  shade.addColorStop(0.55, 'rgba(0,0,0,0.02)');
  shade.addColorStop(1, 'rgba(255,255,255,0.045)');
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let index = 1; index < corners.length; index++) ctx.lineTo(corners[index].x, corners[index].y);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  drawMarkings(ctx, view);
  drawGoal(ctx, view, 0);
  drawGoal(ctx, view, 1);

  if (options.flagColor) {
    ctx.fillStyle = options.flagColor;
    for (const [u, v] of [[0, 1], [1, 1], [0, 0], [1, 0]] as const) {
      const base = view.at(u, v);
      const tip = view.liftPoint(base, 1.5);
      const across = { x: view.right.x * base.scale, y: view.right.y * base.scale };
      const down = { x: -view.up.x * base.scale, y: -view.up.y * base.scale };
      ctx.strokeStyle = 'rgba(240,248,238,0.75)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x + across.x * 4.5 + down.x * 1.6, tip.y + across.y * 4.5 + down.y * 1.6);
      ctx.lineTo(tip.x + down.x * 3.2, tip.y + down.y * 3.2);
      ctx.closePath();
      ctx.fill();
    }
  }
}

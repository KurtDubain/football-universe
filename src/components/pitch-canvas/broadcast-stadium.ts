// The building around the pitch: a raked stand behind the far touchline, the
// crowd in it, the roof and its light strips, and the advertising boards.
//
// The stand is the single biggest reason a broadcast frame reads as a stadium
// rather than a green rectangle floating in black, and it is why the top of the
// canvas is not wasted space. Everything here is drawn behind the grass, so it
// has to be the first thing on the canvas each frame.
//
// Two things are baked into the seat map. First, a real stand is *blocked*:
// seats come in solid colour runs, one colour per block, and it is the people
// sitting on them that are noisy. Randomising the seats themselves turns the
// whole tier into television static. Second, the crowd has to stay darker than
// the grass. It is background; the moment it out-shouts the pitch the eye stops
// knowing where to look.
//
// The lower tier takes its colour from the home club, which is the cheapest
// possible way to make the ground belong to somebody.
//
// The seat map is baked once per camera into an offscreen canvas and blitted
// with a horizontal offset. Panning a camera moves a background layer; it does
// not re-render several thousand seats, and it does not have to.

import { BROADCAST_SURROUND_COLOR, type BroadcastView } from './broadcast-view';

/** How far past the corners the stand reaches, relative to the far touchline. */
const STAND_WIDTH_FACTOR = 1.36;
/** Share of the stand height given to the roof. */
const ROOF_FRACTION = 0.13;
/** Share given to the dark walkway between the tiers and the pitch. */
const CONCOURSE_FRACTION = 0.085;
const SEAT_PITCH_PX = 4.2;
const ROW_PITCH_PX = 2.1;
/** Seats come in solid runs; this is how many runs fit across the stand. */
const SEAT_BLOCKS = 9;
/** Where the upper tier starts, as a share of the raked rows. */
const UPPER_TIER_SPLIT = 0.46;

/** The people. Skin tones and dark clothing, never a rainbow. */
const CROWD_COLORS = [
  '#d9c3a8', '#b08d6a', '#7a5a42', '#20242b',
  '#3a4350', '#a9b0b8', '#5c3336', '#2b3f57',
  '#14171c', '#8a8478', '#c8bda8', '#4d4238',
];
const SEAT_EMPTY = '#0b1117';
const TIER_BASE = '#0a1016';
const ROOF_COLOR = '#070b0f';
const ROOF_EDGE = '#1a242c';
const CONCOURSE_COLOR = '#05080b';
const FALLBACK_SEAT_BASE = '#2c4a6b';
/** Seat brightness per tier. The upper deck sits further off and reads darker. */
const LOWER_TIER_SHADE = 0.34;
const UPPER_TIER_SHADE = 0.22;
/** Extra haze over the upper deck, so distance is legible. */
const UPPER_TIER_DIM = 'rgba(0,0,0,0.18)';
/** Everything in the stand is background: this is how far it is pushed back. */
const STAND_DIM = 'rgba(5,9,13,0.3)';

const BOARD_COLORS = [
  '#16307a', '#0d4f4a', '#7a1a1a', '#6b4a12', '#25303d', '#4a1a68',
];

export interface StadiumOptions {
  /** Home club colour: the lower tier leans toward it. */
  homeColor?: string;
  /** 0..1 crowd density, from the render budget. */
  density?: number;
  /** 0..1 how loud it is right now. Drives the light wash over the stand. */
  excitement?: number;
  frame?: number;
  seed?: number;
}

/**
 * Deterministic per-seat noise.
 *
 * `Math.sin` hashing rather than a PRNG because the seat map is rebuilt only
 * when the camera changes, and it has to be identical every time it is.
 */
function seatNoise(row: number, column: number, seed: number): number {
  const value = Math.sin(row * 127.1 + column * 311.7 + seed * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

/** Rows compress toward the back of the rake, the way a real one does. */
function rake(t: number): number {
  return Math.pow(t, 0.84);
}

function parseHex(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function shade(hex: string, factor: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const parts: number[] = [];
  for (let index = 0; index < 3; index++) {
    parts.push(Math.max(0, Math.min(255, Math.round(rgb[index] * factor))));
  }
  return 'rgb(' + parts.join(',') + ')';
}

/**
 * One colour per block of seats, with a little jitter between blocks so the
 * runs read as separate sections rather than one flat rectangle.
 */
function blockSeatColor(
  block: number,
  upper: boolean,
  seed: number,
  homeColor?: string,
): string {
  const source = homeColor && parseHex(homeColor) ? homeColor : FALLBACK_SEAT_BASE;
  const jitter = 0.86 + seatNoise(block, upper ? 5 : 2, seed + 13) * 0.3;
  return shade(source, (upper ? UPPER_TIER_SHADE : LOWER_TIER_SHADE) * jitter);
}

interface StandLayer {
  key: string;
  canvas: HTMLCanvasElement;
  height: number;
}

let cachedStand: StandLayer | null = null;

function standKey(view: BroadcastView, options: StadiumOptions): string {
  return [
    view.rig.id,
    view.rig.farEdgeY,
    view.rig.depthRatio,
    view.rig.nearSpan,
    view.width,
    view.height,
    options.homeColor ?? '',
    (options.density ?? 1).toFixed(2),
    options.seed ?? 0,
  ].join('|');
}

/**
 * Bake the seat map for one camera.
 *
 * The canvas is in stadium space: x runs across the whole stand, y is 0 at the
 * roof and `height` at the front row. The caller blits it with the offset the
 * camera's `centerX` asks for, which is what makes a pan free.
 */
function buildStand(view: BroadcastView, options: StadiumOptions, span: number): StandLayer {
  const density = options.density ?? 1;
  const seed = options.seed ?? 1;
  const key = standKey(view, options);
  const standHeight = Math.max(10, view.rig.farEdgeY * view.height - 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(8, Math.ceil(span));
  canvas.height = Math.ceil(standHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) return { key, canvas, height: canvas.height };

  const roofBottom = canvas.height * ROOF_FRACTION;
  const concourseHeight = canvas.height * CONCOURSE_FRACTION;
  const concourseTop = canvas.height - concourseHeight;
  const usable = Math.max(6, concourseTop - roofBottom);
  const rows = Math.max(6, Math.round((usable / ROW_PITCH_PX) * density));
  const seatHeight = Math.max(1, (usable / rows) * 0.82);
  const headHeight = Math.max(0.9, seatHeight * 0.82);

  ctx.fillStyle = TIER_BASE;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Seats. Row 0 is the front row, just above the walkway.
  for (let row = 0; row < rows; row++) {
    const t = rows > 1 ? row / (rows - 1) : 0;
    const y = concourseTop - rake(t) * usable;
    const upper = t >= UPPER_TIER_SPLIT;
    // Higher rows sit further from the lens, so the block narrows a little.
    const shrink = 1 - 0.1 * t;
    const rowSpan = canvas.width * shrink;
    const rowLeft = (canvas.width - rowSpan) / 2;
    const blockWidth = rowSpan / SEAT_BLOCKS;
    for (let block = 0; block < SEAT_BLOCKS; block++) {
      ctx.fillStyle = blockSeatColor(block, upper, seed, options.homeColor);
      ctx.fillRect(rowLeft + block * blockWidth, y - seatHeight, blockWidth, seatHeight);
    }
    // The people on top of them. This is the only noisy layer in the stand.
    const columns = Math.max(10, Math.round((rowSpan / SEAT_PITCH_PX) * density));
    const step = rowSpan / columns;
    const headWidth = Math.max(0.8, step * 0.6);
    for (let column = 0; column < columns; column++) {
      const x = rowLeft + (column + 0.5) * step;
      const noise = seatNoise(row, column, seed);
      ctx.fillStyle = noise < 0.09
        ? SEAT_EMPTY
        : CROWD_COLORS[Math.floor(noise * 991) % CROWD_COLORS.length];
      ctx.fillRect(x - headWidth / 2, y - headHeight, headWidth, headHeight);
    }
    if (upper) {
      ctx.fillStyle = UPPER_TIER_DIM;
      ctx.fillRect(rowLeft, y - seatHeight, rowSpan, seatHeight);
    }
  }

  // Walkway at the front, then the roof, then the light that falls on both.
  ctx.fillStyle = CONCOURSE_COLOR;
  ctx.fillRect(0, concourseTop, canvas.width, concourseHeight);
  ctx.fillStyle = 'rgba(180,206,232,0.1)';
  ctx.fillRect(0, concourseTop, canvas.width, 1);

  ctx.fillStyle = ROOF_COLOR;
  ctx.fillRect(0, 0, canvas.width, roofBottom);
  const underside = ctx.createLinearGradient(0, roofBottom - 6, 0, roofBottom + 12);
  underside.addColorStop(0, 'rgba(150,180,205,0.2)');
  underside.addColorStop(1, 'rgba(150,180,205,0)');
  ctx.fillStyle = underside;
  ctx.fillRect(0, roofBottom - 6, canvas.width, 18);
  ctx.fillStyle = ROOF_EDGE;
  ctx.fillRect(0, roofBottom - 1, canvas.width, 1);

  // The roof throws a shadow over the back of the tier.
  const roofShade = ctx.createLinearGradient(0, roofBottom, 0, roofBottom + usable * 0.5);
  roofShade.addColorStop(0, 'rgba(0,0,0,0.5)');
  roofShade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = roofShade;
  ctx.fillRect(0, roofBottom, canvas.width, usable * 0.5);

  // The floodlights pick out the front rows.
  const floodlit = ctx.createLinearGradient(0, concourseTop - usable * 0.42, 0, concourseTop);
  floodlit.addColorStop(0, 'rgba(196,224,255,0)');
  floodlit.addColorStop(1, 'rgba(196,224,255,0.12)');
  ctx.fillStyle = floodlit;
  ctx.fillRect(0, concourseTop - usable * 0.42, canvas.width, usable * 0.42);

  // Push the whole thing back behind the grass.
  ctx.fillStyle = STAND_DIM;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  return { key, canvas, height: canvas.height };
}

/**
 * Draw the whole surround for one camera.
 *
 * Fills the canvas, so it has to be the first thing drawn inside the camera
 * transform, before the grass, which sits in front of it.
 */
export function drawBroadcastStadium(
  ctx: CanvasRenderingContext2D,
  view: BroadcastView,
  options: StadiumOptions = {},
): void {
  const W = view.width;
  const H = view.height;
  const rig = view.rig;
  ctx.fillStyle = BROADCAST_SURROUND_COLOR;
  ctx.fillRect(0, 0, W, H);

  // One formula for the front-of-stand centre. The stand and the boards have
  // to pan together, and they did not when each had its own.
  const touchlineSpan = rig.nearSpan * rig.depthRatio * W;
  const frontCenter = W / 2 + (0.5 - rig.centerX) * touchlineSpan;
  const span = touchlineSpan * STAND_WIDTH_FACTOR;
  const standLeft = frontCenter - span / 2;
  const farY = rig.farEdgeY * H;
  const standHeight = Math.max(10, farY - 2);

  if (typeof document !== 'undefined') {
    const key = standKey(view, options);
    if (!cachedStand || cachedStand.key !== key) {
      cachedStand = buildStand(view, options, span);
    }
    ctx.drawImage(cachedStand.canvas, standLeft, 0, span, cachedStand.height);
  }

  // Roof light strips. A modern ground lights the pitch from the roof edge,
  // and that bright line is what tells you the stand has a top. The glow is
  // sized off the stand height, not its width: on the box camera the stand is
  // nearly twice the canvas wide, and a width-based radius whites out the frame.
  const stripY = standHeight * ROOF_FRACTION;
  const glowRadius = Math.max(5, standHeight * 0.46);
  const stripCount = 12;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let index = 0; index < stripCount; index++) {
    const x = standLeft + ((index + 0.5) * span) / stripCount;
    const glow = ctx.createRadialGradient(x, stripY, 0, x, stripY, glowRadius);
    glow.addColorStop(0, 'rgba(206,226,255,0.3)');
    glow.addColorStop(0.45, 'rgba(206,226,255,0.08)');
    glow.addColorStop(1, 'rgba(206,226,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - glowRadius, stripY - glowRadius, glowRadius * 2, glowRadius * 2);
  }

  // The crowd brightens with the noise it is making. A flat wash rather than
  // per-seat animation: the seats are a baked layer, and re-rendering them for
  // a shimmer would cost more than the effect is worth.
  const excitement = options.excitement ?? 0;
  if (excitement > 0.01) {
    ctx.fillStyle = 'rgba(255,236,190,' + (0.015 + excitement * 0.05).toFixed(3) + ')';
    ctx.fillRect(standLeft, 0, span, standHeight);
  }
  ctx.restore();

  // Advertising boards, right behind the far touchline.
  const boardHeight = Math.max(5, H * 0.026);
  const boardLeft = frontCenter - touchlineSpan * 0.56;
  const boardRight = frontCenter + touchlineSpan * 0.56;
  const panelWidth = Math.max(16, (boardRight - boardLeft) / 9);
  const panels = Math.ceil((boardRight - boardLeft) / panelWidth);
  for (let index = 0; index < panels; index++) {
    const x = boardLeft + index * panelWidth;
    ctx.fillStyle = BOARD_COLORS[index % BOARD_COLORS.length];
    ctx.fillRect(x, farY - boardHeight, panelWidth - 1, boardHeight);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(boardLeft, farY - boardHeight, boardRight - boardLeft, 1);
  // A dark moat so the boards sit on the ground instead of floating.
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(boardLeft, farY - 1.5, boardRight - boardLeft, 2.5);

  // The near side of the ground is behind the lens, so it only ever reads as
  // a dark apron under the closest touchline.
  const nearY = rig.nearEdgeY * H;
  if (nearY < H - 1) {
    const apron = ctx.createLinearGradient(0, nearY, 0, H);
    apron.addColorStop(0, 'rgba(8,16,12,0)');
    apron.addColorStop(1, 'rgba(2,5,4,0.92)');
    ctx.fillStyle = apron;
    ctx.fillRect(0, nearY, W, H - nearY);
  }
}
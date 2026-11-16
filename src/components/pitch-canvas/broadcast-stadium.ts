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
import { drawTeamCrest } from './team-crest';

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

export interface StadiumCrest {
  teamId?: string;
  shortName: string;
  color: string;
}

export interface StadiumScoreboard {
  minute: number;
  homeScore: number;
  awayScore: number;
  home: StadiumCrest;
  away: StadiumCrest;
}

export interface StadiumOptions {
  /** Home club colour: the lower tier leans toward it. */
  homeColor?: string;
  /** 0..1 crowd density, from the render budget. */
  density?: number;
  /** 0..1 how loud it is right now. Drives the light wash over the stand. */
  excitement?: number;
  /** Home crest, unfurled as a tifo over one block of the stand. */
  crest?: StadiumCrest;
  /** Scoreline and clock for the big screen. Omitted means no screen. */
  scoreboard?: StadiumScoreboard;
  /** 0..1 celebration intensity: phone flashes and a home-colour wash. */
  flash?: number;
  /**
   * 0..1 how much the moment is worth. Drives how hard the crowd moves and
   * how violently the tifo is being worked, separately from how loud it is:
   * a shot in a settled game is loud without being urgent.
   */
  tension?: number;
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

/** Cached white bloom for the crowd's phone flashes. */
let flashSprite: HTMLCanvasElement | null = null;

function getFlashSprite(): HTMLCanvasElement | null {
  if (flashSprite) return flashSprite;
  if (typeof document === 'undefined') return null;
  const size = 24;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const spriteCtx = canvas.getContext('2d');
  if (!spriteCtx) return null;
  const glow = spriteCtx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  glow.addColorStop(0, 'rgba(255,253,244,0.95)');
  glow.addColorStop(0.3, 'rgba(255,250,228,0.4)');
  glow.addColorStop(1, 'rgba(255,250,228,0)');
  spriteCtx.fillStyle = glow;
  spriteCtx.fillRect(0, 0, size, size);
  flashSprite = canvas;
  return canvas;
}

function rgbaOf(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return 'rgba(255,255,255,' + alpha.toFixed(3) + ')';
  return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha.toFixed(3) + ')';
}

/**
 * Phone flashes going off across the stand.
 *
 * The single most recognisable thing a real crowd does. Drawn from a cached
 * bloom sprite rather than a gradient per flash: a celebration puts up to
 * sixty of these on screen at once and every one of them has to be cheap.
 */
function drawCrowdFlashes(
  ctx: CanvasRenderingContext2D,
  standLeft: number,
  span: number,
  standHeight: number,
  flash: number,
  frame: number,
  seed: number,
): void {
  const sprite = getFlashSprite();
  if (!sprite || flash <= 0.02) return;
  const count = Math.round(16 + flash * 46);
  // The bank of phones re-rolls every few frames. Holding one position for a
  // whole second is what stops a flash reading as a flash.
  const phase = Math.floor(frame / 3);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let index = 0; index < count; index += 1) {
    if (seatNoise(index, phase, seed + 31) > 0.2 + flash * 0.8) continue;
    const x = standLeft + seatNoise(phase, index, seed + 57) * span;
    const y = standHeight * (0.2 + seatNoise(index, phase, seed + 91) * 0.66);
    const radius = 1.5 + seatNoise(index, phase, seed + 13) * 3.2;
    ctx.globalAlpha = 0.32 + flash * 0.5;
    ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
  }
  ctx.restore();
}

/** Where the banner sits, in the baked stand's own coordinates. */
export interface TifoRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The banner's footprint.
 *
 * Kept clear of the middle of the tier, which is where the big screen hangs:
 * a banner behind a scoreboard is a banner nobody sees. Shared with the bake
 * so the animated cloth sits exactly on the painted one — two copies of this
 * arithmetic is how a ripple ends up floating beside its own banner.
 */
function tifoRectFor(canvasWidth: number, roofBottom: number, usable: number, seed: number): TifoRect {
  const onLeft = seatNoise(3, 7, seed) < 0.5;
  const jitter = seatNoise(4, 11, seed) * 0.14;
  return {
    left: canvasWidth * (onLeft ? 0.04 + jitter : 0.64 + jitter),
    top: roofBottom + usable * 0.08,
    width: (canvasWidth / SEAT_BLOCKS) * 1.7,
    height: usable * 0.54,
  };
}

interface StandLayer {
  key: string;
  canvas: HTMLCanvasElement;
  height: number;
  tifo: TifoRect | null;
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
    options.crest ? (options.crest.teamId ?? options.crest.shortName) : '',
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
  if (!ctx) return { key, canvas, height: canvas.height, tifo: null };

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

  // Tifo: one run of the stand under a banner. A club that fills its ground
  // does this, and it is the loudest home-colour signal anywhere in the frame.
  // Drawn over the seats rather than instead of them, because that is what a
  // banner is: a sheet held above people.
  const crest = options.crest;
  const tifo = crest && canvas.width > 60
    ? tifoRectFor(canvas.width, roofBottom, usable, seed)
    : null;
  if (crest && tifo) {
    const tifoLeft = tifo.left;
    const tifoTop = tifo.top;
    const tifoWidth = tifo.width;
    const tifoHeight = tifo.height;
    ctx.fillStyle = shade(crest.color, 0.72);
    ctx.fillRect(tifoLeft, tifoTop, tifoWidth, tifoHeight);
    // A banner is cloth: it hangs in folds and it is darker along the top.
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(tifoLeft, tifoTop, tifoWidth, tifoHeight * 0.16);
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    for (let fold = 1; fold < 4; fold += 1) {
      ctx.fillRect(tifoLeft + (fold * tifoWidth) / 4, tifoTop, tifoWidth * 0.04, tifoHeight);
    }
    drawTeamCrest(ctx, {
      cx: tifoLeft + tifoWidth / 2,
      cy: tifoTop + tifoHeight * 0.55,
      size: Math.min(tifoWidth * 0.84, tifoHeight * 0.94),
      teamId: crest.teamId,
      shortName: crest.shortName,
      // Dark on a bright banner. A white crest on the club's own colour has no
      // contrast left to draw its pattern with, so it reads as a blank disc.
      color: shade(crest.color, 0.24),
      alpha: 0.94,
      nameplate: false,
    });
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

  return { key, canvas, height: canvas.height, tifo };
}

/** Below this the scoreline is a smudge, so the screen is left out entirely. */
const MIN_SCREEN_WIDTH = 34;
const MIN_SCREEN_HEIGHT = 12;

interface BigScreenGeometry {
  centerX: number;
  top: number;
  standHeight: number;
  viewWidth: number;
  board: StadiumScoreboard;
  /** Horizontal span the screen must not cover, in canvas coordinates. */
  avoid?: { left: number; right: number };
}

/**
 * The scoreboard hanging over the middle of the stand.
 *
 * Sized off the stand height, not its width: on the tight camera the stand is
 * nearly twice the canvas wide, and a width-based screen swallows the tier it
 * is supposed to hang above. The horizontal position is then clamped into the
 * frame, because a scoreboard sliced by the edge of the picture reads as a bug
 * rather than as a building.
 */
function drawBigScreen(ctx: CanvasRenderingContext2D, geometry: BigScreenGeometry): void {
  const height = geometry.standHeight * 0.38;
  const width = Math.min(height * 2.6, geometry.viewWidth * 0.24);
  if (width < MIN_SCREEN_WIDTH || height < MIN_SCREEN_HEIGHT) return;
  let x = Math.max(
    4,
    Math.min(geometry.centerX - width / 2, geometry.viewWidth - width - 4),
  );
  const avoid = geometry.avoid;
  if (avoid && x < avoid.right && x + width > avoid.left) {
    // The screen is clamped into the frame, so on a panning camera it lands
    // squarely on the banner: both live on the stand, and the clamp puts the
    // screen at whichever edge the pan opened up. A tifo behind the big screen
    // is a tifo nobody sees, and the banner is the loudest home-colour signal
    // in the frame. Step around it, into whichever side has room.
    const roomLeft = avoid.left - 4;
    const roomRight = geometry.viewWidth - avoid.right - 4;
    if (roomLeft >= width) x = avoid.left - width - 4;
    else if (roomRight >= width) x = avoid.right + 4;
    x = Math.max(4, Math.min(x, geometry.viewWidth - width - 4));
  }
  const y = geometry.top;
  const board = geometry.board;

  ctx.fillStyle = '#04070a';
  ctx.fillRect(x - 2, y - 2, width + 4, height + 4);
  const panel = ctx.createLinearGradient(x, y, x, y + height);
  panel.addColorStop(0, '#121c27');
  panel.addColorStop(1, '#070c12');
  ctx.fillStyle = panel;
  ctx.fillRect(x, y, width, height);

  const barWidth = Math.max(2, width * 0.085);
  ctx.fillStyle = board.home.color;
  ctx.fillRect(x, y, barWidth, height);
  ctx.fillStyle = board.away.color;
  ctx.fillRect(x + width - barWidth, y, barWidth, height);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const scoreSize = height * 0.52;
  ctx.font = '800 ' + scoreSize.toFixed(1) + 'px Inter, Arial, sans-serif';
  ctx.fillStyle = '#f8fafc';
  ctx.fillText(board.homeScore + ' - ' + board.awayScore, x + width / 2, y + height * 0.42);

  const clockSize = Math.max(5, height * 0.24);
  ctx.font = '600 ' + clockSize.toFixed(1) + 'px Inter, Arial, sans-serif';
  ctx.fillStyle = 'rgba(226,232,240,0.7)';
  ctx.fillText(board.minute + "'", x + width / 2, y + height * 0.8);
}
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * The crowd on its feet.
 *
 * The seats and the heads are baked, because re-rendering several thousand of
 * them every frame costs more than the effect is worth. What cannot be baked
 * is the one thing a still crowd can never fake: people standing up. So this
 * draws a sparse layer of risers over the baked heads, their height driven by
 * how much the moment is worth, with a wave travelling across the tier so the
 * surge moves instead of pulsing in place.
 *
 * `tension` is read separately from `excitement` on purpose. A shot in a
 * settled game is loud; a shot in the last ten minutes of a level one is
 * urgent, and a stand reacts to the second by getting up rather than by
 * getting brighter.
 */
function drawCrowdSurge(
  ctx: CanvasRenderingContext2D,
  standLeft: number,
  span: number,
  standHeight: number,
  options: StadiumOptions,
): void {
  const energy = Math.max(
    clamp01(options.excitement ?? 0),
    clamp01(options.tension ?? 0) * 0.8,
    clamp01(options.flash ?? 0),
  );
  if (energy <= 0.04) return;
  const frame = options.frame ?? 0;
  const seed = options.seed ?? 1;
  const roofBottom = standHeight * ROOF_FRACTION;
  const concourseTop = standHeight * (1 - CONCOURSE_FRACTION);
  const usable = Math.max(4, concourseTop - roofBottom);
  const columns = Math.max(12, Math.round(span / (SEAT_PITCH_PX * 2.4)));
  const riserWidth = Math.max(1, (span / columns) * 0.62);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let column = 0; column < columns; column += 1) {
    const t = (column + 0.5) / columns;
    const jitter = seatNoise(column, 11, seed + 5);
    // The wave travels: a stand does not heave all at once, it goes around.
    const wave = Math.sin(frame * 0.055 - t * 7.5 + seatNoise(column, 3, seed) * 2.4);
    const rise = energy * (0.55 + 0.45 * wave) * (0.6 + jitter * 0.7);
    if (rise <= 0.05) continue;
    // Sit the risers on the crowd, on the same rake the bake used.
    const y = concourseTop - rake(0.18 + jitter * 0.62) * usable;
    const riserHeight = Math.max(1, riserWidth * (0.9 + rise * 1.5));
    ctx.fillStyle = 'rgba(255,238,206,' + (0.05 + rise * 0.16).toFixed(3) + ')';
    ctx.fillRect(
      standLeft + t * span - riserWidth / 2,
      y - riserHeight,
      riserWidth,
      riserHeight,
    );
  }
  ctx.restore();
}

/**
 * Where the banner sits on the canvas, for this camera pan.
 *
 * Shared by the cloth animation and the big screen, which has to step around
 * it: two copies of this arithmetic is how a ripple ends up floating beside
 * its own banner, and how a scoreboard ends up parked on top of one.
 */
function tifoScreenRect(
  layer: StandLayer,
  standLeft: number,
  span: number,
): { left: number; top: number; width: number; height: number } | null {
  const rect = layer.tifo;
  if (!rect) return null;
  const scaleX = span / layer.canvas.width;
  const scaleY = layer.height / layer.canvas.height;
  return {
    left: standLeft + rect.left * scaleX,
    top: rect.top * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  };
}

/**
 * The banner being worked.
 *
 * A tifo is a sheet of cloth held above people, and cloth that never moves
 * reads as a painted rectangle. The folds drift with the moment and the whole
 * banner takes a hit of light when the ball goes in.
 */
function drawTifoWave(
  ctx: CanvasRenderingContext2D,
  layer: StandLayer,
  standLeft: number,
  span: number,
  options: StadiumOptions,
): void {
  const screen = tifoScreenRect(layer, standLeft, span);
  if (!screen) return;
  const { left, top, width, height } = screen;
  if (width < 6 || height < 4) return;

  const flash = clamp01(options.flash ?? 0);
  const energy = clamp01(
    Math.max(clamp01(options.excitement ?? 0) * 0.7, clamp01(options.tension ?? 0) * 0.8)
    + flash * 0.5,
  );
  const frame = options.frame ?? 0;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const folds = 5;
  const bandWidth = width / folds;
  for (let fold = 0; fold < folds; fold += 1) {
    const phase = frame * (0.04 + energy * 0.055) + fold * 1.15;
    const drift = Math.sin(phase) * bandWidth * (0.12 + energy * 0.3);
    ctx.fillStyle = 'rgba(255,246,222,' + (0.04 + energy * 0.13).toFixed(3) + ')';
    ctx.fillRect(left + fold * bandWidth + drift, top, bandWidth * 0.4, height);
  }
  // A billow running the length of the cloth, so it reads as hanging rather
  // than as a row of lit stripes.
  const billow = (Math.sin(frame * 0.03) * 0.5 + 0.5) * height * 0.22;
  const gradient = ctx.createLinearGradient(0, top + billow, 0, top + billow + height * 0.5);
  gradient.addColorStop(0, 'rgba(255,250,235,0)');
  gradient.addColorStop(0.5, 'rgba(255,250,235,' + (0.03 + energy * 0.08).toFixed(3) + ')');
  gradient.addColorStop(1, 'rgba(255,250,235,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(left, top, width, height);
  if (flash > 0.02) {
    ctx.fillStyle = 'rgba(255,252,240,' + (flash * 0.3).toFixed(3) + ')';
    ctx.fillRect(left, top, width, height);
  }
  ctx.restore();
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

  let tifoOnScreen: { left: number; right: number } | undefined;
  if (typeof document !== 'undefined') {
    const key = standKey(view, options);
    if (!cachedStand || cachedStand.key !== key) {
      cachedStand = buildStand(view, options, span);
    }
    ctx.drawImage(cachedStand.canvas, standLeft, 0, span, cachedStand.height);
    drawCrowdSurge(ctx, standLeft, span, standHeight, options);
    drawTifoWave(ctx, cachedStand, standLeft, span, options);
    const banner = tifoScreenRect(cachedStand, standLeft, span);
    if (banner && banner.width >= 6) {
      tifoOnScreen = { left: banner.left, right: banner.left + banner.width };
    }
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

  // The big screen. Not baked into the stand, because the scoreline changes
  // every few seconds and the seat map does not.
  if (options.scoreboard) {
    drawBigScreen(ctx, {
      centerX: frontCenter,
      top: standHeight * ROOF_FRACTION + standHeight * 0.04,
      standHeight,
      viewWidth: view.width,
      board: options.scoreboard,
      avoid: tifoOnScreen,
    });
  }

  // The stand answers a goal: a wash of the home colour up the tier, and a
  // bank of phone flashes across it.
  const flash = options.flash ?? 0;
  if (flash > 0.02) {
    if (options.homeColor) {
      const wash = ctx.createLinearGradient(0, standHeight, 0, standHeight * 0.18);
      wash.addColorStop(0, rgbaOf(options.homeColor, 0.22 * flash));
      wash.addColorStop(1, rgbaOf(options.homeColor, 0));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = wash;
      ctx.fillRect(standLeft, 0, span, standHeight);
      ctx.restore();
    }
    drawCrowdFlashes(
      ctx, standLeft, span, standHeight, flash,
      options.frame ?? 0, options.seed ?? 1,
    );
  }

  // Advertising boards, right behind the far touchline.
  const boardHeight = Math.max(5, H * 0.026);
  const boardLeft = frontCenter - touchlineSpan * 0.56;
  const boardRight = frontCenter + touchlineSpan * 0.56;
  const panelWidth = Math.max(16, (boardRight - boardLeft) / 9);
  const panels = Math.ceil((boardRight - boardLeft) / panelWidth);
  for (let index = 0; index < panels; index++) {
    const x = boardLeft + index * panelWidth;
    const panelSpan = panelWidth - 1;
    ctx.fillStyle = BOARD_COLORS[index % BOARD_COLORS.length];
    ctx.fillRect(x, farY - boardHeight, panelSpan, boardHeight);
    // Two light bars stand in for lettering. A flat colour panel reads as a
    // row of building blocks; a panel with something written on it reads as
    // an advertising board, and at this distance that is the whole difference.
    const textWidth = panelSpan * 0.58;
    const textX = x + (panelSpan - textWidth) / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.52)';
    ctx.fillRect(textX, farY - boardHeight * 0.64, textWidth, Math.max(1, boardHeight * 0.2));
    ctx.fillStyle = 'rgba(255,255,255,0.26)';
    ctx.fillRect(
      textX + textWidth * 0.2,
      farY - boardHeight * 0.34,
      textWidth * 0.6,
      Math.max(0.8, boardHeight * 0.12),
    );
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
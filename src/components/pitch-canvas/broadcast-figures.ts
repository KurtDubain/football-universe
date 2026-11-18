// Footballers, the ball and the finish, drawn as a broadcast camera sees them.
//
// The flat renderer drew a player as an ellipse rotated toward its target.
// Under a camera that is wrong in a way you notice at once: someone running
// away from the lens has to get narrower, not stay a disc. So every
// measurement below is derived from one number — the figure height in pixels
// — and every part of the body is placed as a fraction of it.

import { clamp, hexToRgbStr } from './math';
import {
  BALL_DIAMETER_METERS,
  PLAYER_HEIGHT_METERS,
  type ProjectedPoint,
} from './projection';
import { BASE_UNITS_PER_METER, type BroadcastView } from './broadcast-view';
import type { PitchOrientation } from './geometry';
import type { ShotOutcome } from './event-scene';
import type { KeeperDivePlan } from './keeper-action';
import {
  GOAL_CELEB_MAX_FRAMES,
  SHOT_OUTCOME_MAX_FRAMES,
  withUpright,
} from './renderer';

const GOAL_HEIGHT_METERS = 2.44;
const GOAL_MOUTH_SPAN_METERS = 7.32;
const PITCH_WIDTH_METERS = 68;

/**
 * Broadcast exaggeration.
 *
 * At a wide framing a 1.82 m player is nine logical pixels tall, which is
 * honest and unreadable. Every televised sport cheats here: figures are
 * drawn slightly over life size so they hold together as people at the
 * distance the camera actually sits at. 1.16 is about two extra pixels at
 * the near touchline and is the smallest lie that survives the wide shot.
 */
export const FIGURE_EXAGGERATION = 1.16;

/**
 * The same cheat for the ball, and a much larger one.
 *
 * A 22 cm ball at a wide framing is half a pixel. Real broadcasts solve this
 * with a lens, not a radius, so the ball has to be inflated until it reads —
 * then floored and capped so it never becomes a balloon on the tight camera.
 */
export const BALL_EXAGGERATION = 4.2;
const MIN_BALL_RADIUS = 1.9;
const MAX_BALL_RADIUS = 7;

const SKIN_TONES = ['#e9b88f', '#c98a5f', '#8d5a37', '#f2cda6', '#a9713f', '#6f4527'];
const HAIR_TONES = ['#17110d', '#2f2118', '#4a3423', '#0d0b0a', '#6b4a2a', '#8a6a3f'];

function parseHexColor(hex: string): [number, number, number] | null {
  const raw = (hex ?? '').replace('#', '');
  if (raw.length !== 3 && raw.length !== 6) return null;
  const full = raw.length === 3
    ? raw.charAt(0) + raw.charAt(0) + raw.charAt(1) + raw.charAt(1) + raw.charAt(2) + raw.charAt(2)
    : raw;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return [r, g, b];
}

/**
 * 整场比赛喂进 `shadeColor` 的只有两队队色、门将色和几档肤色，而
 * `drawBroadcastPlayer` 每帧要为 22 名球员各跑六次：解析十六进制、拼字符串，
 * 再把结果交给 canvas 的解析器过一遍。键只有 (hex, amount)，实际取值是个位数，
 * 所以这张表不会长起来，命中率却接近 100%。
 */
const shadeCache = new Map<string, string>();

/** Blend a colour toward white (positive) or black (negative). */
function shadeColor(hex: string, amount: number): string {
  const key = hex + '|' + amount;
  const cached = shadeCache.get(key);
  if (cached !== undefined) return cached;
  const parsed = parseHexColor(hex);
  // 解析不出来就原样返回，返回值照样进表：表里存的是「这个键算出来的那个字符串」，
  // 不是 null。`shadeColor(socks, -0.3)` 走的正是这条路 —— socks 已经是 rgb() 串而
  // 不是十六进制 —— 22 名球员每帧各一次的无谓解析就是从这儿来的。
  if (!parsed) {
    shadeCache.set(key, hex);
    return hex;
  }
  const target = amount >= 0 ? 255 : 0;
  const t = Math.abs(amount);
  const mix = (channel: number) => Math.round(channel + (target - channel) * t);
  const shaded = 'rgb(' + mix(parsed[0]) + ',' + mix(parsed[1]) + ',' + mix(parsed[2]) + ')';
  shadeCache.set(key, shaded);
  return shaded;
}

/**
 * Ground speed that reads as a full sprint, in normalized pitch units per
 * 60 fps frame.
 *
 * The movement layer tops a forward out at 0.00098 * 1.55 (sprint) * 1.15
 * (directed recovery) = 0.00175, so this puts a full sprint at the top of the
 * swing range and a midfielder's 0.00094 jog a little past half. The 0.0055
 * it replaces is 34.6 m/s, three times what that layer can produce, so
 * `moving` never passed 0.32: a sprinting ten-pixel figure swung its legs
 * 0.65 px, which is narrower than the line the leg is drawn with.
 */
export const SPRINT_REFERENCE_SPEED = 0.0016;

/**
 * Stride cycle rate, in radians per 60 fps frame. One cycle is two steps.
 *
 * A footballer takes roughly two steps a second at a walk and four and a half
 * at a sprint, so the cycle runs from about 1.1 Hz to 2.3 Hz. The single fixed
 * 0.44 this replaces was 4.2 Hz — eight steps a second — at every pace, which
 * is what made a jog read as a buzz rather than a run.
 */
export const STRIDE_RATE_WALK = 0.115;
export const STRIDE_RATE_SPRINT = 0.24;

/** How far a forward-swinging foot rises, as a share of its own travel. */
const FOOT_LIFT_RATIO = 0.55;

/**
 * Drawn height of a figure standing on a projected ground point, in drawing
 * units. Exported so a test can state an expectation in the same units the
 * renderer draws in instead of re-deriving the projection.
 */
export function broadcastPlayerHeight(
  view: BroadcastView,
  ground: ProjectedPoint,
  visualScale = 1,
): number {
  return PLAYER_HEIGHT_METERS
    * view.unitsPerMeter
    * ground.scale
    * FIGURE_EXAGGERATION
    * visualScale;
}

/** Stride cycle rate for a given ground speed, in radians per 60 fps frame. */
export function strideRateFor(speed: number): number {
  const moving = clamp(speed / SPRINT_REFERENCE_SPEED, 0, 1);
  return STRIDE_RATE_WALK + (STRIDE_RATE_SPRINT - STRIDE_RATE_WALK) * moving;
}

export type BroadcastPlayerAction = 'receive' | 'shot' | 'save' | 'catch' | 'block';

export interface BroadcastPlayerOptions {
  view: BroadcastView;
  /** Ground contact point, already projected. */
  ground: ProjectedPoint;
  /** Facing, in screen space. Need not be normalized. */
  dirX: number;
  dirY: number;
  color: string;
  number: number;
  /** Stable per-player integer: skin, hair and stride phase all derive from it. */
  seed: number;
  frame: number;
  /**
   * Integrated stride cycle, in radians.
   *
   * Cadence depends on pace and pace changes, so the phase cannot be derived
   * from the frame counter: `frame * rate(speed)` snaps the legs to a new
   * place every time the rate moves. The caller integrates it with
   * `strideRateFor`; `frame` still drives the pulses below, which do not care.
   */
  stridePhase?: number;
  /**
   * Ground speed in normalized pitch units per 60 fps frame, 0..0.0018.
   *
   * A caller running a longer frame step has to divide its per-frame
   * displacement back down, or a degraded 30 fps renderer reports every
   * player at double pace and they all sprint while standing still.
   */
  speed: number;
  hasBall: boolean;
  highlighted: boolean;
  featured: boolean;
  teamSide: 'home' | 'away';
  /**
   * Kit pattern: 0 plain, 1 vertical stripes, 2 hoops, 3 sash.
   *
   * Two clubs in the same division routinely share a colour, and at a wide
   * framing colour is the only thing telling them apart — so the shirt has to
   * carry a pattern as well. Skipped on figures under nine pixels, where a
   * stripe is just noise.
   */
  kitPattern?: number;
  label?: string;
  labelPlacement?: 'above' | 'below';
  action?: BroadcastPlayerAction;
  actionProgress?: number;
  visualScale?: number;
  orientation?: PitchOrientation;
  /**
   * Goalkeepers wear a third colour, and at a framing where a shirt number
   * is four pixels tall that is the only thing answering which one of these
   * is the keeper. `keeperColor` comes from `keeperKitColor`.
   */
  isKeeper?: boolean;
  keeperColor?: string;
  /** The committed dive, planned in pitch space by `keeperDivePlan`. */
  dive?: KeeperDivePlan;
  /** Where the keeper stands along the pitch width, for resolving the dive. */
  diveWidthFraction?: number;
  /** ...and along its length. */
  lengthFraction?: number;
  /**
   * Where the shot is going, in the same two fractions.
   *
   * Only used to decide which way the body falls. The travel vector cannot
   * answer that: under a touchline camera the goal mouth runs along the depth
   * axis, so a dive across it points almost straight into the lens and
   * foreshortens to a few pixels. The ball can say which side the keeper
   * ended up on; the travel cannot.
   */
  diveTargetWidthFraction?: number;
  diveTargetLengthFraction?: number;
}

/**
 * One footballer, standing on the projected ground.
 *
 * Depth sorting is the caller job: this draws a single figure at whatever
 * scale its ground point reports, and the caller walks the pitch from the far
 * touchline forward so nearer players overlap correctly.
 */
export function drawBroadcastPlayer(
  ctx: CanvasRenderingContext2D,
  options: BroadcastPlayerOptions,
): void {
  const {
    view, ground, color, number, seed, frame, speed,
    hasBall, highlighted, featured, teamSide,
  } = options;
  const orientation = options.orientation ?? 'landscape';
  const labelPlacement = options.labelPlacement ?? 'above';
  const action = options.action;
  const actionProgress = clamp(options.actionProgress ?? 0, 0, 1);
  const visualScale = options.visualScale ?? 1;

  const height = broadcastPlayerHeight(view, ground, visualScale);
  if (height < 2.5) return;

  // Facing arrives in drawing space. Inside the upright group below the local
  // axes are the screen's, so a portrait frame has to turn the vector a
  // quarter turn before any of the body maths reads it.
  const portrait = orientation === 'portrait';
  const rawDirX = portrait ? options.dirY : options.dirX;
  const rawDirY = portrait ? -options.dirX : options.dirY;
  const facingLength = Math.hypot(rawDirX, rawDirY);
  const fx = facingLength > 0.001 ? rawDirX / facingLength : 1;
  const fy = facingLength > 0.001 ? rawDirY / facingLength : 0;
  // 1 when running across the screen, 0 when running straight at or away from
  // the lens. This single number is what narrows the body, and it is the whole
  // reason a figure reads as a person instead of a disc with a highlight.
  const profile = Math.abs(fx);
  const moving = clamp(speed / SPRINT_REFERENCE_SPEED, 0, 1);

  const actionWave = action === 'shot' || action === 'receive'
    ? Math.sin(actionProgress * Math.PI)
    : action
      ? clamp((actionProgress - 0.12) / 0.6, 0, 1)
      : 0;

  const skin = SKIN_TONES[Math.abs(seed) % SKIN_TONES.length];
  const hair = HAIR_TONES[Math.abs(seed * 7 + 3) % HAIR_TONES.length];
  // A keeper in the same shirt as their own back four is a real problem in
  // football and an unreadable one on a screen, so the third colour is not
  // decoration: it is the only cue that survives the wide framing.
  const shirt = options.isKeeper ? (options.keeperColor ?? color) : color;
  const shorts = shadeColor(shirt, -0.55);
  const socks = shadeColor(shirt, -0.2);
  // A shirt that matches the grass is a real problem in football and a worse
  // one on a screen, so the outline carries the separation, not the colour.
  const outline = teamSide === 'home' ? 'rgba(255,255,255,0.58)' : 'rgba(191,219,254,0.74)';

  const shoulderHalf = height * (0.135 + 0.115 * profile);
  const hipHalf = height * (0.105 + 0.065 * profile);
  const headRadius = height * 0.082;
  const footY = ground.y;
  const gx = ground.x;
  const stridePhase = options.stridePhase ?? (frame * STRIDE_RATE_WALK + seed * 1.7);
  const bob = Math.abs(Math.cos(stridePhase)) * height * 0.02 * moving;

  // A dive is planned in pitch space, but under a touchline camera the goal
  // mouth runs almost straight up the frame: a keeper diving across it is
  // moving toward or away from the lens, which foreshortens rather than
  // rotates. So the body is tipped only by the sideways part of the travel,
  // and the rest is carried by the travel itself plus a compressed
  // silhouette. Rotating by the whole vector would stand the keeper on
  // their head the moment they went toward the near post.
  const divePlan = options.dive;
  const dive = (() => {
    if (!divePlan || divePlan.extension <= 0.01) return null;
    const widthFraction = options.diveWidthFraction;
    const lengthFraction = options.lengthFraction;
    if (widthFraction === undefined || lengthFraction === undefined) return null;
    const from = view.at(lengthFraction, widthFraction);
    const to = view.at(lengthFraction, widthFraction + divePlan.travel);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const span = Math.hypot(dx, dy);
    if (span < 0.01) return null;
    const ballWidth = options.diveTargetWidthFraction;
    const ballLength = options.diveTargetLengthFraction;
    const ball = ballWidth !== undefined && ballLength !== undefined
      ? view.at(ballLength, ballWidth)
      : to;
    return {
      dx,
      dy,
      // The body goes over toward the ball, at the angle the dive plan asked
      // for. Deriving the angle from the travel vector instead — which is what
      // this did first — left a keeper diving into the lens lying almost
      // upright, because the only part of that vector with any screen length
      // is the part that is not the dive.
      rotation: (ball.x >= from.x ? 1 : -1) * Math.abs(divePlan.rotation),
      // A body going horizontal presents less height to a low lens.
      squash: 1 - 0.34 * divePlan.extension * (0.4 + divePlan.stretch * 0.6),
      lift: divePlan.lift * height * 0.34,
    };
  })();

  // The legs swing along the screen's x axis, so a player running at or away
  // from the lens has almost none of that motion to show. The torso already
  // narrows by `profile`; without the same factor here the figure reads as a
  // body facing one way with its legs scissoring sideways. What replaces the
  // lost motion is depth: the foot nearer the lens rises in frame.
  const stride = Math.sin(stridePhase);
  let legSwing = stride * height * 0.2 * moving * profile;
  let legDepth = stride * height * 0.13 * moving * (1 - profile);
  let armSwing = -legSwing * 0.7;
  let armRaise = 0;
  let crouch = 0;

  if (action === 'shot') {
    legSwing = fx * height * 0.38 * actionWave + legSwing * (1 - actionWave);
    legDepth *= 1 - actionWave;
    armSwing = -legSwing * 0.55;
  } else if (action === 'save' || action === 'catch') {
    armRaise = actionWave;
    legSwing = legSwing * (1 - actionWave) + height * 0.14 * actionWave;
    legDepth *= 1 - actionWave;
    crouch = actionWave * height * 0.05;
  } else if (action === 'block') {
    legSwing = height * 0.18 * actionWave * (Math.abs(seed) % 2 === 0 ? 1 : -1);
    legDepth = 0;
    armRaise = actionWave * 0.5;
    crouch = actionWave * height * 0.03;
  } else if (action === 'receive') {
    armSwing = -height * 0.16 * actionWave;
    crouch = actionWave * height * 0.035;
  }

  if (dive) {
    // Both arms travel with the ball. A dive with the arms still hanging
    // reads as a player falling over rather than a keeper reaching for
    // something, which is the exact confusion this pose exists to remove.
    //
    // 抬臂要跟 `extension` 一起爬：`travel`/`lift`/`reach`/`rotation` 在
    // keeper-action 里都已经乘过它，只有这里是二值的，于是闸门一开手臂就在一帧
    // 里跳掉三分之一个身高，正好落在全场最被盯着的那一帧。`reach` 本身已含
    // extension，所以满伸时括号里的终值和从前完全一致。
    const extension = divePlan?.extension ?? 0;
    armRaise = Math.max(armRaise, (0.82 + 0.18 * (divePlan?.reach ?? 0)) * extension);
    legSwing *= 0.3;
    legDepth *= 0.3;
    crouch = 0;
  }

  const hipY = footY - height * 0.46 + crouch - bob;
  const shoulderY = footY - height * 0.76 + crouch - bob;
  const headY = footY - height * 0.885 + crouch - bob;
  const lean = fx * height * 0.075 * moving;

  // Everything below is drawn upright. Portrait framing turns the whole
  // drawing space a quarter turn, which would otherwise lay every footballer
  // on their side; the shadow and the ground rings go inside the same group so
  // the figure still reads as standing on the pitch rather than pasted onto it.
  const paint = (): void => {
  // Ground shadow: wider than it is deep, because the light is overhead and
  // the camera is low. A round shadow reads as a figure hovering off the turf.
  // The shadow stays on the turf while the body leaves it, so it tracks the
  // dive and fades as the keeper gets further off the ground.
  const shadowFade = dive ? 1 / (1 + dive.lift / (height * 0.5)) : 1;
  ctx.beginPath();
  ctx.ellipse(
    gx + lean * 0.4 + (dive ? dive.dx : 0),
    footY + (dive ? dive.dy : 0),
    height * 0.2 * shadowFade,
    height * 0.07 * shadowFade,
    0, 0, Math.PI * 2,
  );
  ctx.fillStyle = 'rgba(0,0,0,' + (0.34 * shadowFade).toFixed(3) + ')';
  ctx.fill();

  ctx.save();
  if (dive) {
    ctx.translate(gx + dive.dx, footY + dive.dy - dive.lift);
    ctx.rotate(dive.rotation);
    ctx.scale(1, dive.squash);
    ctx.translate(-gx, -footY);
  }

  const legWidth = Math.max(0.8, height * 0.075);
  const legSpread = hipHalf * 0.55;
  const forwardSign = fx >= 0 ? 1 : -1;
  const drawLeg = (side: number, lateral: number, depth: number, tone: string): void => {
    const hipX = gx + side * legSpread;
    const footX = hipX + lateral;
    // A foot swinging toward the lens rises in frame and one swinging away
    // sinks behind the body. Scaled off the swing itself, because the flat
    // 0.24 this replaces lifted a ten-pixel player's foot 0.16 px — less than
    // the width of the leg it belongs to, so the stride had no vertical half.
    const forwardness = lateral * forwardSign + depth;
    const legFootY = footY - Math.max(0, forwardness) * FOOT_LIFT_RATIO;
    ctx.strokeStyle = tone;
    ctx.lineWidth = legWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(footX, legFootY);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(
      footX + lateral * 0.1,
      legFootY,
      legWidth * 0.7,
      legWidth * 0.42,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = '#11161c';
    ctx.fill();
  };

  drawLeg(-1, -legSwing, -legDepth, shadeColor(socks, -0.3));

  ctx.beginPath();
  ctx.moveTo(gx + lean - hipHalf, hipY - height * 0.11);
  ctx.lineTo(gx + lean + hipHalf, hipY - height * 0.11);
  ctx.lineTo(gx + hipHalf * 0.94, hipY + height * 0.05);
  ctx.lineTo(gx - hipHalf * 0.94, hipY + height * 0.05);
  ctx.closePath();
  ctx.fillStyle = shorts;
  ctx.fill();

  const traceTorso = (): void => {
    ctx.beginPath();
    ctx.moveTo(gx + lean - shoulderHalf, shoulderY);
    ctx.lineTo(gx + lean + shoulderHalf, shoulderY);
    ctx.lineTo(gx + hipHalf, hipY - height * 0.08);
    ctx.lineTo(gx - hipHalf, hipY - height * 0.08);
    ctx.closePath();
  };

  traceTorso();
  ctx.fillStyle = shirt;
  ctx.fill();

  const kit = options.kitPattern ?? 0;
  if (kit > 0 && height >= 9) {
    ctx.save();
    traceTorso();
    ctx.clip();
    ctx.fillStyle = shadeColor(shirt, kit === 2 ? -0.36 : 0.32);
    if (kit === 1) {
      const stripeWidth = Math.max(0.6, shoulderHalf * 0.4);
      for (let index = -2; index <= 2; index += 1) {
        ctx.fillRect(
          gx + lean + index * stripeWidth * 1.75 - stripeWidth / 2,
          shoulderY,
          stripeWidth,
          height,
        );
      }
    } else if (kit === 2) {
      const bandHeight = Math.max(0.6, height * 0.095);
      for (let index = 0; index < 4; index += 1) {
        ctx.fillRect(
          gx - shoulderHalf * 1.8,
          shoulderY + index * bandHeight * 2.1,
          shoulderHalf * 3.6,
          bandHeight,
        );
      }
    } else {
      ctx.translate(gx, (shoulderY + hipY) / 2);
      ctx.rotate(-0.52);
      const bandWidth = Math.max(0.7, shoulderHalf * 0.52);
      for (let index = -2; index <= 2; index += 1) {
        ctx.fillRect(index * bandWidth * 1.9 - bandWidth / 2, -height, bandWidth, height * 2);
      }
    }
    ctx.restore();
  }

  traceTorso();
  ctx.strokeStyle = outline;
  ctx.lineWidth = Math.max(0.4, height * 0.023);
  ctx.stroke();

  drawLeg(1, legSwing, legDepth, socks);

  const armWidth = Math.max(0.7, height * 0.055);
  const armDrop = height * 0.25;
  for (const side of [-1, 1]) {
    const shoulderX = gx + lean + side * shoulderHalf * 0.9;
    const shoulderTopY = shoulderY + height * 0.035;
    let handX = shoulderX + armSwing * 0.6 + side * shoulderHalf * 0.2;
    let handY = shoulderTopY + armDrop;
    if (armRaise > 0) {
      handX = shoulderX
        + side * shoulderHalf * (0.3 + armRaise * 0.55)
        + armSwing * 0.2 * (1 - armRaise);
      handY = shoulderTopY + armDrop * (1 - armRaise) - height * 0.22 * armRaise;
    }
    ctx.strokeStyle = side < 0 ? shadeColor(skin, -0.2) : skin;
    ctx.lineWidth = armWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(shoulderX, shoulderTopY);
    ctx.lineTo(handX, handY);
    ctx.stroke();
  }

  const headX = gx + lean * 1.3;
  ctx.beginPath();
  ctx.arc(headX, headY, headRadius, 0, Math.PI * 2);
  ctx.fillStyle = skin;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(headX, headY - headRadius * 0.24, headRadius * 0.95, Math.PI * 1.04, Math.PI * 1.96);
  ctx.closePath();
  ctx.fillStyle = hair;
  ctx.fill();
  // A brow on the leading side. At a wide framing the head is two pixels
  // across and this is the only thing that says which way a player is looking;
  // without it every figure reads as facing the camera.
  ctx.beginPath();
  ctx.arc(
    headX + fx * headRadius * 0.55,
    headY + fy * headRadius * 0.2,
    Math.max(0.4, headRadius * 0.3),
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = shadeColor(skin, -0.35);
  ctx.fill();

  // The squad number is printed on the shirt, not stuck on as a label: it
  // has to be legible enough to tell two players apart and quiet enough that
  // the eye still goes to the ball first.
  if (height >= 15) {
    const fontSize = Math.max(5, Math.round(height * 0.17));
    ctx.font = 'bold ' + fontSize + 'px sans-serif';
    ctx.textAlign = 'center';
    const numberY = shoulderY + height * 0.2;
    ctx.strokeStyle = 'rgba(2,6,23,0.42)';
    ctx.lineWidth = Math.max(0.5, height * 0.026);
    ctx.strokeText(String(number), gx + lean * 0.6, numberY);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.fillText(String(number), gx + lean * 0.6, numberY);
  }

  ctx.restore();

  if (hasBall) {
    const pulse = 1 + Math.sin(frame * 0.18) * 0.12;
    ctx.beginPath();
    ctx.ellipse(gx, footY, height * 0.3 * pulse, height * 0.105 * pulse, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.62)';
    ctx.lineWidth = Math.max(0.7, height * 0.035);
    ctx.stroke();
  }

  if (highlighted) {
    const pulse = 1 + Math.sin(frame * 0.14) * 0.09;
    ctx.beginPath();
    ctx.ellipse(gx, footY, height * 0.36 * pulse, height * 0.125 * pulse, 0, 0, Math.PI * 2);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = Math.max(0.9, height * 0.042);
    ctx.stroke();
  }

  if (featured) {
    const chevronY = headY - headRadius - height * 0.17;
    ctx.beginPath();
    ctx.moveTo(gx - height * 0.075, chevronY - height * 0.065);
    ctx.lineTo(gx, chevronY + height * 0.03);
    ctx.lineTo(gx + height * 0.075, chevronY - height * 0.065);
    ctx.strokeStyle = 'rgba(251,191,36,0.92)';
    ctx.lineWidth = Math.max(0.9, height * 0.04);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  const label = options.label;
  if (highlighted && label) {
    const below = labelPlacement === 'below'
      || action === 'save' || action === 'catch' || action === 'block';
    const fontSize = clamp(height * 0.62, 7, 11);
    ctx.font = 'bold ' + fontSize.toFixed(1) + 'px sans-serif';
    const textWidth = ctx.measureText(label).width + 6;
    const boxHeight = fontSize + 3;
    const baseline = below
      ? footY + height * 0.16 + boxHeight
      : Math.max(boxHeight + 1, headY - headRadius - height * 0.2);
    const labelX = clamp(gx, textWidth / 2 + 3, view.width - textWidth / 2 - 3);
    ctx.fillStyle = 'rgba(2,6,23,0.78)';
    ctx.fillRect(labelX - textWidth / 2, baseline - boxHeight, textWidth, boxHeight);
    ctx.fillStyle = '#fef3c7';
    ctx.textAlign = 'center';
    ctx.fillText(label, labelX, baseline - 3);
  }
  };

  withUpright(ctx, gx, footY, orientation, paint);
}

export interface BroadcastBallOptions {
  view: BroadcastView;
  /** Ground contact point, already projected. */
  ground: ProjectedPoint;
  /** Flat-drawing vertical lift, from the ball solver. */
  arcLift: number;
  spin: number;
  visualScale?: number;
  orientation?: PitchOrientation;
}

export function drawBroadcastBall(
  ctx: CanvasRenderingContext2D,
  options: BroadcastBallOptions,
): void {
  const { view, ground, arcLift, spin } = options;
  const visualScale = options.visualScale ?? 1;
  const radius = clamp(
    (BALL_DIAMETER_METERS / 2)
      * view.unitsPerMeter
      * ground.scale
      * BALL_EXAGGERATION
      * visualScale,
    MIN_BALL_RADIUS,
    MAX_BALL_RADIUS,
  );
  const lift = view.liftPixels(arcLift, ground.scale);
  const spread = 1 + Math.abs(lift) / (radius * 6);

  // The shadow is a mark on the ground and the lift runs along the screen's
  // vertical axis, so both belong in an upright group: in portrait the drawing
  // space is turned a quarter turn and lifting along drawing -y would throw
  // the ball sideways instead of up.
  withUpright(ctx, ground.x, ground.y, options.orientation ?? 'landscape', () => {
  ctx.beginPath();
  ctx.ellipse(
    ground.x,
    ground.y,
    (radius * 1.25) / spread,
    (radius * 0.5) / spread,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = 'rgba(0,0,0,' + (0.34 / spread).toFixed(3) + ')';
  ctx.fill();

  ctx.save();
  ctx.translate(ground.x, ground.y - lift);

  // The panels turn with the ball.
  ctx.save();
  ctx.rotate(spin * 0.15);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,50,60,0.7)';
  ctx.lineWidth = Math.max(0.35, radius * 0.15);
  ctx.stroke();
  ctx.fillStyle = '#1f2937';
  ctx.beginPath();
  for (let index = 0; index < 5; index++) {
    const angle = (index / 5) * Math.PI * 2 - Math.PI / 2;
    const panelRadius = radius * 0.42;
    const x = Math.cos(angle) * panelRadius;
    const y = Math.sin(angle) * panelRadius;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // The highlight does not. It is the light, not the ball: a specular that
  // orbits with the panels reads as a sixth panel, and once the ball is
  // spinning it stops looking like a sphere at all.
  ctx.beginPath();
  ctx.arc(-radius * 0.3, -radius * 0.3, radius * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fill();
  ctx.restore();
  });
}

export interface BroadcastCelebrationOptions {
  view: BroadcastView;
  celebFrame: number;
  /** Which goal line the ball went into. */
  goalEnd: 0 | 1;
  teamColor: string;
  ballGround: ProjectedPoint;
  ballArcLift: number;
  animFrame: number;
  orientation?: PitchOrientation;
}

/** Goal celebration anchored to the projected goal mouth rather than an edge. */
export function drawBroadcastGoalCelebration(
  ctx: CanvasRenderingContext2D,
  options: BroadcastCelebrationOptions,
): void {
  const { view, celebFrame, goalEnd, teamColor, animFrame } = options;
  const t = 1 - celebFrame / GOAL_CELEB_MAX_FRAMES;
  const teamRgb = hexToRgbStr(teamColor);
  const goldRgb = '250,204,21';
  const mouth = view.at(goalEnd, 0.5);
  const unit = view.unitsPerMeter * mouth.scale;
  // Heights below are measured along the screen vertical, which the upright
  // group establishes; a portrait frame would otherwise lay the bar on its side.
  const barY = mouth.y - GOAL_HEIGHT_METERS * unit;
  const ringX = mouth.x;
  const ringY = (mouth.y + barY) / 2;

  withUpright(ctx, mouth.x, mouth.y, options.orientation ?? 'landscape', () => {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let ring = 0; ring < 2; ring++) {
    const ringT = (t + ring * 0.24) % 1;
    if (ringT > 0.95) continue;
    const radius = unit * (0.6 + ringT * 5.2);
    const alpha = (1 - ringT) * 0.34;
    const ringRgb = ring % 2 === 0 ? goldRgb : teamRgb;
    ctx.beginPath();
    ctx.ellipse(ringX, ringY, radius, radius * 0.78, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(' + ringRgb + ',' + alpha.toFixed(3) + ')';
    ctx.lineWidth = Math.max(1, unit * 0.16 * (1 - ringT * 0.6));
    ctx.stroke();
  }
  const glowAlpha = (1 - t) * 0.62;
  const glowRadius = unit * (1.4 + t * 2.6);
  const glow = ctx.createRadialGradient(ringX, ringY, unit * 0.15, ringX, ringY, glowRadius);
  glow.addColorStop(0, 'rgba(' + goldRgb + ',' + glowAlpha.toFixed(3) + ')');
  glow.addColorStop(0.6, 'rgba(' + teamRgb + ',' + (glowAlpha * 0.5).toFixed(3) + ')');
  glow.addColorStop(1, 'rgba(' + teamRgb + ',0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(ringX, ringY, glowRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Net ripple, walked across the projected mouth so the threads follow the
  // goal instead of hanging off a vertical edge that is no longer there.
  const halfSpan = GOAL_MOUTH_SPAN_METERS / 2 / PITCH_WIDTH_METERS;
  const nearPost = view.at(goalEnd, 0.5 + halfSpan);
  const farPost = view.at(goalEnd, 0.5 - halfSpan);
  const nearTop = nearPost.y - GOAL_HEIGHT_METERS * view.unitsPerMeter * nearPost.scale;
  const farTop = farPost.y - GOAL_HEIGHT_METERS * view.unitsPerMeter * farPost.scale;
  ctx.strokeStyle = 'rgba(' + goldRgb + ',' + ((1 - t) * 0.8).toFixed(3) + ')';
  ctx.lineWidth = Math.max(0.5, unit * 0.06);
  ctx.beginPath();
  for (let row = 1; row < 7; row++) {
    const v = row / 7;
    const wobble = Math.sin(t * 9 + row * 0.7) * unit * 0.28;
    ctx.moveTo(nearPost.x, nearPost.y + (nearTop - nearPost.y) * v + wobble);
    ctx.lineTo(farPost.x, farPost.y + (farTop - farPost.y) * v + wobble);
  }
  for (let column = 1; column < 5; column++) {
    const v = column / 5;
    const x = nearPost.x + (farPost.x - nearPost.x) * v;
    const bottom = nearPost.y + (farPost.y - nearPost.y) * v;
    const top = nearTop + (farTop - nearTop) * v;
    ctx.moveTo(x, bottom);
    ctx.lineTo(x, top);
  }
  ctx.stroke();

  const ball = options.ballGround;
  const ballLift = view.liftPixels(options.ballArcLift, ball.scale);
  const ballGlowRadius = unit * (0.9 + Math.sin(animFrame * 0.3) * 0.22);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const ballGlow = ctx.createRadialGradient(
    ball.x,
    ball.y - ballLift,
    unit * 0.1,
    ball.x,
    ball.y - ballLift,
    ballGlowRadius,
  );
  ballGlow.addColorStop(0, 'rgba(255,235,160,' + ((1 - t) * 0.6).toFixed(3) + ')');
  ballGlow.addColorStop(1, 'rgba(255,235,160,0)');
  ctx.fillStyle = ballGlow;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y - ballLift, ballGlowRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  });
}

/** Impact cue for a non-goal shot, sized against the projected pitch. */
export function drawBroadcastShotOutcome(
  ctx: CanvasRenderingContext2D,
  remainingFrames: number,
  outcome: Exclude<ShotOutcome, 'goal'>,
  target: ProjectedPoint,
  unit: number,
  attackingHome: boolean,
  orientation: PitchOrientation = 'landscape',
): void {
  const progress = 1 - remainingFrames / SHOT_OUTCOME_MAX_FRAMES;
  const alpha = Math.max(0, 1 - progress);
  const scale = clamp(unit / BASE_UNITS_PER_METER, 0.55, 2.6);
  const goalLineX = attackingHome ? target.x - 14 * scale : target.x + 14 * scale;

  withUpright(ctx, target.x, target.y, orientation, () => {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';

  if (outcome === 'save') {
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 3 * scale;
    ctx.beginPath();
    ctx.moveTo(goalLineX, target.y + 6 * scale);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(target.x, target.y, (7 + progress * 7) * scale, 0, Math.PI * 2);
    ctx.lineWidth = 1.5 * scale;
    ctx.stroke();
  } else if (outcome === 'block') {
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2.5 * scale;
    const radius = (5 + progress * 4) * scale;
    ctx.beginPath();
    ctx.moveTo(target.x - radius, target.y - radius);
    ctx.lineTo(target.x + radius, target.y + radius);
    ctx.moveTo(target.x + radius, target.y - radius);
    ctx.lineTo(target.x - radius, target.y + radius);
    ctx.stroke();
  } else {
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.5 * scale;
    ctx.setLineDash([3 * scale, 3 * scale]);
    ctx.beginPath();
    ctx.arc(target.x, target.y, (6 + progress * 10) * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
  });
}

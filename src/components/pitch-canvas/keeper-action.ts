// The goalkeeper dive, derived from facts the simulation already produced.
//
// A save is the most-watched single action in the sport, and it is the moment
// the broadcast exists to show. A keeper who raises both arms and stays on
// their feet reads as a spectator rather than as a save, which is exactly the
// complaint that made this module necessary: at the decisive instant the
// viewer could not tell whether the ball had been stopped.
//
// Everything below comes from two numbers the engine already computed — where
// the shot is going and where the keeper is standing — plus how far through
// the flight the ball is. Nothing here decides whether the save happened. It
// only draws the save that did, including the ones that come up short.
//
// The plan is expressed in pitch space. Under a broadcast camera the goal
// mouth runs along the depth axis, so a keeper diving 'across the goal' moves
// toward or away from the lens rather than left to right; turning that into a
// screen vector is the projection layer's job, not this one.

import { clamp } from './math';

/** Goal mouth width as a fraction of the pitch width: 7.32 m of 68 m. */
export const GOAL_MOUTH_SPAN = 7.32 / 68;

/**
 * How far a keeper can travel across the goal, in mouth widths.
 *
 * A real keeper covers roughly their own height plus a full stretch from a
 * set position — call it 2.6 m of lateral reach inside a 7.32 m goal. The
 * number matters because it is what lets a beaten keeper look beaten: a shot
 * beyond it produces a dive that visibly falls short instead of a save that
 * somehow happened anyway.
 */
export const KEEPER_REACH = 2.6 / 7.32;

/** Inside this the shot is at the keeper and nobody leaves their feet. */
const DEAD_ZONE = 0.06;

/**
 * The keeper does not move until the ball is on its way.
 *
 * This mirrors a rule the physics layer already enforces — the credited
 * keeper reaction is delayed until after the shot leaves the foot — so the
 * drawn dive and the simulated one start at the same instant.
 */
const REACTION_DELAY = 0.18;

/** ...and is fully extended a little before the ball arrives. */
const REACTION_SPAN = 0.52;

/** A full dive is roughly horizontal; this is how far the body tips over. */
const MAX_ROTATION = 1.24;
/** A held save is a catch, not a dive: the keeper stays under the ball. */
const CATCH_MAX_ROTATION = 0.46;

export type KeeperAction = 'save' | 'catch' | 'block';

export interface KeeperDiveInput {
  /** Where the shot is going, as a pitch-width fraction. */
  targetY: number;
  /** Where the keeper is standing, same space. */
  keeperY: number;
  /** 0..1 through the ball's flight. */
  progress: number;
  action: KeeperAction;
  /** Goal mouth span as a width fraction; defaults to the real one. */
  mouthSpan?: number;
}

export interface KeeperDivePlan {
  /** Which way the keeper commits: -1 toward the far touchline, 1 toward the near. */
  direction: -1 | 0 | 1;
  /** 0..1 through the committed dive. */
  extension: number;
  /** Signed travel across the goal, as a pitch-width fraction. */
  travel: number;
  /** 0..1 how far the keeper had to stretch. 1 is the limit of their reach. */
  stretch: number;
  /** 0..1 how far the body leaves the turf. */
  lift: number;
  /** 0..1 arm extension past the body. */
  reach: number;
  /**
   * How far the body goes over, in radians.
   *
   * Magnitude only: which way the keeper falls is a question about where the
   * ball ended up on screen, and the projection layer answers it there.
   */
  rotation: number;
}

export const IDLE_DIVE: KeeperDivePlan = {
  direction: 0,
  extension: 0,
  travel: 0,
  stretch: 0,
  lift: 0,
  reach: 0,
  rotation: 0,
};

/** Smoothstep: a dive accelerates off the mark and then extends. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * The dive one save produces.
 *
 * `progress` is the ball's flight, not the keeper's: the keeper is still set
 * at 0 and only commits once `REACTION_DELAY` has passed, so a shot that is
 * cancelled or held never produces a dive.
 */
export function keeperDivePlan(input: KeeperDiveInput): KeeperDivePlan {
  if (input.action === 'block') return IDLE_DIVE;
  const mouth = input.mouthSpan ?? GOAL_MOUTH_SPAN;
  const gap = input.targetY - input.keeperY;
  const distance = Math.abs(gap) / mouth;
  if (distance < DEAD_ZONE) return IDLE_DIVE;

  const committed = clamp((input.progress - REACTION_DELAY) / REACTION_SPAN, 0, 1);
  if (committed <= 0) return IDLE_DIVE;
  const extension = smoothstep(committed);

  const direction: -1 | 1 = gap > 0 ? 1 : -1;
  // A shot past the reach still produces a full dive — the keeper commits and
  // comes up short, which is what a beaten keeper actually looks like.
  const travel = Math.min(distance, KEEPER_REACH) * mouth;
  const stretch = clamp(distance / KEEPER_REACH, 0, 1);
  const held = input.action === 'catch';
  const maxRotation = held ? CATCH_MAX_ROTATION : MAX_ROTATION;

  return {
    direction,
    extension,
    travel: direction * travel * extension,
    stretch,
    // A held save keeps the keeper on their feet; a full dive takes them off
    // the turf, and further from the centre means lower and longer.
    lift: held ? extension * 0.18 : extension * (0.32 + stretch * 0.5),
    reach: clamp(extension * (held ? 0.7 : 0.55 + stretch * 0.6), 0, 1),
    rotation: direction * maxRotation * (held ? extension : extension * (0.45 + stretch * 0.55)),
  };
}

/**
 * Whether a shot at this width would actually be reachable.
 *
 * Exported so the tests can state the invariant that matters: the plan never
 * travels further than a keeper can, and a shot outside the reach still
 * produces a committed dive rather than nothing at all.
 */
export function keeperCanReach(targetY: number, keeperY: number, mouthSpan = GOAL_MOUTH_SPAN): boolean {
  return Math.abs(targetY - keeperY) / mouthSpan <= KEEPER_REACH;
}

/**
 * How much of the reach a keeper spends on their feet before leaving them.
 *
 * A keeper shuffles across to narrow the angle and dives the rest. Holding a
 * little of the reach back for the dive is what stops the worst case — a shot
 * into the corner — from being met by a keeper already standing on it.
 */
export const KEEPER_SET_MARGIN = 0.9;

/**
 * The share of that reserved reach the dive always has to cover.
 *
 * The floor matters as much as the cap. Defensive shape can walk a keeper to
 * within a stride of where the ball is going, and a keeper already level with
 * the shot has nothing to dive for — the save stops reading as a save, which
 * is the whole complaint. So the set position is clamped from both sides: far
 * enough to leave a dive, close enough that the dive can be made.
 */
export const KEEPER_MIN_DIVE = 0.55;

/**
 * Where a keeper can stand and still reach the ball.
 *
 * A goalkeeper does not slide onto the shot. They set themselves across the
 * goal while it is travelling and dive the remainder, and the dive is drawn
 * from where they are standing. Without this the movement layer walked the
 * keeper all the way onto the target, which left the dive with no distance to
 * cover: every save read as a keeper standing still, which is the exact
 * confusion this module exists to remove.
 *
 * Clamped to the reach, so a save the engine already credited is always one
 * the drawn keeper can actually get to.
 */
export function keeperSetPosition(
  currentY: number,
  targetY: number,
  mouthSpan = GOAL_MOUTH_SPAN,
): number {
  const reach = KEEPER_REACH * mouthSpan * KEEPER_SET_MARGIN;
  const minDive = reach * KEEPER_MIN_DIVE;
  const gap = Math.abs(targetY - currentY);
  if (gap >= minDive && gap <= reach) return currentY;
  // Keep the keeper on the side of the ball they are already on, so setting
  // across never teleports them through it. Level with the shot, they set back
  // toward the middle of the goal, which is where a keeper stands.
  const side = currentY === targetY
    ? (targetY >= 0.5 ? -1 : 1)
    : Math.sign(currentY - targetY);
  return targetY + side * clamp(gap, minDive, reach);
}

function parseHex(hex: string): [number, number, number] | null {
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

function toHex(rgb: [number, number, number]): string {
  return '#' + rgb.map(channel => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0')).join('');
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;
  if (max === rn) hue = ((gn - bn) / delta + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) hue = ((bn - rn) / delta + 2) / 6;
  else hue = ((rn - gn) / delta + 4) / 6;
  return [hue, saturation, lightness];
}

function hslToRgb([hue, saturation, lightness]: [number, number, number]): [number, number, number] {
  if (saturation === 0) {
    const value = lightness * 255;
    return [value, value, value];
  }
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const channel = (offset: number): number => {
    let t = offset;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255];
}

/** Perceptual-ish distance, enough to tell two kits apart on a small figure. */
export function kitColorDistance(a: string, b: string): number {
  const left = parseHex(a);
  const right = parseHex(b);
  if (!left || !right) return 255;
  // Weighted RGB distance: the eye is most sensitive to green, least to blue.
  const dr = left[0] - right[0];
  const dg = left[1] - right[1];
  const db = left[2] - right[2];
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db) / 3;
}

/**
 * A keeper kit that is not either outfield kit.
 *
 * Goalkeepers really do wear a third colour, and on a broadcast figure that is
 * the cheapest possible way to answer 'which one of these is the keeper' at a
 * framing where a shirt number is four pixels tall. The hue is pushed away
 * from the club colour and then checked against both kits, because two clubs
 * in the same division routinely share a colour and a keeper who matches the
 * opposition is worse than no distinction at all.
 */
export function keeperKitColor(teamColor: string, opponentColor: string): string {
  const base = parseHex(teamColor);
  if (!base) return '#7dd3fc';
  const [hue, saturation, lightness] = rgbToHsl(base);
  const candidates = [0.42, 0.58, 0.28, 0.72, 0.14, 0.86];
  let best = '#7dd3fc';
  let bestScore = -1;
  for (const shift of candidates) {
    const candidate = toHex(hslToRgb([
      (hue + shift) % 1,
      clamp(Math.max(saturation, 0.55), 0, 1),
      clamp(lightness < 0.4 ? 0.58 : lightness > 0.72 ? 0.5 : lightness, 0.34, 0.7),
    ]));
    const score = Math.min(
      kitColorDistance(candidate, teamColor),
      kitColorDistance(candidate, opponentColor),
    );
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}
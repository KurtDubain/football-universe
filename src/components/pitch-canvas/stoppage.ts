// A whistle, and the half minute after it.
//
// The renderer already knew how to draw a match being played. What it could
// not draw was a match that had stopped: the ball circulated through a foul
// exactly the way it circulated through anything else, so a half with
// fourteen fouls in it looked identical to a half with none.
//
// Nothing here invents a foul. The count comes from MatchStats by way of the
// routine timeline, which only ever reports what the simulator already
// committed to. This module decides where the whistle went and who walks
// over to have an opinion about it — both of which are staging, and neither
// of which can change a result.

import { seededRand } from './math';
import type { RoutineBeat } from '../match-live/routine-timeline';

/**
 * How long the whistle holds the match, in frames at the 60 fps the canvas
 * runs at. 1.7 s is long enough to read as a stoppage and short enough that a
 * match with twenty fouls does not spend half of itself standing still.
 */
export const STOPPAGE_HOLD_FRAMES = 104;

export interface StoppagePlan {
  key: string;
  /** Where the ball is, dead, in normalized pitch coordinates. */
  spot: { x: number; y: number };
  holdFrames: number;
  /** How far a player can be and still come over, in normalized units. */
  gatherRadius: number;
}

/**
 * The stoppage a routine beat asks for, or null when it asks for none.
 *
 * Only a foul stops play. A corner, a save and a shot off target all happen
 * with the ball in play, and the sequence machinery already stages them.
 */
export function stoppageForBeat(beat: RoutineBeat | null | undefined): StoppagePlan | null {
  if (!beat || beat.kind !== 'foul') return null;
  let seed = 2166136261;
  for (let index = 0; index < beat.id.length; index++) {
    seed ^= beat.id.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  seed >>>= 0;
  return {
    key: beat.id,
    // Fouls happen where the ball is, which is somewhere in the middle of the
    // pitch far more often than it is in a penalty area.
    spot: {
      x: 0.2 + seededRand(seed) * 0.6,
      y: 0.16 + seededRand(seed + 1) * 0.68,
    },
    holdFrames: STOPPAGE_HOLD_FRAMES,
    gatherRadius: 0.13 + seededRand(seed + 2) * 0.04,
  };
}

/**
 * How gathered the crowd is at a given frame.
 *
 * In over the first third, hold, then release across the last quarter so the
 * shape is already coming back when the free kick is taken. Letting it snap
 * at the end read as a glitch rather than as a restart.
 */
export function stoppageGatherProgress(frame: number, holdFrames: number): number {
  if (holdFrames <= 0) return 0;
  const t = frame / holdFrames;
  if (t <= 0 || t >= 1) return 0;
  if (t < 0.34) return t / 0.34;
  if (t > 0.75) return 1 - (t - 0.75) / 0.25;
  return 1;
}

/**
 * Where one player should stand while the whistle is being discussed.
 *
 * Only players who were near enough to have an opinion come over; the rest
 * hold their shape. That is what makes the ones who do come read as a crowd
 * instead of as twenty-two men emptying onto one blade of grass.
 *
 * Returns null when the player should be left alone.
 */
/**
 * The pitch is 105 m across and 68 m deep, so a normalized y step covers less
 * ground than the same step on x. Distances below are measured on x.
 */
const PITCH_ASPECT = 105 / 68;

export function stoppageGatherTarget(
  playerIndex: number,
  playerX: number,
  playerY: number,
  plan: StoppagePlan,
  progress: number,
): { x: number; y: number } | null {
  if (progress <= 0) return null;
  const dx = playerX - plan.spot.x;
  const dy = playerY - plan.spot.y;
  const distance = Math.hypot(dx, dy * PITCH_ASPECT);
  if (distance > plan.gatherRadius) return null;

  // Come in along the ray they are already standing on, so nobody crosses the
  // referee to reach a slot on the far side of him.
  //
  // The target is the larger of a personal standoff and a fixed fraction of
  // where they are. Both halves matter: the standoff keeps a ring of bodies
  // off the ball, and the fraction is what guarantees the move is inward.
  // Placing them on a fixed-radius circle instead — which is what this did
  // first — pushed away anyone already inside that circle, so the players
  // nearest the whistle were the only ones who did not come over.
  const standoff = 0.018 + (playerIndex % 5) * 0.008;
  const targetDistance = Math.max(standoff, distance * 0.45);
  const shrink = distance < 0.0001 ? 1 : targetDistance / distance;
  const gatherX = plan.spot.x + dx * shrink;
  const gatherY = plan.spot.y + dy * shrink;

  // Stop short of the ring. A referee inside a perfect circle of players is a
  // diagram, not a match.
  const pull = Math.min(1, progress) * (0.62 + seededRand(playerIndex * 31 + 7) * 0.24);
  return {
    x: playerX + (gatherX - playerX) * pull,
    y: playerY + (gatherY - playerY) * pull,
  };
}

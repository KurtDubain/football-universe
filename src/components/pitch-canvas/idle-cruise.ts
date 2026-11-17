// What the director does while nothing is being directed.
//
// Between events there is no scene to shoot. The sequence machinery keeps
// the ball circulating, but no event owns the frame, so the moment-driven
// rig falls back to whatever the current phase stage maps to. That means the
// camera sits wherever the play happens to be, cuts only when the stage
// changes, can hold one position for a long stretch, and never once stops
// tracking the ball.
//
// A real broadcast keeps moving in exactly that stretch. It cuts between the
// high camera and the main camera on a cadence of its own, and at least once
// a cycle it locks a camera off and lets the play run through the frame.
// None of that is a new fact about the match — it is the operator filling
// time — so none of it may outrank a directed moment: the cruise yields the
// instant anything is directed, and it leaves the first moment and a half of
// quiet alone so a brief gap between two phases never causes a cut.

import type { CameraRigId } from './projection';

/**
 * Frames of quiet before the director starts moving the camera. 1.5 s at the
 * 60 fps the canvas runs at.
 */
export const IDLE_CRUISE_LEAD_FRAMES = 90;

export interface IdleCruiseShot {
  rigId: CameraRigId;
  /** Frames this shot is held before the director cuts again. */
  holdFrames: number;
  /**
   * Multiplier on how far the camera drifts toward the ball.
   *
   * 1 is the normal operator tracking the play. Well below 1 is a camera
   * that has been locked off: the ball moves through the frame instead of
   * the frame moving with it, which is the one thing the moment-driven rig
   * can never produce.
   */
  followScale: number;
}

/**
 * The cycle, in order.
 *
 * Two cameras only. The `box` rig is a 2.45x lens pointed at a goal, and
 * during a quiet stretch the ball is usually nowhere near one — putting it
 * here would frame an empty penalty area, which is the same mistake
 * `rigForMoment` already refuses to make.
 *
 * The holds are deliberately uneven. An even cadence reads as a metronome
 * within two cycles; 3.5 / 4.2 / 2.8 / 3.8 s does not.
 */
export const IDLE_CRUISE_SCHEDULE: readonly IdleCruiseShot[] = [
  { rigId: 'tactical', holdFrames: 210, followScale: 1 },
  { rigId: 'sideline', holdFrames: 252, followScale: 0.85 },
  { rigId: 'tactical', holdFrames: 168, followScale: 0.3 },
  { rigId: 'sideline', holdFrames: 228, followScale: 1 },
];

/** Frames one full pass through the schedule takes. */
export const IDLE_CRUISE_CYCLE_FRAMES = IDLE_CRUISE_SCHEDULE
  .reduce((total, shot) => total + shot.holdFrames, 0);

export interface IdleCruiseGate {
  /** A directed event scene owns the frame. */
  hasScene: boolean;
  /** A card or substitution beat owns the frame. */
  hasBeat: boolean;
  /** A shot result or a goal celebration is still playing. */
  resultBusy: boolean;
  /** The match is at the interval. */
  halftime: boolean;
}

/**
 * Whether the cruise is allowed to touch the camera at all.
 *
 * Every one of these is something the viewer is meant to be looking at. A
 * cut away from a goal celebration to keep a schedule would be the whole
 * feature working against itself, so the answer is a flat no for all four.
 */
export function isIdleCruiseWindow(gate: IdleCruiseGate): boolean {
  return !gate.hasScene && !gate.hasBeat && !gate.resultBusy && !gate.halftime;
}

/**
 * Which shot the director is on, or `null` while it is still holding off.
 *
 * `idleFrames` counts frames of quiet; `minute` is the match minute the
 * quiet stretch began at, and only rotates which shot the cycle opens on so
 * two stretches in a row do not start on the same camera. It is read once
 * per stretch rather than per frame: rotating on the live clock would
 * reshuffle the cycle underneath a shot that is already being held.
 */
export function idleCruiseShotAt(
  idleFrames: number,
  minute: number,
): IdleCruiseShot | null {
  if (idleFrames <= IDLE_CRUISE_LEAD_FRAMES) return null;
  const count = IDLE_CRUISE_SCHEDULE.length;
  const rotation = ((Math.trunc(minute) % count) + count) % count;
  let offset = (idleFrames - IDLE_CRUISE_LEAD_FRAMES - 1) % IDLE_CRUISE_CYCLE_FRAMES;
  for (let step = 0; step < count; step++) {
    const shot = IDLE_CRUISE_SCHEDULE[(rotation + step) % count];
    if (offset < shot.holdFrames) return shot;
    offset -= shot.holdFrames;
  }
  return IDLE_CRUISE_SCHEDULE[rotation];
}
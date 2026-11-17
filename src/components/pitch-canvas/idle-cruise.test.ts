import { describe, expect, it } from 'vitest';
import {
  IDLE_CRUISE_CYCLE_FRAMES,
  IDLE_CRUISE_LEAD_FRAMES,
  IDLE_CRUISE_SCHEDULE,
  idleCruiseShotAt,
  isIdleCruiseWindow,
} from './idle-cruise';
import { CAMERA_RIGS } from './projection';
import { rigFollowCenterX } from './broadcast-view';

const FPS = 60;
const seconds = (frames: number) => frames / FPS;

const openGate = {
  hasScene: false,
  hasBeat: false,
  resultBusy: false,
  halftime: false,
};

/** Walk the whole cycle from the first frame the cruise is allowed to act. */
function walkCycle(minute = 0): string[] {
  const shots: string[] = [];
  for (let frame = IDLE_CRUISE_LEAD_FRAMES + 1; frame <= IDLE_CRUISE_LEAD_FRAMES + IDLE_CRUISE_CYCLE_FRAMES; frame++) {
    const shot = idleCruiseShotAt(frame, minute);
    const key = shot === null ? 'none' : shot.rigId + ':' + shot.holdFrames;
    if (shots[shots.length - 1] !== key) shots.push(key);
  }
  return shots;
}

describe('idle cruise director', () => {
  it(
    'leaves the camera alone for the first moment and a half of quiet',
    () => {
      expect(idleCruiseShotAt(0, 12)).toBeNull();
      expect(idleCruiseShotAt(IDLE_CRUISE_LEAD_FRAMES, 12)).toBeNull();
      expect(idleCruiseShotAt(IDLE_CRUISE_LEAD_FRAMES + 1, 12)).not.toBeNull();
      expect(seconds(IDLE_CRUISE_LEAD_FRAMES)).toBeCloseTo(1.5, 5);
    },
  );

  it(
    'yields to anything the viewer is meant to be watching',
    () => {
      expect(isIdleCruiseWindow(openGate)).toBe(true);
      expect(isIdleCruiseWindow({ ...openGate, hasScene: true })).toBe(false);
      expect(isIdleCruiseWindow({ ...openGate, hasBeat: true })).toBe(false);
      expect(isIdleCruiseWindow({ ...openGate, resultBusy: true })).toBe(false);
      expect(isIdleCruiseWindow({ ...openGate, halftime: true })).toBe(false);
    },
  );

  it(
    'walks every shot in the schedule and wraps back to the first',
    () => {
      const walked = walkCycle();
      expect(walked).toHaveLength(IDLE_CRUISE_SCHEDULE.length);
      expect(new Set(walked).size).toBe(IDLE_CRUISE_SCHEDULE.length);
      const opening = idleCruiseShotAt(IDLE_CRUISE_LEAD_FRAMES + 1, 0);
      const wrapped = idleCruiseShotAt(
        IDLE_CRUISE_LEAD_FRAMES + IDLE_CRUISE_CYCLE_FRAMES + 1,
        0,
      );
      expect(wrapped).toEqual(opening);
    },
  );

  it(
    'cuts on a cadence a broadcast would recognise',
    () => {
      // These were 2.8-4.2 s, which together with the moment table cutting
      // once per possession produced a cut about every two seconds.
      for (const shot of IDLE_CRUISE_SCHEDULE) {
        expect(seconds(shot.holdFrames)).toBeGreaterThanOrEqual(6);
        expect(seconds(shot.holdFrames)).toBeLessThanOrEqual(12);
      }
      expect(new Set(IDLE_CRUISE_SCHEDULE.map(shot => shot.holdFrames)).size)
        .toBe(IDLE_CRUISE_SCHEDULE.length);
      expect(seconds(IDLE_CRUISE_CYCLE_FRAMES)).toBeGreaterThan(30);
    },
  );

  it(
    'never reaches for the goal lens, which would frame an empty box',
    () => {
      for (const shot of IDLE_CRUISE_SCHEDULE) {
        expect(shot.rigId).not.toBe('box');
        expect(CAMERA_RIGS[shot.rigId]).toBeDefined();
      }
    },
  );

  it(
    'locks a camera off once per cycle so the ball can cross the frame',
    () => {
      const locked = IDLE_CRUISE_SCHEDULE.filter(shot => shot.followScale <= 0.4);
      expect(locked).toHaveLength(1);
      for (const shot of IDLE_CRUISE_SCHEDULE) {
        expect(shot.followScale).toBeGreaterThan(0);
        expect(shot.followScale).toBeLessThanOrEqual(1);
      }
    },
  );

  it(
    'opens consecutive quiet stretches on different cameras',
    () => {
      const openers = [0, 1, 2, 3].map(
        minute => idleCruiseShotAt(IDLE_CRUISE_LEAD_FRAMES + 1, minute)?.rigId,
      );
      expect(new Set(openers).size).toBeGreaterThan(1);
      expect(openers[4 % openers.length]).toBe(openers[0]);
    },
  );

  it(
    'rotates on the minute the quiet began, not the live clock',
    () => {
      const at = (frame: number) => idleCruiseShotAt(frame, 7)?.rigId;
      const held = [1, 60, 120, 200].map(
        offset => at(IDLE_CRUISE_LEAD_FRAMES + offset),
      );
      expect(new Set(held).size).toBe(1);
    },
  );

  it(
    'scales the operator drift without changing the default',
    () => {
      const rig = CAMERA_RIGS.sideline;
      const ball = 0.9;
      const tracked = rigFollowCenterX(rig, ball);
      expect(rigFollowCenterX(rig, ball, 1)).toBe(tracked);
      const locked = rigFollowCenterX(rig, ball, 0.3);
      expect(locked).toBeLessThan(tracked);
      expect(locked).toBeGreaterThan(rig.centerX);
      expect(rigFollowCenterX(rig, ball, 0)).toBe(rig.centerX);
    },
  );
});
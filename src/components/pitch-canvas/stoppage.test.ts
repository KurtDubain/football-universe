import { describe, expect, it } from 'vitest';
import type { RoutineBeat } from '../match-live/routine-timeline';
import {
  STOPPAGE_HOLD_FRAMES,
  stoppageForBeat,
  stoppageGatherProgress,
  stoppageGatherTarget,
} from './stoppage';

function beat(kind: RoutineBeat["kind"], id = 'routine:31:foul:home'): RoutineBeat {
  return { id, minute: 31, kind, teamId: 'home' };
}

describe('stoppage staging', () => {
  it('only a foul stops play', () => {
    expect(stoppageForBeat(beat('foul'))).not.toBeNull();
    expect(stoppageForBeat(beat('corner'))).toBeNull();
    expect(stoppageForBeat(beat('save'))).toBeNull();
    expect(stoppageForBeat(beat('shot_off_target'))).toBeNull();
    expect(stoppageForBeat(null)).toBeNull();
    expect(stoppageForBeat(undefined)).toBeNull();
  });

  it('puts the whistle somewhere on the pitch and keeps it there', () => {
    const plan = stoppageForBeat(beat('foul'))!;
    expect(plan.spot.x).toBeGreaterThanOrEqual(0.2);
    expect(plan.spot.x).toBeLessThanOrEqual(0.8);
    expect(plan.spot.y).toBeGreaterThanOrEqual(0.16);
    expect(plan.spot.y).toBeLessThanOrEqual(0.84);
    expect(plan.holdFrames).toBe(STOPPAGE_HOLD_FRAMES);
    expect(stoppageForBeat(beat('foul'))).toEqual(plan);
  });

  it('gives two different fouls two different places', () => {
    const first = stoppageForBeat(beat('foul', 'routine:12:foul:home'))!;
    const second = stoppageForBeat(beat('foul', 'routine:64:foul:away'))!;
    expect(first.spot).not.toEqual(second.spot);
  });

  it('gathers in, holds, and releases before the free kick', () => {
    const hold = STOPPAGE_HOLD_FRAMES;
    expect(stoppageGatherProgress(0, hold)).toBe(0);
    expect(stoppageGatherProgress(hold, hold)).toBe(0);
    expect(stoppageGatherProgress(hold * 0.17, hold)).toBeCloseTo(0.5, 2);
    expect(stoppageGatherProgress(hold * 0.5, hold)).toBe(1);
    expect(stoppageGatherProgress(hold * 0.875, hold)).toBeCloseTo(0.5, 2);
    expect(stoppageGatherProgress(10, 0)).toBe(0);
  });

  it('never rises above a full gather or falls below none', () => {
    for (let frame = 0; frame <= STOPPAGE_HOLD_FRAMES + 10; frame++) {
      const progress = stoppageGatherProgress(frame, STOPPAGE_HOLD_FRAMES);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    }
  });

  it('leaves players who were too far away alone', () => {
    const plan = stoppageForBeat(beat('foul'))!;
    const far = { x: plan.spot.x > 0.5 ? 0.02 : 0.98, y: plan.spot.y > 0.5 ? 0.05 : 0.95 };
    expect(stoppageGatherTarget(3, far.x, far.y, plan, 1)).toBeNull();
    expect(stoppageGatherTarget(3, far.x, far.y, plan, 0)).toBeNull();
  });

  it('pulls nearby players toward the whistle without stacking them on it', () => {
    const plan = stoppageForBeat(beat('foul'))!;
    const targets: Array<{ x: number; y: number }> = [];
    for (let index = 0; index < 6; index++) {
      const angle = (index / 6) * Math.PI * 2;
      const startX = plan.spot.x + Math.cos(angle) * 0.1;
      const startY = plan.spot.y + Math.sin(angle) * 0.1;
      const target = stoppageGatherTarget(index, startX, startY, plan, 1);
      expect(target).not.toBeNull();
      const before = Math.hypot(startX - plan.spot.x, startY - plan.spot.y);
      const after = Math.hypot(target!.x - plan.spot.x, target!.y - plan.spot.y);
      expect(after).toBeLessThan(before);
      expect(after).toBeGreaterThan(0.004);
      targets.push(target!);
    }
    for (let left = 0; left < targets.length; left++) {
      for (let right = left + 1; right < targets.length; right++) {
        const gap = Math.hypot(targets[left].x - targets[right].x, targets[left].y - targets[right].y);
        expect(gap).toBeGreaterThan(0.005);
      }
    }
  });

  it('gathers nobody while the whistle is still being blown', () => {
    const plan = stoppageForBeat(beat('foul'))!;
    expect(stoppageGatherTarget(1, plan.spot.x + 0.05, plan.spot.y, plan, 0)).toBeNull();
  });
});

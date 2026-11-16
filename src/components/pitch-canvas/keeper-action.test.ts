import { describe, expect, it } from 'vitest';
import {
  GOAL_MOUTH_SPAN,
  IDLE_DIVE,
  KEEPER_REACH,
  keeperCanReach,
  keeperDivePlan,
  keeperSetPosition,
  keeperKitColor,
  kitColorDistance,
} from './keeper-action';

const CENTRE = 0.5;
/** A shot at the edge of the mouth, i.e. right in the corner. */
const CORNER = 0.5 + GOAL_MOUTH_SPAN / 2;

function dive(overrides: Partial<Parameters<typeof keeperDivePlan>[0]> = {}) {
  return keeperDivePlan({
    targetY: CORNER,
    keeperY: CENTRE,
    progress: 1,
    action: 'save',
    ...overrides,
  });
}

describe('keeper dive plan', () => {
  it('commits toward the side the shot is going', () => {
    expect(dive({ targetY: CORNER }).direction).toBe(1);
    expect(dive({ targetY: 0.5 - GOAL_MOUTH_SPAN / 2 }).direction).toBe(-1);
  });

  it('stays set until the ball is actually on its way', () => {
    // The physics layer already refuses to credit a keeper reaction before
    // the shot leaves the foot; the drawn dive has to start at the same
    // instant or a held ball produces a keeper diving at nothing.
    expect(dive({ progress: 0 })).toEqual(IDLE_DIVE);
    expect(dive({ progress: 0.12 }).extension).toBe(0);
    expect(dive({ progress: 1 }).extension).toBeGreaterThan(0.9);
  });

  it('does not leave its feet for a shot straight at the keeper', () => {
    expect(dive({ targetY: CENTRE })).toEqual(IDLE_DIVE);
    expect(dive({ targetY: CENTRE + GOAL_MOUTH_SPAN * 0.02 })).toEqual(IDLE_DIVE);
  });

  it('is not a keeper action at all for a block', () => {
    expect(dive({ action: 'block' })).toEqual(IDLE_DIVE);
  });

  it('never travels further than a keeper can reach', () => {
    const plan = dive({ targetY: 0.5 + GOAL_MOUTH_SPAN * 3 });
    expect(Math.abs(plan.travel)).toBeLessThanOrEqual(KEEPER_REACH * GOAL_MOUTH_SPAN + 1e-9);
  });

  it('still commits at a shot it cannot reach, and comes up short', () => {
    // A beaten keeper has to look beaten. Bailing out to no animation would
    // make an unreachable shot indistinguishable from one that never happened.
    const reachable = dive({ targetY: 0.5 + GOAL_MOUTH_SPAN * 0.3 });
    const unreachable = dive({ targetY: 0.5 + GOAL_MOUTH_SPAN * 2 });
    expect(unreachable.extension).toBeGreaterThan(0.9);
    expect(unreachable.stretch).toBe(1);
    expect(unreachable.travel).toBeGreaterThan(reachable.travel);
    expect(keeperCanReach(0.5 + GOAL_MOUTH_SPAN * 2, CENTRE)).toBe(false);
  });

  it('keeps a held save on its feet and throws a parry at the turf', () => {
    const held = dive({ action: 'catch' });
    const parried = dive({ action: 'save' });
    expect(Math.abs(held.rotation)).toBeLessThan(Math.abs(parried.rotation));
    expect(held.lift).toBeLessThan(parried.lift);
  });

  it('extends further the further it has to go', () => {
    const near = dive({ targetY: 0.5 + GOAL_MOUTH_SPAN * 0.2 });
    const far = dive({ targetY: 0.5 + GOAL_MOUTH_SPAN * 0.45 });
    expect(far.stretch).toBeGreaterThan(near.stretch);
    expect(Math.abs(far.travel)).toBeGreaterThan(Math.abs(near.travel));
    expect(far.reach).toBeGreaterThan(near.reach);
  });

  it('advances monotonically through the flight', () => {
    let previous = 0;
    for (const progress of [0.2, 0.35, 0.5, 0.7, 0.9, 1]) {
      const extension = dive({ progress }).extension;
      expect(extension).toBeGreaterThanOrEqual(previous);
      previous = extension;
    }
    expect(previous).toBeGreaterThan(0.9);
  });
});

describe('keeper set position', () => {
  it('holds station when the shot is already within reach', () => {
    expect(keeperSetPosition(CENTRE, CENTRE + GOAL_MOUTH_SPAN * 0.2)).toBe(CENTRE);
    expect(keeperSetPosition(CENTRE, CENTRE - GOAL_MOUTH_SPAN * 0.2)).toBe(CENTRE);
  });

  it('shuffles across without ever arriving on the ball', () => {
    const target = CENTRE + GOAL_MOUTH_SPAN * 2;
    const set = keeperSetPosition(CENTRE, target);
    expect(set).toBeGreaterThan(CENTRE);
    expect(set).toBeLessThan(target);
  });

  it('always leaves a dive the keeper can actually make', () => {
    // The engine has already credited the save; a drawn keeper who cannot get
    // there would be the animation contradicting the simulation.
    for (const offset of [-3, -1.2, -0.5, -0.25, 0.25, 0.5, 1.2, 3]) {
      const target = CENTRE + GOAL_MOUTH_SPAN * offset;
      const set = keeperSetPosition(CENTRE, target);
      expect(keeperCanReach(target, set)).toBe(true);
      // ...and it is a real dive, not a keeper standing next to the ball.
      expect(Math.abs(target - set) / GOAL_MOUTH_SPAN).toBeGreaterThan(0.1);
    }
  });

  it('backs a keeper off a shot that is coming straight at them', () => {
    // Defensive shape can walk a keeper to within a stride of the target. A
    // keeper already level with the ball has nothing to dive for, so the set
    // position has to open the gap back up rather than merely cap it.
    const target = CENTRE + GOAL_MOUTH_SPAN * 0.1;
    const set = keeperSetPosition(target, target);
    expect(Math.abs(target - set) / GOAL_MOUTH_SPAN).toBeGreaterThan(0.1);
    expect(keeperCanReach(target, set)).toBe(true);
  });

  it('sets back toward the middle of the goal rather than across it', () => {
    const high = CENTRE + GOAL_MOUTH_SPAN * 0.4;
    const low = CENTRE - GOAL_MOUTH_SPAN * 0.4;
    expect(keeperSetPosition(high, high)).toBeLessThan(high);
    expect(keeperSetPosition(low, low)).toBeGreaterThan(low);
  });

  it('is a fixed point, so the keeper does not creep onto the ball frame by frame', () => {
    const target = CENTRE + GOAL_MOUTH_SPAN * 2;
    const once = keeperSetPosition(CENTRE, target);
    expect(keeperSetPosition(once, target)).toBe(once);
  });
});

describe('keeper kit', () => {
  const pairs: Array<[string, string]> = [
    ['#c8102e', '#1a4b9c'],
    ['#ffffff', '#111111'],
    ['#0b5c2e', '#0b5c2e'],
    ['#facc15', '#7c3aed'],
  ];

  it('is never either outfield kit', () => {
    for (const [home, away] of pairs) {
      const keeper = keeperKitColor(home, away);
      expect(kitColorDistance(keeper, home)).toBeGreaterThan(45);
      expect(kitColorDistance(keeper, away)).toBeGreaterThan(45);
    }
  });

  it('is deterministic, so a keeper does not change colour between frames', () => {
    expect(keeperKitColor('#c8102e', '#1a4b9c')).toBe(keeperKitColor('#c8102e', '#1a4b9c'));
  });

  it('falls back to a readable colour when the kit is not a hex', () => {
    expect(keeperKitColor('rebeccapurple', '#1a4b9c')).toBe('#7dd3fc');
  });
});
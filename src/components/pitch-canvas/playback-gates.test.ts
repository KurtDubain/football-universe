import { describe, expect, it } from 'vitest';
import { isWaitingForEvent, shouldHoldClock } from './playback-gates';

const SCENE = {
  active: true,
  hasScene: true,
  hasActivePhase: true,
  resultBusy: false,
  nextPhaseIsShot: true,
  impactFired: false,
};

describe('shouldHoldClock', () => {
  it('holds from the event minute onward', () => {
    expect(shouldHoldClock({ ...SCENE, eventMinute: 45, minute: 44 })).toBe(false);
    expect(shouldHoldClock({ ...SCENE, eventMinute: 45, minute: 45 })).toBe(true);
    expect(shouldHoldClock({ ...SCENE, eventMinute: 45, minute: 46 })).toBe(true);
  });

  it('holds for a result that is still playing without a directed phase', () => {
    expect(shouldHoldClock({
      ...SCENE, hasActivePhase: false, resultBusy: true, eventMinute: 45, minute: 45,
    })).toBe(true);
  });

  it('does not hold with nothing playing, no scene, or an idle clock', () => {
    expect(shouldHoldClock({
      ...SCENE, hasActivePhase: false, resultBusy: false, eventMinute: 45, minute: 45,
    })).toBe(false);
    expect(shouldHoldClock({ ...SCENE, hasScene: false, eventMinute: 45, minute: 45 }))
      .toBe(false);
    expect(shouldHoldClock({ ...SCENE, active: false, eventMinute: 45, minute: 45 }))
      .toBe(false);
  });
});

describe('isWaitingForEvent', () => {
  it('waits strictly before the event minute', () => {
    expect(isWaitingForEvent({ ...SCENE, eventMinute: 45, minute: 44 })).toBe(true);
  });

  it('stops waiting at the event minute itself', () => {
    expect(isWaitingForEvent({ ...SCENE, eventMinute: 45, minute: 45 })).toBe(false);
  });

  it('stops waiting once the impact has fired', () => {
    expect(isWaitingForEvent({ ...SCENE, eventMinute: 45, minute: 44, impactFired: true }))
      .toBe(false);
  });

  it('does not wait when the next phase is not a shot', () => {
    expect(isWaitingForEvent({ ...SCENE, nextPhaseIsShot: false, eventMinute: 45, minute: 44 }))
      .toBe(false);
  });
});

describe('the two gates together', () => {
  it('never both true — this is the deadlock carried through v4.65 and v4.66', () => {
    for (let minute = 0; minute <= 130; minute += 1) {
      for (const eventMinute of [0, 1, 45, 90, 120]) {
        for (const impactFired of [false, true]) {
          const hold = shouldHoldClock({ ...SCENE, eventMinute, minute });
          const wait = isWaitingForEvent({ ...SCENE, eventMinute, minute, impactFired });
          expect(
            hold && wait,
            `minute=${minute} eventMinute=${eventMinute} impactFired=${impactFired}`,
          ).toBe(false);
        }
      }
    }
  });
});
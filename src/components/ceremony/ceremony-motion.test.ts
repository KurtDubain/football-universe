import { describe, expect, it } from 'vitest';
import { ceremonySettle, ceremonyTiming } from './ceremony-motion';
import { CEREMONY_DURATION, CEREMONY_HOLDS, type CeremonyKind } from './ceremony-types';

const KINDS: CeremonyKind[] = [
  'cup_stamp',
  'season_opening',
  'season_closing',
  'world_cup_opening',
  'world_cup_closing',
];

describe('ceremonyTiming', () => {
  it('lets a stamp pass on its own and makes every page wait to be turned', () => {
    for (const kind of KINDS) {
      const timing = ceremonyTiming(kind, false);
      expect(timing.autoDismiss === null).toBe(CEREMONY_HOLDS[kind]);
    }
  });

  it('gives a stamp exactly its budgeted duration, reduced motion included', () => {
    for (const reducedMotion of [false, true]) {
      const timing = ceremonyTiming('cup_stamp', reducedMotion);
      expect(timing.autoDismiss).not.toBeNull();
      expect(ceremonySettle(timing, 1) + (timing.autoDismiss ?? 0))
        .toBe(CEREMONY_DURATION.cup_stamp);
    }
  });

  it('drops the travel but keeps the page readable under reduced motion', () => {
    for (const kind of KINDS) {
      const full = ceremonyTiming(kind, false);
      const reduced = ceremonyTiming(kind, true);
      expect(reduced.lead).toBe(0);
      expect(reduced.stagger).toBe(0);
      expect(reduced.tail).toBeGreaterThan(0);
      expect(reduced.tail).toBeLessThan(full.tail);
    }
  });

  it('never sets a page that outruns its own budget', () => {
    for (const kind of KINDS) {
      const timing = ceremonyTiming(kind, false);
      expect(ceremonySettle(timing, 1)).toBeLessThanOrEqual(CEREMONY_DURATION[kind]);
    }
  });

  it('lengthens a page with its line count and never shortens it', () => {
    const timing = ceremonyTiming('season_closing', false);
    const one = ceremonySettle(timing, 1);
    const four = ceremonySettle(timing, 4);
    expect(four).toBeGreaterThan(one);
    expect(ceremonySettle(timing, 0)).toBe(one);
  });
});

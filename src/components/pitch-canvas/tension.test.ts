import { describe, expect, it } from 'vitest';
import { clockStakes, matchTension, scoreStakes } from './tension';

function tension(overrides: Partial<Parameters<typeof matchTension>[0]> = {}) {
  return matchTension({ danger: 0.5, minute: 45, homeScore: 0, awayScore: 0, ...overrides });
}

describe('score stakes', () => {
  it('treats a level game and a one-goal game as equally alive', () => {
    expect(scoreStakes(0, 0)).toBe(1);
    expect(scoreStakes(1, 0)).toBe(1);
    expect(scoreStakes(2, 1)).toBe(1);
  });

  it('falls away once the result stops being in doubt', () => {
    expect(scoreStakes(2, 0)).toBeLessThan(scoreStakes(1, 0));
    expect(scoreStakes(3, 0)).toBeLessThan(scoreStakes(2, 0));
    expect(scoreStakes(5, 0)).toBeLessThan(scoreStakes(3, 0));
  });
});

describe('clock stakes', () => {
  it('rises across the match and pins at full time', () => {
    expect(clockStakes(0)).toBeLessThan(clockStakes(45));
    expect(clockStakes(45)).toBeLessThan(clockStakes(80));
    expect(clockStakes(90)).toBeCloseTo(1, 5);
    expect(clockStakes(120, 90)).toBe(1);
  });

  it('keeps the first half quiet', () => {
    expect(clockStakes(20)).toBeLessThan(0.35);
  });
});

describe('match tension', () => {
  it('stays inside 0..1 for every combination it can be handed', () => {
    for (const danger of [0, 0.5, 1]) {
      for (const minute of [0, 45, 90, 130]) {
        for (const [home, away] of [[0, 0], [3, 0], [1, 1], [7, 2]]) {
          const value = tension({ danger, minute, homeScore: home, awayScore: away });
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('rises with danger at every scoreline', () => {
    for (const [home, away] of [[0, 0], [2, 0], [4, 1]]) {
      const calm = tension({ danger: 0.1, homeScore: home, awayScore: away });
      const loud = tension({ danger: 0.9, homeScore: home, awayScore: away });
      expect(loud).toBeGreaterThan(calm);
    }
  });

  it('separates a late level game from an early walkover at the same danger', () => {
    // This is the whole point: `danger` alone rates these two identically,
    // and they are not the same moment.
    const lateLevel = tension({ danger: 0.9, minute: 88, homeScore: 1, awayScore: 1 });
    const earlyBlowout = tension({ danger: 0.9, minute: 20, homeScore: 3, awayScore: 0 });
    expect(lateLevel).toBeGreaterThan(earlyBlowout + 0.3);
    expect(lateLevel).toBeGreaterThan(0.95);
  });

  it('reads a goalless last ten minutes as loaded even with the ball in midfield', () => {
    const late = tension({ danger: 0.1, minute: 85, homeScore: 0, awayScore: 0 });
    const early = tension({ danger: 0.1, minute: 15, homeScore: 0, awayScore: 0 });
    expect(late).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(0.25);
  });

  it('leaves a settled early match alone', () => {
    expect(tension({ danger: 0.1, minute: 20, homeScore: 3, awayScore: 0 })).toBeLessThan(0.15);
  });
});
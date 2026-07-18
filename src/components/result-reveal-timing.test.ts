import { describe, expect, it } from 'vitest';
import { getDramaticRevealDelay, getOrdinaryRevealPlan } from './result-reveal-timing';

describe('result reveal timing', () => {
  it.each([6, 12, 48])('keeps %i ordinary results near one second', (count) => {
    const plan = getOrdinaryRevealPlan(count);
    expect(plan.totalMs).toBeGreaterThanOrEqual(900);
    expect(plan.totalMs).toBeLessThanOrEqual(1100);
    expect(Math.ceil(count / plan.step)).toBeLessThanOrEqual(10);
  });

  it('reserves longer sequential pauses for important matches', () => {
    expect(getDramaticRevealDelay(1)).toBe(0);
    expect(getDramaticRevealDelay(2)).toBe(400);
    expect(getDramaticRevealDelay(3)).toBe(600);
  });
});

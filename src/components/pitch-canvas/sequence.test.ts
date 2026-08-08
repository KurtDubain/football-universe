import { describe, expect, it } from 'vitest';
import { buildPassTarget, generateSequence } from './sequence';

describe('pitch possession sequences', () => {
  it('creates deterministic, bounded receiving points rather than fixed formation coordinates', () => {
    const first = buildPassTarget(9, true, 0.82, false);
    const repeat = buildPassTarget(9, true, 0.82, false);

    expect(first).toEqual(repeat);
    expect(first.x).toBeGreaterThan(0.55);
    expect(first.x).toBeLessThanOrEqual(0.94);
    expect(first.y).toBeGreaterThanOrEqual(0.09);
    expect(first.y).toBeLessThanOrEqual(0.91);
  });

  it('mirrors forward movement for the away side', () => {
    const home = buildPassTarget(9, true, 0.6, true);
    const away = buildPassTarget(9, false, 0.6, true);

    expect(home.x).toBeGreaterThan(0.55);
    expect(away.x).toBeLessThan(0.45);
  });

  it('gives every open-play pass a concrete receiving run', () => {
    const sequence = generateSequence(20260808, { attackingHome: true });
    const passes = sequence.phases.filter(phase => phase.kind === 'pass');

    expect(passes.length).toBeGreaterThan(0);
    expect(passes.every(phase => phase.targetOverride !== undefined)).toBe(true);
  });
});

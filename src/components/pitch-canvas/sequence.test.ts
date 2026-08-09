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

  it('uses coherent tactical episodes without inventing ordinary shots', () => {
    const patterns = new Set<string>();
    for (let seed = 1; seed <= 80; seed++) {
      const sequence = generateSequence(seed, { attackingHome: true });
      const episodePatterns = new Set(sequence.phases.map(phase => phase.pattern));
      sequence.phases.forEach(phase => phase.pattern && patterns.add(phase.pattern));

      expect(sequence.endsInShot).toBe(false);
      expect(sequence.phases.every(phase => phase.kind === 'pass')).toBe(true);
      expect(episodePatterns.size).toBe(1);
      expect(sequence.phases.every(phase => phase.stage !== undefined)).toBe(true);
    }

    expect(patterns).toEqual(new Set([
      'build_up',
      'wing_overload',
      'central_combination',
      'switch_play',
      'recycle',
    ]));
  });

  it('marks a turnover as a short counter while preserving the ball source', () => {
    const source = { x: 0.47, y: 0.24 };
    const sequence = generateSequence(91, {
      attackingHome: true,
      startingPlayerIdx: 6,
      sourceOverride: source,
      transition: true,
    });

    expect(sequence.phases[0]).toMatchObject({
      passerIdx: 6,
      pattern: 'counter',
      stage: 'transition',
      sourceOverride: source,
    });
    expect(sequence.phases.every(phase => phase.pattern === 'counter')).toBe(true);
  });

  it('progresses toward goal unless the episode explicitly recycles possession', () => {
    for (let seed = 1; seed <= 80; seed++) {
      const sequence = generateSequence(seed, { attackingHome: true });
      if (sequence.phases[0]?.pattern === 'recycle') continue;
      const targets = sequence.phases.map(phase => phase.targetOverride!.x);
      expect(targets.every((target, index) => index === 0 || target >= targets[index - 1] - 0.025)).toBe(true);
    }
  });
});

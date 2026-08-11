import { describe, expect, it } from 'vitest';
import type { MatchApproach } from '../../types/coach';
import { counterOriginChance, generateMatchEvents } from './events';
import { SeededRNG } from './rng';

function countCounterGoals(approach: MatchApproach): number {
  let counters = 0;
  for (let seed = 1; seed <= 160; seed++) {
    const events = generateMatchEvents(
      4,
      0,
      'home',
      'away',
      'league',
      new SeededRNG(seed),
      false,
      undefined,
      undefined,
      undefined,
      0,
      0,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      'regulation',
      { home: approach, away: 'balanced' },
    );
    counters += events.filter(event => event.type === 'goal' && event.playOrigin === 'counter').length;
  }
  return counters;
}

describe('tactical event origins', () => {
  it('keeps every approach bounded while making counter identities visible', () => {
    expect(counterOriginChance('control')).toBeLessThan(counterOriginChance('balanced'));
    expect(counterOriginChance('counter')).toBeGreaterThan(counterOriginChance('low_block'));
    for (const approach of ['pressing', 'control', 'balanced', 'counter', 'low_block'] as const) {
      expect(counterOriginChance(approach)).toBeGreaterThanOrEqual(0.05);
      expect(counterOriginChance(approach)).toBeLessThanOrEqual(0.35);
    }
  });

  it('changes chance provenance without changing the supplied score', () => {
    const counterGoals = countCounterGoals('counter');
    const controlGoals = countCounterGoals('control');

    expect(counterGoals).toBeGreaterThan(controlGoals * 2);
    expect(counterGoals).toBeLessThan(4 * 160);
  });
});

import { describe, expect, it } from 'vitest';
import { SeededRNG } from './rng';
import { simulatePenaltyShootout } from './penalty-shootout';

describe('simulatePenaltyShootout', () => {
  it('produces a legal alternating sequence whose events reconcile to the score', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const result = simulatePenaltyShootout(new SeededRNG(seed));
      expect(result.homeScore).not.toBe(result.awayScore);
      expect(result.kicks.filter(kick => kick.team === 'home' && kick.outcome === 'scored')).toHaveLength(result.homeScore);
      expect(result.kicks.filter(kick => kick.team === 'away' && kick.outcome === 'scored')).toHaveLength(result.awayScore);
      expect(result.kicks.every((kick, index) => kick.kickNumber === index + 1)).toBe(true);
      expect(result.kicks.every((kick, index) => kick.team === (index % 2 === 0 ? 'home' : 'away'))).toBe(true);
    }
  });

  it('stops the initial series once the trailing side cannot recover', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const result = simulatePenaltyShootout(new SeededRNG(seed));
      if (result.kicks.some(kick => kick.suddenDeath)) continue;
      expect(result.kicks.length).toBeLessThanOrEqual(10);
      const homeTaken = result.kicks.filter(kick => kick.team === 'home').length;
      const awayTaken = result.kicks.filter(kick => kick.team === 'away').length;
      const homeUncatchable = result.homeScore > result.awayScore + (5 - awayTaken);
      const awayUncatchable = result.awayScore > result.homeScore + (5 - homeTaken);
      expect(homeUncatchable || awayUncatchable).toBe(true);
    }
  });

  it('marks only kicks after the initial five rounds as sudden death', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const result = simulatePenaltyShootout(new SeededRNG(seed));
      expect(result.kicks.every(kick => kick.suddenDeath === (kick.round > 5))).toBe(true);
    }
  });
});

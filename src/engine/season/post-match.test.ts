import { describe, expect, it } from 'vitest';
import type { MatchResult } from '../../types/match';
import { formatWinnerPerspectiveScore } from './post-match';

const result = {
  homeGoals: 2,
  awayGoals: 3,
  etHomeGoals: 0,
  etAwayGoals: 1,
} as MatchResult;

describe('post-match narrative formatting', () => {
  it('prints the score from the named winner perspective', () => {
    expect(formatWinnerPerspectiveScore(result, false)).toBe('4-2');
    expect(formatWinnerPerspectiveScore({ ...result, homeGoals: 4, awayGoals: 1 }, true)).toBe('4-2');
  });
});

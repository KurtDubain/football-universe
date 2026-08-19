import { describe, expect, it } from 'vitest';
import { shouldCelebrate } from './celebration-logic';

describe('advance celebration hierarchy', () => {
  it('uses a restrained transition for an ordinary matchday', () => {
    expect(shouldCelebrate('league', '第 8 轮', [
      { competitionType: 'league', roundLabel: '第 8 轮' },
    ])).toBe('transition');
  });

  it('marks knockout progression with streamers without implying a trophy', () => {
    expect(shouldCelebrate('world_cup', '八强', [
      { competitionType: 'world_cup', roundLabel: '八强' },
    ])).toBe('streamers');
  });

  it('reserves confetti and fireworks for structural season moments', () => {
    expect(shouldCelebrate('relegation_playoff', '升降级附加赛', [])).toBe('confetti');
    expect(shouldCelebrate('season_end', '赛季结算', [])).toBe('fireworks');
  });

  it('keeps the trophy treatment exclusive to a completed final', () => {
    expect(shouldCelebrate('league_cup', '决赛', [
      { competitionType: 'league_cup', roundLabel: '决赛' },
    ])).toBe('trophy');
  });
});

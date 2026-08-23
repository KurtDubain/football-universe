import { describe, expect, it } from 'vitest';
import { getMatchTags, shouldCelebrate } from './celebration-logic';

describe('advance celebration hierarchy', () => {
  it('keeps ordinary matchdays inside the dashboard instead of covering the screen', () => {
    expect(shouldCelebrate('league', '第 8 轮', [
      { competitionType: 'league', roundLabel: '第 8 轮' },
    ])).toBeNull();
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

  it('marks configured group-stage finales without using the old six-round World Cup rule', () => {
    expect(getMatchTags('world_cup_group', 'Group A - R3', 'a', 'b')).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '小组收官' }),
    ]));
    expect(getMatchTags('world_cup_group', 'Group A - R2', 'a', 'b')).toEqual([]);
    expect(getMatchTags('super_cup_group', 'Group A - R6', 'a', 'b')).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '小组收官' }),
    ]));
  });

  it('uses restrained streamers when a group stage produces its knockout field', () => {
    expect(shouldCelebrate('world_cup_group', '环球冠军杯 小组赛R3', [])).toBe('streamers');
    expect(shouldCelebrate('continental_cup', '洲际杯 小组赛 R3', [])).toBe('streamers');
    expect(shouldCelebrate('super_cup_group', '超级杯 小组赛第6轮', [])).toBe('streamers');
    expect(shouldCelebrate('world_cup_group', '环球冠军杯 小组赛R2', [])).toBeNull();
  });

  it('uses the shared knockout labels for fixture tags', () => {
    expect(getMatchTags('league_cup', 'R16', 'a', 'b')[0]?.label).toBe('16强');
    expect(getMatchTags('world_cup', '八强', 'a', 'b')[0]?.label).toBe('八强');
    expect(getMatchTags('world_cup', '四强', 'a', 'b')[0]?.label).toBe('四强');
  });
});

import { describe, expect, it } from 'vitest';
import type { NewsItem } from '../engine/season/season-manager';
import { worldMomentKindForNews } from './world-moment';

function news(type: NewsItem['type'], title: string, importance: NewsItem['importance'] = 'major'): NewsItem {
  return {
    id: `${type}-${title}`,
    seasonNumber: 4,
    windowIndex: 2,
    type,
    importance,
    title,
    description: '测试事件说明',
  };
}

describe('world moment artwork selection', () => {
  it('prioritizes the tournament stage vocabulary over the generic event type', () => {
    expect(worldMomentKindForNews(news('storyline', '洲际杯抽签完成'))).toBe('stage');
    expect(worldMomentKindForNews(news('trophy', '环球冠军杯决赛舞台落定'))).toBe('stage');
  });

  it('maps rise, fall, legacy, and transfer moments to distinct visual families', () => {
    expect(worldMomentKindForNews(news('promotion', '升级奇迹'))).toBe('rise');
    expect(worldMomentKindForNews(news('coach_fired', '主帅离任'))).toBe('fall');
    expect(worldMomentKindForNews(news('retirement', '传奇谢幕'))).toBe('legacy');
    expect(worldMomentKindForNews(news('rumor', '谈判进入深夜'))).toBe('transfer');
  });

  it('keeps routine informational events text-only', () => {
    expect(worldMomentKindForNews(news('match_result', '普通联赛结果'))).toBeNull();
    expect(worldMomentKindForNews(news('prize_money', '普通奖金到账'))).toBeNull();
    expect(worldMomentKindForNews(news('injury', '轻伤缺席', 'normal'))).toBeNull();
    expect(worldMomentKindForNews(news('injury', '核心长期伤停', 'major'))).toBe('fall');
  });
});

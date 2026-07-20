import { describe, expect, it } from 'vitest';
import type { NewsItem } from './season-manager';
import { curateNewsFeed, getNewsTier } from './news-feed';

function news(id: string, type: NewsItem['type'], title: string, description = ''): NewsItem {
  return { id, type, title, description, seasonNumber: 2, windowIndex: 8 };
}

describe('news feed curation', () => {
  it('puts major stories ahead of routine notices', () => {
    const curated = curateNewsFeed([
      news('result', 'match_result', '普通赛程播报'),
      news('injury', 'injury', '核心伤停'),
      news('title', 'trophy', '大陆杯冠军诞生'),
    ]);
    expect(curated.map(item => item.id)).toEqual(['title', 'injury', 'result']);
    expect(getNewsTier(curated[0])).toBe('headline');
  });

  it('deduplicates repeated titles and keeps the newest version', () => {
    const curated = curateNewsFeed([
      news('old', 'streak', '北城五连胜', '旧描述'),
      news('new', 'streak', '北城五连胜', '新描述'),
    ]);
    expect(curated).toHaveLength(1);
    expect(curated[0].id).toBe('new');
  });

  it('promotes followed-club stories and respects the feed limit', () => {
    const curated = curateNewsFeed([
      news('other', 'injury', '南城核心伤停'),
      news('favorite', 'streak', '北城五连胜'),
      news('routine', 'match_result', '普通播报'),
    ], { favoriteTeamNames: ['北城'], limit: 2 });
    expect(curated.map(item => item.id)).toEqual(['favorite', 'other']);
  });

  it('keeps major championships ahead of routine trophy-shaped notices', () => {
    const champion = { ...news('champion', 'trophy', '大陆杯冠军诞生'), importance: 'major' as const };
    const achievement = { ...news('achievement', 'trophy', '北城解锁成就: 钢铁防线'), importance: 'minor' as const };

    expect(curateNewsFeed([champion, achievement]).map(item => item.id)).toEqual(['champion', 'achievement']);
    expect(getNewsTier(achievement)).toBe('notable');
  });

  it('recognizes short-name aliases in qualification news', () => {
    const qualification = { ...news('draw', 'match_result', '大陆杯资格揭晓', '楚门(#3)入围'), importance: 'major' as const };
    expect(getNewsTier(qualification, ['楚门世界', '楚门'])).toBe('headline');
  });
});

import type { NewsItem } from './season-manager';

export type NewsTier = 'headline' | 'notable' | 'brief';

const TYPE_PRIORITY: Record<NewsItem['type'], number> = {
  trophy: 100,
  promotion: 92,
  relegation: 92,
  coach_fired: 84,
  coach_hired: 80,
  upset: 76,
  retirement: 68,
  injury: 66,
  fire_sale: 64,
  streak: 56,
  rumor: 48,
  prize_money: 36,
  match_result: 30,
};

function normalizedTitle(item: NewsItem): string {
  return `${item.type}:${item.title.replace(/[\s—·:：,，。]/g, '').toLowerCase()}`;
}

function mentionsFavorite(item: NewsItem, favoriteTeamNames: string[]): boolean {
  if (favoriteTeamNames.length === 0) return false;
  const text = `${item.title}${item.description}`;
  return favoriteTeamNames.some(name => name.length > 0 && text.includes(name));
}

export function getNewsTier(item: NewsItem, favoriteTeamNames: string[] = []): NewsTier {
  const priority = (TYPE_PRIORITY[item.type] ?? 0) + (mentionsFavorite(item, favoriteTeamNames) ? 18 : 0);
  if (priority >= 76) return 'headline';
  if (priority >= 48) return 'notable';
  return 'brief';
}

export function curateNewsFeed(
  news: NewsItem[],
  options: { favoriteTeamNames?: string[]; limit?: number } = {},
): NewsItem[] {
  const favoriteTeamNames = options.favoriteTeamNames ?? [];
  const limit = options.limit ?? 8;
  const seen = new Set<string>();

  return news
    .map((item, index) => ({ item, index }))
    .reverse()
    .filter(({ item }) => {
      const key = normalizedTitle(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const aScore = (TYPE_PRIORITY[a.item.type] ?? 0) + (mentionsFavorite(a.item, favoriteTeamNames) ? 18 : 0);
      const bScore = (TYPE_PRIORITY[b.item.type] ?? 0) + (mentionsFavorite(b.item, favoriteTeamNames) ? 18 : 0);
      return bScore - aScore || b.index - a.index;
    })
    .slice(0, Math.max(0, limit))
    .map(({ item }) => item);
}

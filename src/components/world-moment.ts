import type { NewsItem } from '../engine/season/season-manager';

export type WorldMomentKind = 'stage' | 'rise' | 'fall' | 'legacy' | 'transfer';

const STAGE_PATTERN = /环球|世界|洲际|大洲|抽签|分组|淘汰赛|决赛舞台/;
const FALL_PATTERN = /危机|失速|保级压力|降级|连败|下课|解雇|崩盘|动荡/;

export function worldMomentKindForNews(news: NewsItem): WorldMomentKind | null {
  const searchable = `${news.title}${news.description}`;
  if (STAGE_PATTERN.test(searchable)) return 'stage';

  switch (news.type) {
    case 'trophy':
    case 'promotion':
    case 'upset':
    case 'streak':
      return 'rise';
    case 'relegation':
    case 'coach_fired':
    case 'fire_sale':
      return 'fall';
    case 'retirement':
      return 'legacy';
    case 'rumor':
    case 'coach_hired':
      return 'transfer';
    case 'storyline':
      return FALL_PATTERN.test(searchable) ? 'fall' : 'rise';
    case 'injury':
      return news.importance === 'major' ? 'fall' : null;
    default:
      return null;
  }
}

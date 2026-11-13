import type { PlayerPosition } from '../types/player';

/** Second-level ranking tabs. All ten keys stay stable across the redesign. */
export type RankingTab =
  | 'overall'
  | 'scorers'
  | 'assists'
  | 'creation'
  | 'forwards'
  | 'defense'
  | 'keepers'
  | 'discipline'
  | 'careerScorers'
  | 'careerAssists';

/** First-level groups. `position` was removed: its boards read current-season data too. */
export type RankingGroup = 'season' | 'career' | 'awards';
export type PositionFilter = 'all' | PlayerPosition;

export const RANKING_GROUPS: readonly RankingGroup[] = ['season', 'career', 'awards'];

export const RANKING_GROUP_OPTIONS: readonly { value: RankingGroup; label: string }[] = [
  { value: 'season', label: '本季' },
  { value: 'career', label: '生涯' },
  { value: 'awards', label: '奖项' },
];

/** Only groups with a second level; `awards` carries its own view switcher. */
export const TABS_BY_GROUP: Record<'season' | 'career', readonly { key: RankingTab; label: string }[]> = {
  season: [
    { key: 'overall', label: '综合' },
    { key: 'scorers', label: '射手' },
    { key: 'assists', label: '助攻' },
    { key: 'creation', label: '创造力' },
    { key: 'forwards', label: '前锋' },
    { key: 'defense', label: '防守' },
    { key: 'keepers', label: '门将' },
    { key: 'discipline', label: '纪律' },
  ],
  career: [
    { key: 'careerScorers', label: '生涯射手' },
    { key: 'careerAssists', label: '生涯助攻' },
  ],
};

/** Boards that mix positions, so a position filter is meaningful. */
export const MIXED_POSITION_TABS: readonly RankingTab[] = [
  'overall',
  'scorers',
  'assists',
  'creation',
  'discipline',
];

export const POSITION_FILTER_OPTIONS: readonly { value: PositionFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'GK', label: '门将' },
  { value: 'DF', label: '后卫' },
  { value: 'MF', label: '中场' },
  { value: 'FW', label: '前锋' },
];

export const MINUTES_THRESHOLD_NOTE = '出场不足全队四分之一时间（下限 45 分钟）的球员不计入本榜。';

/**
 * What each board actually measures. Kept next to the selectors' behaviour
 * rather than written as marketing copy, so the wording cannot drift into
 * claiming a metric the sort does not read.
 */
export const RANKING_SCOPE_NOTES: Record<RankingTab, string> = {
  overall: '跨位置统一评分：位置表现 70% + 全赛事出勤 20% + 联赛强度 10%，按出场分钟做置信度收缩。',
  scorers: '按全赛事进球排序，同分依次看助攻、出场。',
  assists: '按助攻数排序，同分依次看进球、出场。',
  creation: '关键传球与助攻的每 90 分钟表现，前场口径；候选仅中场与前锋。',
  forwards: '进球、助攻与大机会的每 90 分钟表现，前锋口径；候选仅前锋。',
  defense: '拦截、解围与门线封堵的每 90 分钟表现，兼顾在场失球，后卫口径；候选仅后卫。',
  keepers: '扑救率、关键扑救与零封，门将口径；候选仅门将。',
  discipline: '黄牌与红牌合计，越多越靠前；同分看红牌、出场。',
  careerScorers: '生涯累计全赛事进球，同分依次看助攻、出场；不受出场门槛限制。',
  careerAssists: '生涯累计助攻，同分依次看进球、出场；不受出场门槛限制。',
};

export function isRankingGroup(value: unknown): value is RankingGroup {
  return typeof value === 'string' && (RANKING_GROUPS as readonly string[]).includes(value);
}

export function isRankingTab(value: unknown, group: 'season' | 'career'): value is RankingTab {
  return typeof value === 'string' && TABS_BY_GROUP[group].some((tab) => tab.key === value);
}

import type { MatchResult } from '../../types/match';
import type { GameWorld, NewsItem } from '../season/season-manager';
import { analyzeDestinyDeviation } from '../match/analysis';
import type { ObservationSettlement } from './judgment';

export type AdvanceMode = 'single' | 'batch' | 'cup' | 'season_end' | 'key_node';

export interface AdvanceWindowOutcome {
  seasonNumber: number;
  windowIndex: number;
  windowLabel: string;
  results: MatchResult[];
  news: NewsItem[];
  observationSettlements: ObservationSettlement[];
}

export interface WorldResponseMatch {
  result: MatchResult;
  seasonNumber: number;
  windowIndex: number;
  windowLabel: string;
  focusTeamId?: string;
  focus: 'primary' | 'favorite' | 'world';
}

export interface AdvanceWorldResponse {
  id: string;
  mode: AdvanceMode;
  advancedWindows: number;
  completedMatches: number;
  totalNews: number;
  fromSeason: number;
  fromWindow: number;
  fromLabel: string;
  toSeason: number;
  toWindow: number;
  toLabel: string;
  nextSeason: number;
  nextWindowLabel?: string;
  seasonChanged: boolean;
  featuredResults: WorldResponseMatch[];
  observationSettlements: ObservationSettlement[];
  storyUpdates: NewsItem[];
  keyNews: NewsItem[];
  hasMajorMoment: boolean;
}

const MAX_FEATURED_RESULTS = 3;
const MAX_STORY_UPDATES = 2;
const MAX_KEY_NEWS = 2;

function uniqueNews(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function isDecisiveRound(result: MatchResult): boolean {
  const round = result.roundLabel.toLowerCase();
  return round.includes('final') || round.includes('决赛');
}

function candidateScore(
  result: MatchResult,
  focus: WorldResponseMatch['focus'],
  ordinal: number,
): number {
  const focusScore = focus === 'primary' ? 300 : focus === 'favorite' ? 220 : 0;
  const decisiveScore = isDecisiveRound(result) ? 120 : 0;
  const upsetScore = analyzeDestinyDeviation(result).isUpset ? 80 : 0;
  return focusScore + decisiveScore + upsetScore + ordinal / 100;
}

function newsPriority(item: NewsItem): number {
  if (item.importance === 'major') return 3;
  if (item.importance === 'normal') return 2;
  return 1;
}

export function buildAdvanceWorldResponse(
  mode: AdvanceMode,
  outcomes: AdvanceWindowOutcome[],
  endWorld: GameWorld,
  favoriteTeamIds: string[],
  primaryFavoriteTeamId: string | null,
): AdvanceWorldResponse | null {
  if (outcomes.length === 0) return null;
  const first = outcomes[0];
  const last = outcomes.at(-1)!;
  const favoriteSet = new Set(favoriteTeamIds);
  const allNews = outcomes.flatMap(outcome => outcome.news);
  const allSettlements = outcomes.flatMap(outcome => outcome.observationSettlements);
  const candidates = outcomes.flatMap((outcome, outcomeIndex) => (
    outcome.results.map((result, resultIndex) => {
      const primaryInvolved = primaryFavoriteTeamId != null
        && (result.homeTeamId === primaryFavoriteTeamId || result.awayTeamId === primaryFavoriteTeamId);
      const favoriteTeamId = [result.homeTeamId, result.awayTeamId]
        .find(teamId => favoriteSet.has(teamId));
      const focus: WorldResponseMatch['focus'] = primaryInvolved
        ? 'primary'
        : favoriteTeamId
          ? 'favorite'
          : 'world';
      const focusTeamId = primaryInvolved ? primaryFavoriteTeamId : favoriteTeamId;
      const ordinal = outcomeIndex * 100 + resultIndex;
      return {
        match: {
          result,
          seasonNumber: outcome.seasonNumber,
          windowIndex: outcome.windowIndex,
          windowLabel: outcome.windowLabel,
          ...(focusTeamId ? { focusTeamId } : {}),
          focus,
        } satisfies WorldResponseMatch,
        score: candidateScore(result, focus, ordinal),
      };
    })
  ));
  const featuredResults = candidates
    .sort((a, b) => b.score - a.score || a.match.result.fixtureId.localeCompare(b.match.result.fixtureId))
    .slice(0, MAX_FEATURED_RESULTS)
    .map(candidate => candidate.match);
  const storyUpdates = uniqueNews(allNews.filter(item => item.type === 'storyline'))
    .slice(-MAX_STORY_UPDATES)
    .reverse();
  const duplicatedMatchTypes = new Set<NewsItem['type']>(['match_result', 'upset', 'streak', 'storyline']);
  const keyNews = uniqueNews(allNews.filter(item => !duplicatedMatchTypes.has(item.type)))
    .map((item, index) => ({ item, index }))
    .sort((a, b) => newsPriority(b.item) - newsPriority(a.item) || b.index - a.index)
    .slice(0, MAX_KEY_NEWS)
    .map(entry => entry.item);
  const completedMatches = outcomes.reduce((total, outcome) => total + outcome.results.length, 0);
  const hasMajorMoment = allSettlements.length > 0
    || storyUpdates.length > 0
    || keyNews.some(item => item.importance === 'major')
    || featuredResults.some(item => (
      isDecisiveRound(item.result) || analyzeDestinyDeviation(item.result).isUpset
    ));

  return {
    id: `${endWorld.totalElapsedWindows ?? 0}-${mode}-${outcomes.length}`,
    mode,
    advancedWindows: outcomes.length,
    completedMatches,
    totalNews: allNews.length,
    fromSeason: first.seasonNumber,
    fromWindow: first.windowIndex,
    fromLabel: first.windowLabel,
    toSeason: last.seasonNumber,
    toWindow: last.windowIndex,
    toLabel: last.windowLabel,
    nextSeason: endWorld.seasonState.seasonNumber,
    nextWindowLabel: endWorld.seasonState.calendar[endWorld.seasonState.currentWindowIndex]?.label,
    seasonChanged: first.seasonNumber !== endWorld.seasonState.seasonNumber,
    featuredResults,
    observationSettlements: allSettlements.slice(-1),
    storyUpdates,
    keyNews,
    hasMajorMoment,
  };
}

export function advanceModeLabel(mode: AdvanceMode, advancedWindows: number): string {
  if (mode === 'key_node') return `前往关键节点 · ${advancedWindows}轮`;
  if (mode === 'cup') return `前往杯赛 · ${advancedWindows}轮`;
  if (mode === 'season_end') return `前往赛季末 · ${advancedWindows}轮`;
  if (mode === 'batch') return `快速推进 ${advancedWindows}轮`;
  return '推进 1轮';
}

export function readableAdvanceError(): string {
  return '本次推进没有完成，本次操作未提交。请重试；若问题持续，请刷新页面。';
}

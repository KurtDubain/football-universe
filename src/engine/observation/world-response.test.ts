import { describe, expect, it } from 'vitest';
import type { MatchResult } from '../../types/match';
import { initializeGameWorld, type NewsItem } from '../season/season-manager';
import type { ObservationSettlement } from './judgment';
import {
  advanceModeLabel,
  buildAdvanceWorldResponse,
  readableAdvanceError,
  type AdvanceWindowOutcome,
} from './world-response';

function result(
  fixtureId: string,
  homeTeamId: string,
  awayTeamId: string,
  options: { homeGoals?: number; awayGoals?: number; roundLabel?: string; awayWinPct?: number } = {},
): MatchResult {
  return {
    fixtureId,
    homeTeamId,
    awayTeamId,
    homeGoals: options.homeGoals ?? 1,
    awayGoals: options.awayGoals ?? 0,
    extraTime: false,
    penalties: false,
    events: [],
    stats: {
      possession: [50, 50],
      shots: [8, 7],
      shotsOnTarget: [3, 2],
      corners: [4, 3],
      fouls: [9, 10],
      yellowCards: [1, 1],
      redCards: [0, 0],
    },
    competitionType: 'league',
    competitionName: '顶级联赛',
    roundLabel: options.roundLabel ?? 'R1',
    prediction: {
      homeWinPct: 70,
      drawPct: 20,
      awayWinPct: options.awayWinPct ?? 10,
      homeExpectedGoals: 1.8,
      awayExpectedGoals: 0.6,
    },
  };
}

function news(id: string, type: NewsItem['type'], importance: NewsItem['importance'] = 'normal'): NewsItem {
  return {
    id,
    seasonNumber: 1,
    windowIndex: 0,
    type,
    importance,
    title: `动态 ${id}`,
    description: `证据 ${id}`,
  };
}

function outcome(
  windowIndex: number,
  results: MatchResult[],
  itemNews: NewsItem[] = [],
  settlements: ObservationSettlement[] = [],
): AdvanceWindowOutcome {
  return {
    seasonNumber: 1,
    windowIndex,
    windowLabel: `第${windowIndex + 1}轮`,
    results,
    news: itemNews,
    observationSettlements: settlements,
  };
}

describe('advance world response', () => {
  it('prioritizes the primary team and keeps the response compact', () => {
    const world = initializeGameWorld(20260725);
    const [primary, favorite, ...others] = Object.keys(world.teamBases);
    const outcomes = [
      outcome(0, [
        result('world-final', others[0], others[1], { roundLabel: 'Final' }),
        result('primary-old', primary, others[2]),
      ]),
      outcome(1, [
        result('favorite', favorite, others[3]),
        result('primary-new', others[4], primary),
        result('world-latest', others[5], others[6]),
      ]),
    ];

    const response = buildAdvanceWorldResponse(
      'batch',
      outcomes,
      { ...world, totalElapsedWindows: 2 },
      [primary, favorite],
      primary,
    );

    expect(response).not.toBeNull();
    expect(response?.advancedWindows).toBe(2);
    expect(response?.completedMatches).toBe(5);
    expect(response?.featuredResults).toHaveLength(3);
    expect(response?.featuredResults.slice(0, 2).map(item => item.result.fixtureId))
      .toEqual(['primary-new', 'primary-old']);
    expect(response?.featuredResults[0].focus).toBe('primary');
  });

  it('collects one judgment and bounded, deduplicated changes without duplicating match news', () => {
    const world = initializeGameWorld(20260725);
    const [home, away] = Object.keys(world.teamBases);
    const settlement: ObservationSettlement = {
      fixtureId: 'observed',
      seasonNumber: 1,
      windowIndex: 0,
      kind: 'outcome',
      selection: 'home',
      homeTeamId: home,
      awayTeamId: away,
      actualSelection: 'home',
      correct: true,
    };
    const outcomes = [
      outcome(0, [result('observed', home, away)], [
        news('match', 'match_result'),
        news('story-a', 'storyline', 'major'),
        news('coach', 'coach_fired', 'major'),
      ], [settlement]),
      outcome(1, [result('upset', home, away, { homeGoals: 0, awayGoals: 2 })], [
        news('story-a', 'storyline', 'major'),
        news('story-b', 'storyline'),
        news('injury', 'injury'),
        news('streak', 'streak'),
      ]),
    ];

    const response = buildAdvanceWorldResponse('batch', outcomes, world, [], null)!;

    expect(response.observationSettlements).toEqual([settlement]);
    expect(response.storyUpdates.map(item => item.id)).toEqual(['story-b', 'story-a']);
    expect(response.keyNews.map(item => item.id)).toEqual(['coach', 'injury']);
    expect(response.keyNews.some(item => item.type === 'match_result' || item.type === 'streak')).toBe(false);
    expect(response.hasMajorMoment).toBe(true);
  });

  it('is deterministic, labels modes, and returns an understandable failure message', () => {
    const world = initializeGameWorld(20260725);
    const [home, away] = Object.keys(world.teamBases);
    const outcomes = [outcome(0, [result('same', home, away)])];

    expect(buildAdvanceWorldResponse('single', outcomes, world, [], null))
      .toEqual(buildAdvanceWorldResponse('single', outcomes, world, [], null));
    expect(buildAdvanceWorldResponse('single', [], world, [], null)).toBeNull();
    expect(advanceModeLabel('season_end', 12)).toBe('前往赛季末 · 12轮');
    expect(advanceModeLabel('key_node', 3)).toBe('前往关键节点 · 3轮');
    expect(readableAdvanceError()).toContain('本次操作未提交');
  });
});

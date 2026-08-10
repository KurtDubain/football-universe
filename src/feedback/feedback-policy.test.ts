import { describe, expect, it } from 'vitest';
import type { AdvanceWorldResponse } from '../engine/observation/world-response';
import type { MatchResult } from '../types/match';
import { selectWorldFeedbackCue, shouldVibrateForCue } from './feedback-policy';

function result(actualProbability: number): MatchResult {
  return {
    fixtureId: `result-${actualProbability}`,
    homeTeamId: 'favorite',
    awayTeamId: 'underdog',
    homeGoals: 0,
    awayGoals: 1,
    extraTime: false,
    penalties: false,
    events: [],
    stats: {
      possession: [50, 50],
      shots: [8, 8],
      shotsOnTarget: [3, 3],
      corners: [3, 3],
      fouls: [8, 8],
      yellowCards: [1, 1],
      redCards: [0, 0],
    },
    competitionType: 'league',
    competitionName: '联赛',
    roundLabel: 'R1',
    prediction: {
      homeWinPct: 100 - actualProbability - 10,
      drawPct: 10,
      awayWinPct: actualProbability,
      homeExpectedGoals: 1.8,
      awayExpectedGoals: 0.6,
    },
  };
}

function response(patch: Partial<AdvanceWorldResponse> = {}): AdvanceWorldResponse {
  return {
    id: 'response',
    mode: 'single',
    advancedWindows: 1,
    completedMatches: 1,
    totalNews: 0,
    fromSeason: 1,
    fromWindow: 0,
    fromLabel: 'R1',
    toSeason: 1,
    toWindow: 0,
    toLabel: 'R1',
    nextSeason: 1,
    seasonChanged: false,
    featuredResults: [],
    observationSettlements: [],
    storyUpdates: [],
    keyNews: [],
    hasMajorMoment: false,
    ...patch,
  };
}

describe('game feedback policy', () => {
  it('keeps ordinary and merely notable batches silent', () => {
    expect(selectWorldFeedbackCue(response())).toBeNull();
    expect(selectWorldFeedbackCue(response({
      featuredResults: [{
        result: result(18),
        seasonNumber: 1,
        windowIndex: 0,
        windowLabel: 'R1',
        focus: 'world',
      }],
    }))).toBeNull();
  });

  it('selects one bounded cue by season, major upset, then major story priority', () => {
    const majorStory = {
      id: 'story',
      seasonNumber: 1,
      windowIndex: 2,
      type: 'storyline' as const,
      title: '故事升级',
      description: '证据',
      importance: 'major' as const,
    };
    const majorUpset = {
      result: result(12),
      seasonNumber: 1,
      windowIndex: 1,
      windowLabel: 'R2',
      focus: 'world' as const,
    };
    expect(selectWorldFeedbackCue(response({ storyUpdates: [majorStory] }))).toBe('story_upgrade');
    expect(selectWorldFeedbackCue(response({
      featuredResults: [majorUpset],
      storyUpdates: [majorStory],
    }))).toBe('major_upset');
    expect(selectWorldFeedbackCue(response({
      seasonChanged: true,
      featuredResults: [majorUpset],
      storyUpdates: [majorStory],
    }))).toBe('season_end');
  });

  it('reserves haptics for major upsets and season endings', () => {
    expect(shouldVibrateForCue('start')).toBe(false);
    expect(shouldVibrateForCue('goal')).toBe(false);
    expect(shouldVibrateForCue('story_upgrade')).toBe(false);
    expect(shouldVibrateForCue('major_upset')).toBe(true);
    expect(shouldVibrateForCue('season_end')).toBe(true);
    expect(shouldVibrateForCue('advance')).toBe(false);
    expect(shouldVibrateForCue('intervention')).toBe(false);
  });
});

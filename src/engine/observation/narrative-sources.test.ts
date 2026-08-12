import { describe, expect, it } from 'vitest';
import type { MatchResult } from '../../types/match';
import { pickFocusMatches } from '../season/match-importance';
import { executeCurrentWindow, initializeGameWorld } from '../season/season-manager';
import { buildObservationTheme } from './observation-theme';
import { buildMatchdayNarrativeDigest, buildResultNarrativeDigest } from './narrative-sources';

function result(homeTeamId: string, awayTeamId: string): MatchResult {
  return {
    fixtureId: 'fixture-final',
    homeTeamId,
    awayTeamId,
    homeGoals: 0,
    awayGoals: 1,
    extraTime: false,
    penalties: false,
    events: [{
      minute: 62,
      type: 'red_card',
      teamId: homeTeamId,
      playerId: 'home-player',
      playerName: '主队后卫',
      description: '主队后卫被罚下',
    }],
    stats: {
      possession: [55, 45],
      shots: [11, 8],
      shotsOnTarget: [4, 3],
      corners: [5, 2],
      fouls: [13, 9],
      yellowCards: [2, 1],
      redCards: [1, 0],
    },
    competitionType: 'league_cup',
    competitionName: '联赛杯',
    roundLabel: 'Final',
    prediction: {
      homeWinPct: 70,
      drawPct: 20,
      awayWinPct: 10,
      homeExpectedGoals: 1.8,
      awayExpectedGoals: 0.7,
      factors: [{
        source: 'team_strength',
        beneficiary: 'home',
        direction: 'positive',
        importance: 3,
        label: '主队整体实力占优',
        detail: '主队基础能力高出约8档。',
        evidenceValue: 8,
      }],
    },
  };
}

describe('narrative source adapters', () => {
  it('merges the observation arc, preserves prior Matchday sources, and exposes no hidden potential', () => {
    const world = initializeGameWorld(20260812);
    const currentWindow = world.seasonState.calendar[world.seasonState.currentWindowIndex];
    const observedTeamId = currentWindow.fixtures[0].homeTeamId;
    const observationTheme = buildObservationTheme(
      world,
      observedTeamId,
      'dark_horse_challenge',
    );
    const focusMatches = pickFocusMatches(
      currentWindow.fixtures,
      world,
      [observedTeamId],
      2,
      observedTeamId,
    );
    const forcedFocus = focusMatches.length > 0 ? focusMatches : [{
      fixture: currentWindow.fixtures[0],
      importance: {
        fixtureId: currentWindow.fixtures[0].id,
        score: 8,
        reasons: ['主要观察球队出战'],
      },
    }];
    const candidatePlayer = world.squads[observedTeamId][0];
    const rumorTarget = Object.keys(world.teamBases).find(id => id !== observedTeamId)!;
    const enrichedWorld = {
      ...world,
      transferRumors: [{
        id: 'rumor-test',
        season: 1,
        windowIndex: 0,
        candidateUuid: candidatePlayer.uuid,
        candidateName: candidatePlayer.name,
        candidatePosition: candidatePlayer.position,
        fromTeamId: observedTeamId,
        fromTeamName: world.teamBases[observedTeamId].name,
        eliteTeamId: rumorTarget,
        eliteTeamName: world.teamBases[rumorTarget].name,
        intensity: 'high' as const,
      }],
    };
    const before = structuredClone(enrichedWorld);
    const digest = buildMatchdayNarrativeDigest({
      world: enrichedWorld,
      currentWindow,
      observationTheme,
      focusMatches: forcedFocus,
      playerHighlights: [{
        playerId: candidatePlayer.uuid,
        playerName: candidatePlayer.name,
        teamId: observedTeamId,
        opponentTeamId: forcedFocus[0].fixture.awayTeamId,
        position: candidatePlayer.position,
        label: '绝杀',
        emoji: '',
        color: '',
        detail: '89′ 绝杀进球',
        priority: 8,
        eventCount: 2,
        fixtureId: 'previous-fixture',
      }],
      favoriteTeamIds: [observedTeamId],
      favoritePlayerIds: [candidatePlayer.uuid],
      primaryFavoriteTeamId: observedTeamId,
      memory: [],
    });
    const visible = [digest.feature, ...digest.signals, ...digest.more]
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    expect(digest.signals.length).toBeLessThanOrEqual(2);
    expect(digest.observationRelationFixtureIds).toContain(forcedFocus[0].fixture.id);
    expect(visible.some(item => item.source === 'player_highlight')).toBe(true);
    expect(visible.some(item => item.source === 'transfer_rumor')).toBe(true);
    expect(visible.some(item => item.title === '保级线直接对话')).toBe(false);
    expect(JSON.stringify({ observationTheme, digest })).not.toContain('peakRating');
    expect(JSON.stringify({ observationTheme, digest })).not.toContain('潜力上限');
    expect(enrichedWorld).toEqual(before);
    expect(executeCurrentWindow(enrichedWorld, { favoriteTeamIds: [observedTeamId] }))
      .toEqual(executeCurrentWindow(before, { favoriteTeamIds: [observedTeamId] }));
  });

  it('builds result causality only from frozen factors, real events, and factual consequences', () => {
    const previousWorld = initializeGameWorld(20260812);
    const [homeTeamId, awayTeamId] = Object.keys(previousWorld.teamBases);
    const match = result(homeTeamId, awayTeamId);
    const endWorld = structuredClone(previousWorld);
    endWorld.totalElapsedWindows = 1;
    endWorld.teamStates[homeTeamId].coachPressure += 12;
    const outcome = {
      seasonNumber: 1,
      windowIndex: 0,
      windowLabel: '联赛杯决赛',
      results: [match],
      news: [],
      observationSettlements: [],
    };
    const beforeResult = structuredClone(match);
    const digest = buildResultNarrativeDigest({
      outcomes: [outcome],
      endWorld,
      previousWorld,
      favoriteTeamIds: [homeTeamId],
      favoritePlayerIds: [],
      primaryFavoriteTeamId: homeTeamId,
      memory: [],
    });

    expect(digest.feature).toMatchObject({
      source: 'match_result',
      visualKind: 'stage',
      fixtureIds: ['fixture-final'],
    });
    expect(digest.feature?.causes?.map(item => item.label)).toContain('主队整体实力占优');
    expect(digest.feature?.turningPoints?.map(item => item.label)).toContain("62' 红牌");
    expect(digest.feature?.evidence?.some(item => item.label === '重大爆冷')).toBe(true);
    expect(digest.feature?.consequences?.some(item => item.label === '推进后压力')).toBe(true);
    expect(digest.feature?.consequences?.some(item => item.label === '奖杯归属')).toBe(true);
    expect(match).toEqual(beforeResult);
    expect(buildResultNarrativeDigest({
      outcomes: [outcome],
      endWorld,
      previousWorld,
      favoriteTeamIds: [homeTeamId],
      favoritePlayerIds: [],
      primaryFavoriteTeamId: homeTeamId,
      memory: [],
    })).toEqual(digest);
  });

  it('treats previous-season final-window news as fresh at the season boundary', () => {
    const previousWorld = initializeGameWorld(20260818);
    const endWorld = structuredClone(previousWorld);
    endWorld.seasonState.seasonNumber = 2;
    endWorld.seasonState.currentWindowIndex = 0;
    endWorld.totalElapsedWindows = 48;
    const news = {
      id: 'season-one-champion',
      seasonNumber: 1,
      windowIndex: 47,
      type: 'trophy' as const,
      importance: 'major' as const,
      title: '冠军诞生',
      description: '决赛结束后，冠军正式诞生。',
    };
    endWorld.newsLog = [news];

    const digest = buildResultNarrativeDigest({
      outcomes: [{
        seasonNumber: 1,
        windowIndex: 47,
        windowLabel: '赛季结算',
        results: [],
        news: [news],
        observationSettlements: [],
      }],
      endWorld,
      previousWorld,
      favoriteTeamIds: [],
      favoritePlayerIds: [],
      primaryFavoriteTeamId: null,
      memory: [],
    });

    expect(digest.worldMoment).toMatchObject({
      id: 'news:season-one-champion',
      changedAt: 48,
      visualLevel: 'world_moment',
    });
    expect(digest.worldMoment?.evidence?.[0].label).toBe('足坛动态');
  });

  it('uses each result window for World Moment freshness during a multi-window advance', () => {
    const previousWorld = initializeGameWorld(20260819);
    const [homeTeamId, awayTeamId] = Object.keys(previousWorld.teamBases);
    const oldFinal = { ...result(homeTeamId, awayTeamId), fixtureId: 'old-final' };
    const recentFinal = { ...result(homeTeamId, awayTeamId), fixtureId: 'recent-final' };
    const endWorld = structuredClone(previousWorld);
    endWorld.seasonState.currentWindowIndex = 4;
    endWorld.totalElapsedWindows = 4;

    const digest = buildResultNarrativeDigest({
      outcomes: [
        {
          seasonNumber: 1,
          windowIndex: 0,
          windowLabel: '早先决赛',
          results: [oldFinal],
          news: [],
          observationSettlements: [],
        },
        {
          seasonNumber: 1,
          windowIndex: 3,
          windowLabel: '最近决赛',
          results: [recentFinal],
          news: [],
          observationSettlements: [],
        },
      ],
      endWorld,
      previousWorld,
      favoriteTeamIds: [],
      favoritePlayerIds: [],
      primaryFavoriteTeamId: null,
      memory: [],
    });

    expect(digest.worldMoment).toMatchObject({
      id: 'result:1:recent-final',
      changedAt: 3,
    });
    expect(digest.more.map(item => item.id)).not.toContain('result:1:recent-final');
  });
});

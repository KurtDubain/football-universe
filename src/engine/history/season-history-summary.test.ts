import { describe, expect, it } from 'vitest';
import type { HonorRecord } from '../../types/honor';
import type { SeasonRecord, TeamBase } from '../../types/team';
import type { GameWorld } from '../season/season-manager';
import {
  buildSeasonHistoryLabels,
  buildSeasonHistorySummary,
  MAX_SEASON_HISTORY_EVENTS,
} from './season-history-summary';

function team(id: string, name = id): TeamBase {
  return {
    id,
    name,
    shortName: name,
    color: '#64748b',
    tier: 'mid',
    overall: 70,
    attack: 70,
    midfield: 70,
    defense: 70,
    stability: 70,
    depth: 70,
    reputation: 70,
    initialLeagueLevel: 1,
    expectation: 3,
    region: '大陆+测试',
  };
}

function honor(seasonNumber: number, champion: string): HonorRecord {
  return {
    seasonNumber,
    league1Champion: champion,
    league2Champion: 'l2',
    league3Champion: 'l3',
    leagueCupWinner: champion,
    superCupWinner: champion,
    promoted: [],
    relegated: [],
    coachChanges: [],
  };
}

function seasonRecord(
  seasonNumber: number,
  leagueLevel: 1 | 2 | 3 = 1,
  leaguePosition = 1,
): SeasonRecord {
  return {
    seasonNumber,
    leagueLevel,
    leaguePosition,
    leaguePlayed: 30,
    leagueWon: 20,
    leagueDrawn: 5,
    leagueLost: 5,
    leagueGF: 60,
    leagueGA: 25,
    leaguePoints: 65,
    coachId: 'coach',
    promoted: false,
    relegated: false,
  };
}

function source(overrides: Partial<GameWorld> = {}) {
  return {
    honorHistory: [],
    teamBases: {
      a: team('a', '甲队'),
      b: team('b', '乙队'),
      l2: team('l2', '甲级冠军'),
      l3: team('l3', '乙级冠军'),
    },
    coachBases: {
      coach: {
        id: 'coach',
        name: '测试主帅',
        rating: 75,
        age: 45,
        style: 'balanced',
        attackBuff: 2,
        defenseBuff: 2,
        moraleBuff: 1,
        leagueBuff: 2,
        cupBuff: 2,
        pressureResistance: 70,
        riskBias: 0,
        stabilityBuff: 2,
      },
    },
    teamTrophies: {},
    teamSeasonRecords: {},
    observerSeasonTrajectories: [],
    storylineHistory: [],
    playerAwardsHistory: [],
    memorableMatches: [],
    ...overrides,
  } as Pick<GameWorld,
    | 'honorHistory'
    | 'teamBases'
    | 'coachBases'
    | 'teamTrophies'
    | 'teamSeasonRecords'
    | 'observerSeasonTrajectories'
    | 'storylineHistory'
    | 'playerAwardsHistory'
    | 'memorableMatches'
  >;
}

describe('season history summary', () => {
  it('requires three consecutive top-flight titles before declaring a dynasty', () => {
    const two = source({ honorHistory: [honor(1, 'a'), honor(2, 'a')] });
    expect(buildSeasonHistoryLabels(two, 2)).toEqual([]);

    const three = source({ honorHistory: [honor(1, 'a'), honor(2, 'a'), honor(3, 'a')] });
    expect(buildSeasonHistoryLabels(three, 3)).toContainEqual(expect.objectContaining({
      type: 'dynasty',
      teamId: 'a',
      title: '甲队建立王朝',
    }));
  });

  it('does not bridge a promotion run across an interrupted season', () => {
    const first = honor(1, 'a');
    first.promoted = [{ teamId: 'b', from: 3, to: 2 }];
    const interrupted = honor(2, 'a');
    const third = honor(3, 'a');
    third.promoted = [{ teamId: 'b', from: 2, to: 1 }];
    expect(buildSeasonHistoryLabels(
      source({ honorHistory: [first, interrupted, third] }),
      3,
    ).some(label => label.type === 'promotion_run')).toBe(false);
  });

  it('links the champion coach only when the frozen season record resolves it', () => {
    const summary = buildSeasonHistorySummary(source({
      honorHistory: [honor(1, 'a')],
      teamSeasonRecords: { a: [seasonRecord(1)] },
    }), 1)!;
    expect(summary.events.find(event => event.type === 'league')?.links).toContainEqual({
      label: '冠军主帅 · 测试主帅',
      to: '/coach/coach',
      kind: 'coach',
    });
  });

  it('keeps at most two archived story endings and seven events overall', () => {
    const record = honor(5, 'a');
    record.promoted = [{ teamId: 'b', from: 2, to: 1 }];
    const world = source({
      honorHistory: [record],
      teamTrophies: {
        a: [
          { type: 'league1', seasonNumber: 5 },
          { type: 'league_cup', seasonNumber: 5 },
          { type: 'super_cup', seasonNumber: 5 },
        ],
      },
      storylineHistory: ['dark_horse', 'giant_crisis', 'promoted_survival'].map((type, index) => ({
        id: `story-${index}`,
        type: type as 'dark_horse' | 'giant_crisis' | 'promoted_survival',
        teamId: index === 0 ? 'a' : 'b',
        seasonNumber: 5,
        startedWindow: 1,
        startedElapsedWindow: 1,
        phase: '落幕' as const,
        evidence: [],
        lastUpdatedWindow: 10 + index,
        lastUpdatedElapsedWindow: 10 + index,
        quietWindows: 0,
        outcome: index < 2 ? 'success' as const : 'failure' as const,
        conclusion: `结局${index}`,
      })),
      playerAwardsHistory: [{
        season: 5,
        type: 'mvp',
        playerId: 'player-a',
        playerName: '年度球员',
        playerNumber: 10,
        teamId: 'a',
        teamName: '甲队',
        statValue: 20,
        statLabel: '20球',
      }],
      observerSeasonTrajectories: [{
        seasonNumber: 5,
        teamId: 'a',
        leagueLevel: 1,
        checkpoints: [],
        destinyDeviation: {
          fixtureId: 'old-fixture',
          homeTeamId: 'a',
          awayTeamId: 'b',
          homeGoals: 0,
          awayGoals: 2,
          competitionName: '顶级联赛',
          roundLabel: 'R8',
          score: 80,
          actualProbability: 9,
          tier: 'major_upset',
        },
      }],
    });

    const summary = buildSeasonHistorySummary(world, 5)!;
    expect(summary.events).toHaveLength(MAX_SEASON_HISTORY_EVENTS);
    expect(summary.events.filter(event => event.type === 'story')).toHaveLength(2);
    expect(summary.events.map(event => event.type)).toEqual(expect.arrayContaining([
      'league',
      'cups',
      'movement',
      'deviation',
      'person',
    ]));
  });

  it('retains an upset summary when its detailed replay was trimmed', () => {
    const summary = buildSeasonHistorySummary(source({
      honorHistory: [honor(1, 'a')],
      observerSeasonTrajectories: [{
        seasonNumber: 1,
        teamId: 'a',
        leagueLevel: 1,
        checkpoints: [],
        destinyDeviation: {
          fixtureId: 'trimmed',
          homeTeamId: 'a',
          awayTeamId: 'b',
          homeGoals: 0,
          awayGoals: 1,
          competitionName: '联赛杯',
          roundLabel: '决赛',
          score: 70,
          actualProbability: 11,
          tier: 'upset',
        },
      }],
    }), 1)!;
    const deviation = summary.events.find(event => event.type === 'deviation');
    expect(deviation).toMatchObject({ replayStatus: 'summary_only' });
    expect(deviation?.detail).toContain('详细回放已按存储上限清理');
    expect(deviation?.links.some(link => link.kind === 'match')).toBe(false);
  });

  it('archives the new persistent story families with explicit labels', () => {
    const storyBase = {
      teamId: 'a',
      seasonNumber: 4,
      startedWindow: 8,
      startedElapsedWindow: 8,
      phase: '落幕' as const,
      evidence: ['权威赛果重建'],
      lastUpdatedWindow: 30,
      lastUpdatedElapsedWindow: 30,
      quietWindows: 0,
      outcome: 'success' as const,
    };
    const summary = buildSeasonHistorySummary(source({
      honorHistory: [honor(4, 'a')],
      storylineHistory: [
        {
          ...storyBase,
          id: 'unbeaten-story',
          type: 'unbeaten_run',
          conclusion: '联赛连续12场不败。',
        },
        {
          ...storyBase,
          id: 'giant-killer-story',
          type: 'cup_giant_killer',
          competitionName: '联赛杯',
          conclusion: '联赛杯巨人杀手征程。',
        },
      ],
    }), 4)!;

    expect(summary.events.filter(event => event.type === 'story').map(event => event.title))
      .toEqual(expect.arrayContaining([
        '故事落幕：联赛不败征程',
        '故事落幕：杯赛巨人杀手',
      ]));
  });

  it('marks only substantial three-season decline', () => {
    const base = source({
      honorHistory: [honor(1, 'a'), honor(2, 'b'), honor(3, 'b')],
      teamSeasonRecords: {
        a: [
          { seasonNumber: 1, leagueLevel: 1 as const, leaguePosition: 2 },
          { seasonNumber: 2, leagueLevel: 1 as const, leaguePosition: 4 },
          { seasonNumber: 3, leagueLevel: 2 as const, leaguePosition: 3 },
        ].map(record => ({
          ...record,
          leaguePlayed: 30,
          leagueWon: 0,
          leagueDrawn: 0,
          leagueLost: 0,
          leagueGF: 0,
          leagueGA: 0,
          leaguePoints: 0,
          coachId: 'coach',
          promoted: false,
          relegated: record.seasonNumber === 2,
        })),
      },
    });
    expect(buildSeasonHistoryLabels(base, 3)).toContainEqual(expect.objectContaining({
      type: 'decline',
      teamId: 'a',
    }));
  });
});

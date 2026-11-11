import { describe, expect, it } from 'vitest';
import type { HonorRecord } from '../../types/honor';
import type { SeasonRecord, TeamBase } from '../../types/team';
import type { GameWorld } from '../season/season-manager';
import {
  buildSeasonHistoryLabels,
  buildSeasonHistorySummary,
  DECLINE_MIN_POSITION_DROP,
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

  it('keeps only notable fact rows and never truncates a story ending', () => {
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
    const types = summary.events.map(event => event.type);

    // Story endings lead the review and are never truncated by fact rows.
    expect(types.slice(0, 2)).toEqual(['story', 'story']);
    expect(summary.events.length).toBeLessThanOrEqual(MAX_SEASON_HISTORY_EVENTS);

    // Notable: a first title, a three-trophy season, a 9% upset.
    expect(types).toEqual(expect.arrayContaining(['league', 'cups', 'deviation']));
    // Routine: an ordinary promotion and a one-off award are not newsworthy.
    expect(types).not.toContain('movement');
    expect(types).not.toContain('person');
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
    expect(deviation).toMatchObject({
      replayStatus: 'summary_only',
      title: '甲队 0-1 乙队：本季最大冷门',
    });
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
        '甲队：联赛不败征程落幕',
        '甲队：杯赛巨人杀手落幕',
      ]));
  });

  it('merges same-type story endings by entity without text-based deduplication', () => {
    const story = {
      seasonNumber: 6,
      startedWindow: 1,
      startedElapsedWindow: 1,
      phase: '落幕' as const,
      evidence: ['权威记录'],
      lastUpdatedWindow: 30,
      lastUpdatedElapsedWindow: 30,
      quietWindows: 0,
      outcome: 'failure' as const,
      conclusion: '相同结论',
      type: 'giant_crisis' as const,
    };
    const summary = buildSeasonHistorySummary(source({
      honorHistory: [honor(6, 'a')],
      storylineHistory: [
        { ...story, id: 'crisis-a', teamId: 'a' },
        { ...story, id: 'crisis-b', teamId: 'b' },
      ],
    }), 6)!;
    const ending = summary.events.find(event => event.type === 'story')!;

    expect(ending.title).toBe('甲队、乙队：豪门危机落幕');
    expect(ending.detail).toBe('甲队：相同结论；乙队：相同结论');
    expect(ending.links.map(link => link.to)).toEqual(['/team/a', '/team/b']);
  });

  it('groups only notable promotion and relegation links', () => {
    const previous = honor(6, 'a');
    previous.relegated = [{ teamId: 'b', from: 1, to: 2 }];
    const record = honor(7, 'a');
    record.promoted = [
      { teamId: 'a', from: 2, to: 1 },
      { teamId: 'b', from: 2, to: 1 },
    ];
    record.relegated = [{ teamId: 'l2', from: 1, to: 2 }];
    const base = source({ honorHistory: [previous, record] });
    const movement = buildSeasonHistorySummary({
      ...base,
      teamBases: { ...base.teamBases, l2: { ...base.teamBases.l2, expectation: 5 } },
    }, 7)!.events.find(event => event.type === 'movement')!;

    expect(movement.title).toBe('甲级冠军降级，乙队迅速升回');
    expect(movement.linkGroups?.map(group => group.label)).toEqual([
      '升级 · 甲级→顶级',
      '降级 · 顶级→甲级',
    ]);
    // A routine promotion is not newsworthy and must not appear.
    expect(movement.links.map(link => link.to)).not.toContain('/team/a');
    expect(movement.links).toHaveLength(2);
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

  it('requires a collapse rather than ordinary drift before calling a same-tier decline', () => {
    const build = (rows: Array<{ seasonNumber: number; leagueLevel: 1 | 2; leaguePosition: number }>) =>
      source({
        honorHistory: [honor(1, 'b'), honor(2, 'b'), honor(3, 'b')],
        teamSeasonRecords: {
          a: rows.map(row => seasonRecord(row.seasonNumber, row.leagueLevel, row.leaguePosition)),
        },
      });
    const slide = (first: number, last: number) => build([
      { seasonNumber: 1, leagueLevel: 1, leaguePosition: first },
      { seasonNumber: 2, leagueLevel: 1, leaguePosition: Math.round((first + last) / 2) },
      { seasonNumber: 3, leagueLevel: 1, leaguePosition: last },
    ]);
    const isDecline = (world: ReturnType<typeof build>) =>
      buildSeasonHistoryLabels(world, 3).some(label => label.type === 'decline');

    // Mid-table drift into the relegation places is ordinary random walk: top
    // flight positions move about four places a season on their own.
    expect(isDecline(slide(9, 13))).toBe(false);
    // A top-half side sliding four places is not a collapse either.
    expect(isDecline(slide(5, 9))).toBe(false);
    // One place short of the documented bar still does not qualify.
    expect(isDecline(slide(2, 2 + DECLINE_MIN_POSITION_DROP - 1))).toBe(false);
    // Exactly at the bar, a contender's fall does.
    expect(isDecline(slide(1, 1 + DECLINE_MIN_POSITION_DROP))).toBe(true);
  });

  it('speaks about a title drought only at milestones', () => {
    const build = (seasonNumber: number) => source({
      honorHistory: [
        honor(1, 'b'),
        ...Array.from({ length: seasonNumber - 1 }, (_, index) => honor(index + 2, 'a')),
      ],
      teamSeasonRecords: {
        b: Array.from({ length: seasonNumber }, (_, index) => seasonRecord(index + 1, 1, 5)),
      },
    });

    expect(buildSeasonHistoryLabels(build(15), 15)
      .some(label => label.type === 'drought')).toBe(false);
    expect(buildSeasonHistoryLabels(build(16), 16)).toContainEqual(expect.objectContaining({
      type: 'drought',
      teamId: 'b',
      title: '乙队自S1夺冠后15季未再登顶',
    }));
    // Past the milestone the arc must not reprint itself every season; that
    // standing noise is exactly what the season review should avoid.
    expect(buildSeasonHistoryLabels(build(17), 17)
      .some(label => label.type === 'drought')).toBe(false);
  });

  it('reports a never-won drought from the retained record window', () => {
    const world = source({
      honorHistory: Array.from({ length: 15 }, (_, index) => honor(index + 1, 'a')),
      teamSeasonRecords: {
        b: Array.from({ length: 15 }, (_, index) => seasonRecord(index + 1, 1, 9)),
      },
    });
    // The window starts at S1, so the count is a lower bound rather than an
    // exact tenure: understating is safe, overstating is not.
    expect(buildSeasonHistoryLabels(world, 15)).toContainEqual(expect.objectContaining({
      type: 'drought',
      teamId: 'b',
      title: '乙队自S1起15季未夺顶级联赛冠军',
    }));
  });

  it('marks a continuous top-flight tenure only at milestones', () => {
    const build = (seasonNumber: number) => source({
      honorHistory: Array.from({ length: seasonNumber }, (_, index) => honor(index + 1, 'a')),
      teamSeasonRecords: {
        b: Array.from({ length: seasonNumber }, (_, index) => seasonRecord(index + 1, 1, 9)),
      },
    });

    expect(buildSeasonHistoryLabels(build(9), 9)
      .some(label => label.type === 'longevity')).toBe(false);
    expect(buildSeasonHistoryLabels(build(10), 10)).toContainEqual(expect.objectContaining({
      type: 'longevity',
      teamId: 'b',
      title: '乙队连续10季立足顶级联赛',
      detail: 'S1至S10连续10季留在顶级联赛。',
    }));
    expect(buildSeasonHistoryLabels(build(11), 11)
      .some(label => label.type === 'longevity')).toBe(false);
  });

  it('breaks a top-flight tenure at the first season outside the top division', () => {
    const world = source({
      honorHistory: Array.from({ length: 12 }, (_, index) => honor(index + 1, 'a')),
      teamSeasonRecords: {
        b: [
          ...Array.from({ length: 10 }, (_, index) => seasonRecord(index + 1, 1, 9)),
          seasonRecord(11, 2, 4),
          seasonRecord(12, 1, 9),
        ],
      },
    });
    // S11 in the second tier resets the run, so S12 is year one again.
    expect(buildSeasonHistoryLabels(world, 12)
      .some(label => label.type === 'longevity')).toBe(false);
  });

  it('ranks this season movement above a slow-burn milestone', () => {
    const relegate = (seasonNumber: number, from: number, to: number) => {
      const record = honor(seasonNumber, 'a');
      record.relegated = [{ teamId: 'l2', from, to }];
      return record;
    };
    const labels = buildSeasonHistoryLabels(source({
      honorHistory: [
        honor(1, 'b'),
        ...Array.from({ length: 13 }, (_, index) => honor(index + 2, 'a')),
        relegate(15, 1, 2),
        relegate(16, 2, 3),
      ],
      teamSeasonRecords: {
        b: Array.from({ length: 16 }, (_, index) => seasonRecord(index + 1, 1, 5)),
      },
    }), 16);

    // A club that just fell two divisions outranks another club's drought:
    // the relegation happened this season, the drought is a standing fact.
    expect(labels.map(label => label.type)).toEqual(['dynasty', 'relegation_run', 'drought']);
  });
});

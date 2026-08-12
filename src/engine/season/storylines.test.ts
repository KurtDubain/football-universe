import { describe, expect, it } from 'vitest';
import type { StandingEntry } from '../../types/league';
import type { CompetitionType, MatchFixture, MatchResult } from '../../types/match';
import type { SeasonRecord, TeamBase, TeamState } from '../../types/team';
import type { GameWorld } from './season-manager';
import {
  advanceStorylines,
  detectTeamStorylineSignals,
  getFixtureStorylineLabel,
  getStorylineArcKey,
  STORYLINE_COOLDOWN_WINDOWS,
  MAX_STORYLINES_PER_SEASON,
  STORYLINES_PER_TYPE_PER_SEASON,
  UNBEATEN_RUN_TRIGGER_LONG,
  UNBEATEN_RUN_TRIGGER_SHORT,
  type Storyline,
  type StorylineType,
} from './storylines';

function team(expectation: number): TeamBase {
  return {
    id: 'target', name: '目标队', shortName: '目标', color: '#123456', tier: 'mid',
    overall: 75, attack: 75, midfield: 75, defense: 75, stability: 75,
    depth: 75, reputation: 75, initialLeagueLevel: 1, expectation, region: '测试',
  };
}

function state(coachPressure = 20): TeamState {
  return {
    id: 'target', leagueLevel: 1, morale: 60, fatigue: 10, momentum: 0,
    squadHealth: 90, coachPressure, recentForm: ['W', 'W', 'D', 'W', 'L'],
  };
}

function standing(teamId: string, points: number, played: number): StandingEntry {
  return {
    teamId, played, won: 5, drawn: 2, lost: 3, goalsFor: 15, goalsAgainst: 10,
    goalDifference: 5, points, form: ['W', 'D', 'W'],
  };
}

function record(overrides: Partial<SeasonRecord> = {}): SeasonRecord {
  return {
    seasonNumber: 1, leagueLevel: 2, leaguePosition: 1, leaguePlayed: 14,
    leagueWon: 10, leagueDrawn: 2, leagueLost: 2, leagueGF: 30, leagueGA: 12,
    leaguePoints: 32, coachId: 'coach', promoted: true, relegated: false,
    ...overrides,
  };
}

function table(rank: number, played: number, teamCount = 8): StandingEntry[] {
  let other = 0;
  return Array.from({ length: teamCount }, (_, index) => {
    if (index === rank - 1) return standing('target', 40 - index * 3, played);
    return standing(`other-${other++}`, 40 - index * 3, played);
  });
}

function world(params: {
  expectation?: number;
  rank?: number;
  played?: number;
  pressure?: number;
  season?: number;
  records?: SeasonRecord[];
  elapsed?: number;
} = {}): GameWorld {
  const expectation = params.expectation ?? 2;
  const played = params.played ?? 4;
  const season = params.season ?? 1;
  return {
    seasonState: {
      seasonNumber: season,
      currentWindowIndex: played,
      calendar: [],
      completed: false,
      isWorldCupYear: false,
      worldCupPhase: false,
    },
    teamBases: { target: team(expectation) },
    teamStates: { target: state(params.pressure) },
    league1Standings: table(params.rank ?? 1, played),
    league2Standings: [],
    league3Standings: [],
    teamSeasonRecords: { target: params.records ?? [] },
    activeStorylines: [],
    storylineHistory: [],
    storylineCooldowns: [],
    newsLog: [],
    rngState: 987654,
    totalElapsedWindows: params.elapsed ?? played,
  } as unknown as GameWorld;
}

function move(worldValue: GameWorld, rank: number, played: number, season = worldValue.seasonState.seasonNumber): GameWorld {
  return {
    ...worldValue,
    seasonState: {
      ...worldValue.seasonState,
      seasonNumber: season,
      currentWindowIndex: played,
    },
    league1Standings: table(rank, played),
    totalElapsedWindows: played,
  };
}

function result(params: {
  id: string;
  competitionType?: CompetitionType;
  competitionName?: string;
  roundLabel?: string;
  outcome?: 'win' | 'draw' | 'loss';
  targetWinProbability?: number;
}): MatchResult {
  const outcome = params.outcome ?? 'win';
  const targetProbability = params.targetWinProbability ?? 60;
  return {
    fixtureId: params.id,
    homeTeamId: 'target',
    awayTeamId: 'other-0',
    homeGoals: outcome === 'win' ? 2 : 0,
    awayGoals: outcome === 'loss' ? 1 : 0,
    extraTime: false,
    penalties: false,
    events: [],
    stats: {
      possession: [50, 50], shots: [8, 8], shotsOnTarget: [3, 3], corners: [4, 4],
      fouls: [8, 8], yellowCards: [1, 1], redCards: [0, 0],
    },
    competitionType: params.competitionType ?? 'league',
    competitionName: params.competitionName ?? '顶级联赛',
    roundLabel: params.roundLabel ?? params.id,
    prediction: {
      homeWinPct: targetProbability,
      drawPct: 20,
      awayWinPct: 80 - targetProbability,
      homeExpectedGoals: 1.2,
      awayExpectedGoals: 1.2,
    },
  };
}

function withTimeline(
  source: GameWorld,
  results: MatchResult[],
  upcoming?: MatchFixture,
): GameWorld {
  const completed = results.map((match, index) => ({
    id: index,
    type: match.competitionType,
    label: match.roundLabel,
    description: match.competitionName,
    fixtures: [],
    completed: true,
    results: [match],
  }));
  const calendar = upcoming
    ? [...completed, {
      id: completed.length,
      type: upcoming.competitionType,
      label: upcoming.roundLabel,
      description: upcoming.competitionName,
      fixtures: [upcoming],
      completed: false,
      results: [],
    }]
    : completed;
  return {
    ...source,
    seasonState: {
      ...source.seasonState,
      currentWindowIndex: completed.length,
      calendar,
    },
    totalElapsedWindows: completed.length,
  };
}

function leagueRun(length: number, outcome: 'win' | 'draw' = 'win'): MatchResult[] {
  return Array.from({ length }, (_, index) => result({
    id: `league-${index + 1}`,
    outcome: index % 4 === 3 ? 'draw' : outcome,
  }));
}

function cupUpset(id: string, roundLabel: string, outcome: 'win' | 'loss' = 'win'): MatchResult {
  return result({
    id,
    competitionType: 'league_cup',
    competitionName: '联赛杯',
    roundLabel,
    outcome,
    targetWinProbability: 12,
  });
}

function activeStory(type: StorylineType, seasonNumber = 1): Storyline {
  return {
    id: `story-${type}`,
    type,
    teamId: 'target',
    seasonNumber,
    startedWindow: 4,
    startedElapsedWindow: 4,
    phase: '发展',
    evidence: ['构造证据'],
    lastUpdatedWindow: 6,
    lastUpdatedElapsedWindow: 6,
    quietWindows: 0,
  };
}

describe('storyline trigger boundaries', () => {
  it.each([
    ['leader', { expectation: 2, rank: 1, played: 4 }, true],
    ['runner-up', { expectation: 2, rank: 2, played: 8 }, true],
    ['large expectation gap', { expectation: 1, rank: 3, played: 10 }, true],
    ['too early', { expectation: 2, rank: 1, played: 3 }, false],
    ['outside top group', { expectation: 2, rank: 4, played: 8 }, false],
    ['already expected giant', { expectation: 4, rank: 2, played: 8 }, false],
  ])('checks dark-horse scenario: %s', (_name, params, expected) => {
    expect(detectTeamStorylineSignals(world(params), 'target')
      .some(signal => signal.type === 'dark_horse')).toBe(expected);
  });

  it.each([
    ['bottom giant', { expectation: 5, rank: 8, played: 8, pressure: 70 }, true],
    ['lower-half giant', { expectation: 5, rank: 5, played: 8, pressure: 20 }, true],
    ['expectation-four slump', { expectation: 4, rank: 6, played: 8, pressure: 20 }, true],
    ['pressure boundary', { expectation: 5, rank: 4, played: 8, pressure: 55 }, true],
    ['within expectation', { expectation: 5, rank: 3, played: 8, pressure: 80 }, false],
    ['non-giant', { expectation: 3, rank: 8, played: 8, pressure: 80 }, false],
  ])('checks giant-crisis scenario: %s', (_name, params, expected) => {
    expect(detectTeamStorylineSignals(world(params), 'target')
      .some(signal => signal.type === 'giant_crisis')).toBe(expected);
  });

  it.each([
    ['safe promoted side', { season: 2, rank: 2, records: [record()] }, true],
    ['relegation-zone promoted side', { season: 2, rank: 8, records: [record()] }, true],
    ['safety-line promoted side', { season: 2, rank: 5, records: [record()] }, true],
    ['record too old', { season: 3, rank: 5, records: [record()] }, false],
    ['not actually promoted', { season: 2, rank: 5, records: [record({ promoted: false })] }, false],
    ['first season has no source record', { season: 1, rank: 5, records: [] }, false],
  ])('checks promoted-survival scenario: %s', (_name, params, expected) => {
    expect(detectTeamStorylineSignals(world(params), 'target')
      .some(signal => signal.type === 'promoted_survival')).toBe(expected);
  });
});

describe('chronological unbeaten stories', () => {
  it('requires a meaningful run and adapts the threshold to league length', () => {
    const shortFive = withTimeline(
      world({ expectation: 3, rank: 4, played: 5 }),
      leagueRun(UNBEATEN_RUN_TRIGGER_SHORT - 1),
    );
    const shortSix = withTimeline(
      world({ expectation: 3, rank: 4, played: 6 }),
      leagueRun(UNBEATEN_RUN_TRIGGER_SHORT),
    );
    const longSix = withTimeline(
      world({ expectation: 3, rank: 6, played: 6 }),
      leagueRun(UNBEATEN_RUN_TRIGGER_LONG - 1),
    );
    longSix.league1Standings = table(6, 6, 16);
    const longSeven = withTimeline(
      world({ expectation: 3, rank: 6, played: 7 }),
      leagueRun(UNBEATEN_RUN_TRIGGER_LONG),
    );
    longSeven.league1Standings = table(6, 7, 16);

    expect(detectTeamStorylineSignals(shortFive, 'target')
      .some(signal => signal.type === 'unbeaten_run')).toBe(false);
    expect(detectTeamStorylineSignals(shortSix, 'target'))
      .toContainEqual(expect.objectContaining({ type: 'unbeaten_run', phase: '出现' }));
    expect(detectTeamStorylineSignals(longSix, 'target')
      .some(signal => signal.type === 'unbeaten_run')).toBe(false);
    expect(detectTeamStorylineSignals(longSeven, 'target'))
      .toContainEqual(expect.objectContaining({ type: 'unbeaten_run', phase: '出现' }));
  });

  it('reconstructs only the trailing league run in chronological window order', () => {
    const timeline = [
      result({ id: 'opening-loss', outcome: 'loss' }),
      ...leagueRun(7),
      result({ id: 'cup-noise', competitionType: 'league_cup', competitionName: '联赛杯', outcome: 'loss' }),
    ];
    const current = withTimeline(world({ expectation: 3, rank: 4, played: 8 }), timeline);
    const signal = detectTeamStorylineSignals(current, 'target')
      .find(item => item.type === 'unbeaten_run');

    expect(signal).toMatchObject({ phase: '出现' });
    expect(signal?.evidence).toContain('联赛连续7场不败');
  });

  it('moves through development and climax from authoritative league results', () => {
    const development = withTimeline(
      world({ expectation: 3, rank: 4, played: 9 }),
      leagueRun(9),
    );
    const climax = withTimeline(
      world({ expectation: 3, rank: 4, played: 12 }),
      leagueRun(12),
    );

    expect(detectTeamStorylineSignals(development, 'target'))
      .toContainEqual(expect.objectContaining({ type: 'unbeaten_run', phase: '发展' }));
    expect(detectTeamStorylineSignals(climax, 'target'))
      .toContainEqual(expect.objectContaining({ type: 'unbeaten_run', phase: '高潮' }));
  });

  it('concludes immediately on defeat, preserves the peak, and honors cooldown across seasons', () => {
    const started = advanceStorylines(withTimeline(
      world({ expectation: 3, rank: 4, played: 6 }),
      leagueRun(6),
    )).world;
    expect(started.activeStorylines).toContainEqual(expect.objectContaining({ type: 'unbeaten_run' }));

    const interrupted = advanceStorylines(withTimeline(
      move(started, 4, 7),
      [...leagueRun(6), result({ id: 'run-ending-loss', outcome: 'loss' })],
    )).world;
    expect(interrupted.activeStorylines?.some(item => item.type === 'unbeaten_run')).toBe(false);
    expect(interrupted.storylineHistory?.at(-1)).toMatchObject({
      type: 'unbeaten_run',
      phase: '落幕',
      conclusion: expect.stringContaining('定格在6场'),
    });

    const coolingUntil = interrupted.storylineCooldowns?.at(-1)?.untilElapsedWindow ?? 0;
    const nextSeason = withTimeline(
      move(interrupted, 4, 6, 2),
      leagueRun(6),
    );
    nextSeason.totalElapsedWindows = coolingUntil - 1;
    expect(advanceStorylines(nextSeason).world.activeStorylines).toHaveLength(0);

    const cooled = { ...nextSeason, totalElapsedWindows: coolingUntil };
    expect(advanceStorylines(cooled).world.activeStorylines)
      .toContainEqual(expect.objectContaining({ type: 'unbeaten_run', seasonNumber: 2 }));
  });

  it('writes a factual season-boundary conclusion', () => {
    const current = withTimeline(
      world({ expectation: 3, rank: 4, played: 9 }),
      leagueRun(9),
    );
    const started = advanceStorylines(current).world;
    const finalized = advanceStorylines(started, { finalizeSeason: true }).world;
    expect(finalized.storylineHistory?.find(item => item.type === 'unbeaten_run')).toMatchObject({
      outcome: 'success',
      conclusion: expect.stringContaining('本赛季联赛不败最终定格在9场'),
    });
  });
});

describe('cup giant-killer stories', () => {
  it('rejects one low-stage upset and accepts repeated or high-stage upsets', () => {
    const singleEarly = withTimeline(
      world({ expectation: 3, rank: 4, played: 8 }),
      [cupUpset('cup-r16', 'R16')],
    );
    const repeated = withTimeline(
      world({ expectation: 3, rank: 4, played: 8 }),
      [cupUpset('cup-r16', 'R16'), cupUpset('cup-qf', 'QF')],
    );
    const highStage = withTimeline(
      world({ expectation: 3, rank: 4, played: 8 }),
      [cupUpset('cup-sf', 'SF')],
    );
    const unsupported = withTimeline(
      world({ expectation: 3, rank: 4, played: 8 }),
      [result({
        id: 'cup-normal-sf', competitionType: 'league_cup', competitionName: '联赛杯',
        roundLabel: 'SF', outcome: 'win', targetWinProbability: 60,
      })],
    );

    expect(detectTeamStorylineSignals(singleEarly, 'target')
      .some(signal => signal.type === 'cup_giant_killer')).toBe(false);
    expect(detectTeamStorylineSignals(repeated, 'target'))
      .toContainEqual(expect.objectContaining({
        type: 'cup_giant_killer', phase: '出现', competitionName: '联赛杯',
      }));
    expect(detectTeamStorylineSignals(highStage, 'target'))
      .toContainEqual(expect.objectContaining({ type: 'cup_giant_killer', phase: '发展' }));
    expect(detectTeamStorylineSignals(unsupported, 'target')
      .some(signal => signal.type === 'cup_giant_killer')).toBe(false);
  });

  it('reaches a climax only when the giant-killing campaign wins the final', () => {
    const current = withTimeline(
      world({ expectation: 3, rank: 4, played: 8 }),
      [cupUpset('cup-sf', 'SF'), cupUpset('cup-final', '决赛')],
    );
    expect(detectTeamStorylineSignals(current, 'target'))
      .toContainEqual(expect.objectContaining({ type: 'cup_giant_killer', phase: '高潮' }));
  });

  it('describes a rounded zero forecast as below one percent, not impossible', () => {
    const nearImpossible = result({
      id: 'cup-near-impossible',
      competitionType: 'league_cup',
      competitionName: '联赛杯',
      roundLabel: 'R16',
      outcome: 'win',
      targetWinProbability: 0,
    });
    const current = withTimeline(
      world({ expectation: 3, rank: 4, played: 8 }),
      [nearImpossible, cupUpset('cup-qf', 'QF')],
    );
    const signal = detectTeamStorylineSignals(current, 'target')
      .find(item => item.type === 'cup_giant_killer');

    expect(signal?.evidence.join(' ')).toContain('低于1%');
    expect(signal?.evidence.join(' ')).not.toContain('约0%');
  });

  it('does not treat a first-leg defeat as elimination when a return leg exists', () => {
    const upcoming: MatchFixture = {
      id: 'cup-sf-leg-2',
      homeTeamId: 'other-0',
      awayTeamId: 'target',
      competitionType: 'league_cup',
      competitionName: '联赛杯',
      roundLabel: 'SF 次回合',
      leg: 2,
    };
    const current = withTimeline(
      world({ expectation: 3, rank: 4, played: 8 }),
      [
        cupUpset('cup-r16', 'R16'),
        cupUpset('cup-qf', 'QF'),
        cupUpset('cup-sf-leg-1', 'SF 首回合', 'loss'),
      ],
      upcoming,
    );
    expect(detectTeamStorylineSignals(current, 'target'))
      .toContainEqual(expect.objectContaining({ type: 'cup_giant_killer' }));
  });

  it('concludes on elimination, enters cooldown, and keeps its competition context', () => {
    const qualifying = withTimeline(
      world({ expectation: 3, rank: 4, played: 8 }),
      [cupUpset('cup-r16', 'R16'), cupUpset('cup-qf', 'QF')],
    );
    const started = advanceStorylines(qualifying).world;
    expect(started.activeStorylines).toContainEqual(expect.objectContaining({
      type: 'cup_giant_killer', competitionName: '联赛杯',
    }));

    const eliminated = advanceStorylines(withTimeline(
      started,
      [
        cupUpset('cup-r16', 'R16'),
        cupUpset('cup-qf', 'QF'),
        cupUpset('cup-sf-loss', 'SF', 'loss'),
      ],
    )).world;
    expect(eliminated.activeStorylines?.some(item => item.type === 'cup_giant_killer')).toBe(false);
    expect(eliminated.storylineHistory?.at(-1)).toMatchObject({
      type: 'cup_giant_killer',
      competitionName: '联赛杯',
      phase: '落幕',
      conclusion: expect.stringContaining('联赛杯'),
    });
    expect(eliminated.storylineCooldowns?.at(-1)?.key).toContain('cup_giant_killer');
  });

  it('records a champion conclusion at the season boundary', () => {
    const current = withTimeline(
      world({ expectation: 3, rank: 4, played: 8 }),
      [cupUpset('cup-sf', 'SF'), cupUpset('cup-final', '决赛')],
    );
    const started = advanceStorylines(current).world;
    const finalized = advanceStorylines(started, { finalizeSeason: true }).world;
    expect(finalized.storylineHistory?.find(item => item.type === 'cup_giant_killer')).toMatchObject({
      outcome: 'success',
      conclusion: expect.stringContaining('最终夺冠'),
    });
  });

  it('keeps competition-specific arc identities structured and stable', () => {
    expect(getStorylineArcKey('target', 'cup_giant_killer', '联赛杯'))
      .toBe(getStorylineArcKey('target', 'cup_giant_killer', '联赛杯'));
    expect(getStorylineArcKey('target', 'cup_giant_killer', '联赛杯'))
      .not.toBe(getStorylineArcKey('target', 'cup_giant_killer', '大陆杯'));
  });
});

describe('storyline lifecycle', () => {
  it('starts deterministically without consuming RNG and only reports meaningful changes', () => {
    const initial = world({ rank: 2, played: 4 });
    const first = advanceStorylines(initial);
    expect(first.world.rngState).toBe(initial.rngState);
    expect(first.world.activeStorylines).toHaveLength(1);
    expect(first.news).toHaveLength(1);
    expect(first.news[0]).toMatchObject({ type: 'storyline', title: expect.stringContaining('故事出现') });

    const development = advanceStorylines(move(first.world, 2, 7));
    expect(development.world.activeStorylines?.[0].phase).toBe('发展');
    expect(development.news[0]?.title).toContain('故事升级');

    const unchanged = advanceStorylines(move(development.world, 2, 8));
    expect(unchanged.news).toEqual([]);
    expect(unchanged.world.activeStorylines?.[0].phase).toBe('发展');
  });

  it('requires two quiet windows before ending and never flaps on one weak window', () => {
    const started = advanceStorylines(world({ rank: 2, played: 4 })).world;
    const firstQuiet = advanceStorylines(move(started, 4, 5));
    expect(firstQuiet.world.activeStorylines?.[0].quietWindows).toBe(1);
    expect(firstQuiet.world.storylineHistory).toHaveLength(0);

    const secondQuiet = advanceStorylines(move(firstQuiet.world, 4, 6));
    expect(secondQuiet.world.activeStorylines).toHaveLength(0);
    expect(secondQuiet.world.storylineHistory?.[0]).toMatchObject({
      type: 'dark_horse',
      phase: '落幕',
      outcome: 'failure',
    });
    expect(secondQuiet.news[0]?.title).toContain('故事落幕');
  });

  it('resolves a midseason giant crisis after two windows below the crisis threshold', () => {
    const initial = world({ expectation: 5, rank: 3, played: 8, pressure: 20 });
    initial.activeStorylines = [activeStory('giant_crisis')];
    const firstQuiet = advanceStorylines(initial).world;
    const secondQuiet = advanceStorylines(move(firstQuiet, 3, 9));

    expect(secondQuiet.world.storylineHistory?.[0]).toMatchObject({
      type: 'giant_crisis',
      phase: '落幕',
      outcome: 'success',
      conclusion: expect.stringContaining('连续两个观察窗口'),
    });
    expect(secondQuiet.world.storylineHistory?.[0].conclusion).not.toContain('最终排名');
  });

  it('keeps an ended story cooling across a season boundary before allowing restart', () => {
    const started = advanceStorylines(world({ rank: 2, played: 4 })).world;
    const quiet = advanceStorylines(move(started, 4, 5)).world;
    const ended = advanceStorylines(move(quiet, 4, 6)).world;
    const coolingUntil = ended.storylineCooldowns?.[0].untilElapsedWindow ?? 0;
    expect(coolingUntil).toBe(6 + STORYLINE_COOLDOWN_WINDOWS);

    const nextSeason = move(ended, 2, 7, 2);
    expect(advanceStorylines(nextSeason).world.activeStorylines).toHaveLength(0);

    const afterCooldown = {
      ...move(ended, 2, coolingUntil, 2),
      totalElapsedWindows: coolingUntil,
    };
    expect(advanceStorylines(afterCooldown).world.activeStorylines).toHaveLength(1);
  });

  it.each([
    ['dark_horse', { expectation: 2, rank: 2 }, 'success'],
    ['dark_horse', { expectation: 2, rank: 7 }, 'failure'],
    ['giant_crisis', { expectation: 5, rank: 2 }, 'success'],
    ['giant_crisis', { expectation: 5, rank: 7 }, 'failure'],
    ['promoted_survival', { expectation: 3, rank: 5 }, 'success'],
    ['promoted_survival', { expectation: 3, rank: 7 }, 'failure'],
  ] as const)('settles %s at season end as %s', (type, params, outcome) => {
    const current = world({ ...params, played: 14 });
    current.activeStorylines = [activeStory(type)];
    const result = advanceStorylines(current, { finalizeSeason: true });
    expect(result.world.activeStorylines).toHaveLength(0);
    expect(result.world.storylineHistory?.[0]).toMatchObject({
      type,
      phase: '落幕',
      outcome,
      conclusion: expect.any(String),
    });
  });

  it('produces identical state and news for identical worlds', () => {
    const initial = world({ rank: 2, played: 8 });
    const first = advanceStorylines(initial);
    const second = advanceStorylines(initial);
    expect(second).toEqual(first);
  });

  it('keeps the season director bounded even as older stories end', () => {
    const initial = world({ rank: 2, played: 8 });
    initial.storylineHistory = Array.from({ length: MAX_STORYLINES_PER_SEASON }, (_, index) => ({
      ...activeStory('dark_horse'),
      id: `completed-${index}`,
      teamId: `completed-team-${index}`,
      phase: '落幕',
      outcome: 'failure',
      conclusion: '已结束',
    }));

    const result = advanceStorylines(initial);
    expect(result.world.activeStorylines).toHaveLength(0);
    expect(result.news).toEqual([]);
  });

  it('keeps type quotas inside the eight-story season budget', () => {
    expect(Object.values(STORYLINES_PER_TYPE_PER_SEASON)
      .reduce((total, cap) => total + cap, 0)).toBe(MAX_STORYLINES_PER_SEASON);
    const initial = world({ rank: 2, played: 8 });
    initial.storylineHistory = Array.from(
      { length: STORYLINES_PER_TYPE_PER_SEASON.dark_horse },
      (_, index) => ({
        ...activeStory('dark_horse'),
        id: `archived-dark-horse-${index}`,
        teamId: `archived-team-${index}`,
        phase: '落幕' as const,
        outcome: 'failure' as const,
        conclusion: '已结束',
      }),
    );

    const advanced = advanceStorylines(initial);
    expect(advanced.world.activeStorylines?.some(item => item.type === 'dark_horse')).toBe(false);
  });

  it('names the team in a focus-fixture story relation', () => {
    const current = world();
    current.activeStorylines = [activeStory('giant_crisis')];
    expect(getFixtureStorylineLabel(current, 'target', 'other-0')).toBe('目标危机转折战');

    current.activeStorylines = [activeStory('unbeaten_run')];
    expect(getFixtureStorylineLabel(current, 'target', 'other-0')).toBe('目标不败延续战');

    current.activeStorylines = [{ ...activeStory('cup_giant_killer'), competitionName: '联赛杯' }];
    expect(getFixtureStorylineLabel(current, 'target', 'other-0')).toBe('目标巨人杀手征程');
  });
});

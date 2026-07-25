import { describe, expect, it } from 'vitest';
import type { StandingEntry } from '../../types/league';
import type { SeasonRecord, TeamBase, TeamState } from '../../types/team';
import type { GameWorld } from './season-manager';
import {
  advanceStorylines,
  detectTeamStorylineSignals,
  getFixtureStorylineLabel,
  STORYLINE_COOLDOWN_WINDOWS,
  MAX_STORYLINES_PER_SEASON,
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

function table(rank: number, played: number): StandingEntry[] {
  let other = 0;
  return Array.from({ length: 8 }, (_, index) => {
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

  it('names the team in a focus-fixture story relation', () => {
    const current = world();
    current.activeStorylines = [activeStory('giant_crisis')];
    expect(getFixtureStorylineLabel(current, 'target', 'other-0')).toBe('目标危机转折战');
  });
});

import { describe, expect, it } from 'vitest';
import type { ContinentalCupState, CupFixture } from '../../types/cup';
import type { MatchResult, MatchStats } from '../../types/match';
import { SeededRNG } from '../match/rng';
import {
  advanceContinentalCup,
  continentalCupWindowCount,
  getContinentalCupCurrentFixtures,
  initContinentalCup,
} from './continental-cup';

const EMPTY_STATS: MatchStats = {
  possession: [50, 50],
  shots: [0, 0],
  shotsOnTarget: [0, 0],
  corners: [0, 0],
  fouls: [0, 0],
  yellowCards: [0, 0],
  redCards: [0, 0],
};

function homeWins(fixture: CupFixture): MatchResult {
  return {
    fixtureId: fixture.id,
    homeTeamId: fixture.homeTeamId,
    awayTeamId: fixture.awayTeamId,
    homeGoals: 1,
    awayGoals: 0,
    extraTime: false,
    penalties: false,
    events: [],
    stats: EMPTY_STATS,
    competitionType: 'continental_cup',
    competitionName: '洲际杯',
    roundLabel: fixture.roundName,
    isNeutralVenue: true,
  };
}

function playCurrent(cup: ContinentalCupState): ContinentalCupState {
  return advanceContinentalCup(
    cup,
    getContinentalCupCurrentFixtures(cup).map(homeWins),
  );
}

function expectSingleRoundRobin(cup: ContinentalCupState): void {
  for (const group of cup.groups) {
    expect(group.teamIds).toHaveLength(4);
    expect(group.fixtures).toHaveLength(6);
    expect(group.fixtures.every(fixture => fixture.isNeutralVenue)).toBe(true);

    const appearances = new Map(group.teamIds.map(teamId => [teamId, 0]));
    const pairs = new Set<string>();
    for (const fixture of group.fixtures) {
      appearances.set(fixture.homeTeamId, appearances.get(fixture.homeTeamId)! + 1);
      appearances.set(fixture.awayTeamId, appearances.get(fixture.awayTeamId)! + 1);
      pairs.add([fixture.homeTeamId, fixture.awayTeamId].sort().join(':'));
    }
    expect([...appearances.values()]).toEqual([3, 3, 3, 3]);
    expect(pairs.size).toBe(6);
  }
}

const TEAMS_16 = Array.from({ length: 16 }, (_, index) => `m${index + 1}`);
const TEAMS_8 = Array.from({ length: 8 }, (_, index) => `s${index + 1}`);
const TEAMS_4 = Array.from({ length: 4 }, (_, index) => `s${index + 1}`);

describe('initContinentalCup', () => {
  it('rejects regions that cannot form complete four-team groups', () => {
    expect(() => initContinentalCup('大陆', ['a', 'b'], 5, new SeededRNG(0))).toThrow(/four-team groups/);
    expect(() => initContinentalCup('南洲', [...TEAMS_4, 'extra'], 5, new SeededRNG(0))).toThrow(/four-team groups/);
  });

  it('draws all 16 Mainland teams into four seeded neutral groups', () => {
    const cup = initContinentalCup('大陆', TEAMS_16, 5, new SeededRNG(11));
    expect(cup).toMatchObject({
      type: 'mainland_cup',
      region: '大陆',
      name: '大陆杯',
      currentRound: 0,
      groupStageCompleted: false,
      completed: false,
    });
    expect(cup.groups).toHaveLength(4);
    expect(cup.rounds).toHaveLength(0);
    expect(new Set(cup.groups.flatMap(group => group.teamIds))).toEqual(new Set(TEAMS_16));
    expectSingleRoundRobin(cup);

    for (const group of cup.groups) {
      expect(group.teamIds.filter(teamId => TEAMS_16.slice(0, 4).includes(teamId))).toHaveLength(1);
      expect(group.teamIds.filter(teamId => TEAMS_16.slice(4, 8).includes(teamId))).toHaveLength(1);
      expect(group.teamIds.filter(teamId => TEAMS_16.slice(8, 12).includes(teamId))).toHaveLength(1);
      expect(group.teamIds.filter(teamId => TEAMS_16.slice(12, 16).includes(teamId))).toHaveLength(1);
    }
    expect(continentalCupWindowCount(cup)).toBe(6);
  });

  it.each([
    ['南洲', 'southern_cup'],
    ['东洲', 'eastern_cup'],
  ] as const)('draws all eight %s teams into two neutral groups', (region, type) => {
    const cup = initContinentalCup(region, TEAMS_8, 5, new SeededRNG(22));
    expect(cup.type).toBe(type);
    expect(cup.groups).toHaveLength(2);
    expectSingleRoundRobin(cup);
    expect(continentalCupWindowCount(cup)).toBe(5);
  });

  it('is deterministic for the same seed and coefficient order', () => {
    const first = initContinentalCup('大陆', TEAMS_16, 11, new SeededRNG(42));
    const second = initContinentalCup('大陆', TEAMS_16, 11, new SeededRNG(42));
    expect(first.groups.map(group => group.teamIds)).toEqual(second.groups.map(group => group.teamIds));
    expect(first.groups.flatMap(group => group.fixtures)).toEqual(second.groups.flatMap(group => group.fixtures));
  });
});

describe('advanceContinentalCup', () => {
  it('runs Mainland through three group rounds, QF, SF and Final', () => {
    let cup = initContinentalCup('大陆', TEAMS_16, 5, new SeededRNG(11));

    for (let round = 1; round <= 3; round++) {
      const fixtures = getContinentalCupCurrentFixtures(cup);
      expect(fixtures).toHaveLength(8);
      expect(new Set(fixtures.map(fixture => fixture.round))).toEqual(new Set([round]));
      cup = playCurrent(cup);
    }

    expect(cup.groupStageCompleted).toBe(true);
    expect(cup.groups.every(group => group.standings.every(entry => entry.played === 3))).toBe(true);
    expect(cup.rounds).toHaveLength(1);
    expect(cup.rounds[0].roundName).toBe('QF');
    expect(cup.rounds[0].fixtures).toHaveLength(4);

    cup = playCurrent(cup);
    expect(cup.rounds).toHaveLength(2);
    expect(cup.rounds[1].roundName).toBe('SF');
    expect(cup.rounds[1].fixtures).toHaveLength(2);

    cup = playCurrent(cup);
    expect(cup.rounds).toHaveLength(3);
    expect(cup.rounds[2].roundName).toBe('Final');
    expect(cup.rounds[2].fixtures).toHaveLength(1);

    const final = cup.rounds[2].fixtures[0];
    cup = playCurrent(cup);
    expect(cup.completed).toBe(true);
    expect(cup.winnerId).toBe(final.homeTeamId);
    expect(cup.rounds.flatMap(round => round.fixtures).every(fixture => fixture.isNeutralVenue)).toBe(true);
  });

  it('runs Southern/Eastern through three group rounds, SF and Final', () => {
    let cup = initContinentalCup('南洲', TEAMS_8, 11, new SeededRNG(99));
    cup = playCurrent(playCurrent(playCurrent(cup)));
    expect(cup.groupStageCompleted).toBe(true);
    expect(cup.rounds).toHaveLength(1);
    expect(cup.rounds[0].roundName).toBe('SF');

    cup = playCurrent(cup);
    const final = cup.rounds[1].fixtures[0];
    cup = playCurrent(cup);
    expect(cup.completed).toBe(true);
    expect(cup.winnerId).toBe(final.homeTeamId);
  });

  it('uses qualification order as the stable final group tie-break', () => {
    let cup = initContinentalCup('南洲', TEAMS_4, 5, new SeededRNG(5));
    for (let round = 0; round < 3; round++) {
      const draws = getContinentalCupCurrentFixtures(cup).map(fixture => ({
        ...homeWins(fixture),
        homeGoals: 0,
        awayGoals: 0,
      }));
      cup = advanceContinentalCup(cup, draws);
    }
    expect(cup.groups[0].standings.map(entry => entry.teamId))
      .toEqual(TEAMS_4);
  });

  it('resolves a tied final through penalties', () => {
    let cup = initContinentalCup('东洲', TEAMS_4, 17, new SeededRNG(123));
    cup = playCurrent(playCurrent(playCurrent(cup)));
    const final = cup.rounds[0].fixtures[0];
    cup = advanceContinentalCup(cup, [{
      ...homeWins(final),
      homeGoals: 1,
      awayGoals: 1,
      extraTime: true,
      etHomeGoals: 0,
      etAwayGoals: 0,
      penalties: true,
      penaltyHome: 3,
      penaltyAway: 5,
    }]);
    expect(cup.completed).toBe(true);
    expect(cup.winnerId).toBe(final.awayTeamId);
  });

  it('rejects an unresolved tied final without favoring the home slot', () => {
    let cup = initContinentalCup('南洲', TEAMS_4, 5, new SeededRNG(123));
    cup = playCurrent(playCurrent(playCurrent(cup)));
    const before = structuredClone(cup);
    const final = cup.rounds[0].fixtures[0];

    expect(() => advanceContinentalCup(cup, [{
      ...homeWins(final),
      homeGoals: 0,
      awayGoals: 0,
    }])).toThrow(/Unresolved knockout result/);
    expect(cup).toEqual(before);
  });

  it('rejects a partial window and leaves the input state unchanged', () => {
    const cup = initContinentalCup('大陆', TEAMS_16, 5, new SeededRNG(1));
    const before = structuredClone(cup);
    const fixtures = getContinentalCupCurrentFixtures(cup);
    expect(() => advanceContinentalCup(cup, fixtures.slice(0, 2).map(homeWins))).toThrow(/Missing result/);
    expect(cup).toEqual(before);
  });
});

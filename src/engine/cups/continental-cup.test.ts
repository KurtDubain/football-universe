import { describe, it, expect } from 'vitest';
import {
  initContinentalCup,
  advanceContinentalCup,
  getContinentalCupCurrentFixtures,
} from './continental-cup';
import { SeededRNG } from '../match/rng';
import { MatchResult, MatchStats } from '../../types/match';
import { CupFixture } from '../../types/cup';

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
  };
}

const TEAMS_8  = Array.from({ length: 8 },  (_, i) => `s${i + 1}`);
const TEAMS_4  = Array.from({ length: 4 },  (_, i) => `e${i + 1}`);

describe('initContinentalCup', () => {
  it('rejects mismatched team counts per region', () => {
    expect(() => initContinentalCup('大陆', ['a', 'b'], 1, new SeededRNG(0))).toThrow(/8/);
    expect(() => initContinentalCup('南洲', TEAMS_8, 1, new SeededRNG(0))).toThrow(/4/);
    expect(() => initContinentalCup('东洲', ['a', 'b', 'c'], 1, new SeededRNG(0))).toThrow(/4/);
  });

  it('builds a 大陆杯 QF round covering all 8 qualified teams', () => {
    const cup = initContinentalCup('大陆', TEAMS_8, 18, new SeededRNG(11));
    expect(cup.type).toBe('mainland_cup');
    expect(cup.region).toBe('大陆');
    expect(cup.name).toBe('大陆杯');
    expect(cup.currentRound).toBe(1);
    expect(cup.rounds).toHaveLength(1);
    expect(cup.rounds[0].roundName).toBe('QF');
    expect(cup.rounds[0].fixtures).toHaveLength(4);
    // Every team should appear exactly once
    const teamsUsed = cup.rounds[0].fixtures.flatMap((f) => [f.homeTeamId, f.awayTeamId]);
    expect(new Set(teamsUsed).size).toBe(8);
    // Fixture ids embed the season + type
    expect(cup.rounds[0].fixtures[0].id).toMatch(/^CC-mainland_cup-S18-QF-M1$/);
  });

  it('builds a 南洲杯 SF round covering four qualified teams', () => {
    const cup = initContinentalCup('南洲', TEAMS_4, 18, new SeededRNG(22));
    expect(cup.type).toBe('southern_cup');
    expect(cup.region).toBe('南洲');
    expect(cup.rounds[0].roundName).toBe('SF');
    expect(cup.rounds[0].fixtures).toHaveLength(2);
    expect(cup.rounds[0].fixtures[0].id).toMatch(/^CC-southern_cup-S18-SF-M1$/);
  });

  it('builds a 东洲杯 SF round (tagged eastern_cup)', () => {
    const cup = initContinentalCup('东洲', TEAMS_4, 22, new SeededRNG(33));
    expect(cup.type).toBe('eastern_cup');
    expect(cup.region).toBe('东洲');
    expect(cup.rounds[0].fixtures[0].id).toMatch(/^CC-eastern_cup-S22-SF-M1$/);
  });

  it('produces deterministic pairings for the same seed', () => {
    const a = initContinentalCup('大陆', TEAMS_8, 2, new SeededRNG(42));
    const b = initContinentalCup('大陆', TEAMS_8, 2, new SeededRNG(42));
    expect(a.rounds[0].fixtures.map((f) => [f.homeTeamId, f.awayTeamId]))
      .toEqual(b.rounds[0].fixtures.map((f) => [f.homeTeamId, f.awayTeamId]));
  });
});

describe('getContinentalCupCurrentFixtures', () => {
  it('returns the active round fixtures', () => {
    const cup = initContinentalCup('大陆', TEAMS_8, 18, new SeededRNG(7));
    const fixtures = getContinentalCupCurrentFixtures(cup);
    expect(fixtures).toHaveLength(4);
    expect(fixtures[0].round).toBe(1);
  });
});

describe('advanceContinentalCup', () => {
  it('runs 大陆杯 QF → SF → Final and marks completed after the Final', () => {
    let cup = initContinentalCup('大陆', TEAMS_8, 18, new SeededRNG(11));

    // QF → SF
    let results = cup.rounds[0].fixtures.map(homeWins);
    cup = advanceContinentalCup(cup, results);
    expect(cup.rounds[0].completed).toBe(true);
    expect(cup.rounds).toHaveLength(2);
    expect(cup.rounds[1].roundName).toBe('SF');
    expect(cup.rounds[1].fixtures).toHaveLength(2);
    expect(cup.completed).toBe(false);

    // SF → Final
    results = cup.rounds[1].fixtures.map(homeWins);
    cup = advanceContinentalCup(cup, results);
    expect(cup.rounds[2].roundName).toBe('Final');
    expect(cup.rounds[2].fixtures).toHaveLength(1);
    expect(cup.completed).toBe(false);

    // Final
    const finalFixture = cup.rounds[2].fixtures[0];
    cup = advanceContinentalCup(cup, [homeWins(finalFixture)]);
    expect(cup.completed).toBe(true);
    expect(cup.winnerId).toBe(finalFixture.homeTeamId);

    cup.rounds.forEach((r) => {
      r.fixtures.forEach((f) => expect(f.winnerId).toBeTruthy());
    });
  });

  it('runs 南洲杯 SF → Final (2 rounds for 4-team cups)', () => {
    let cup = initContinentalCup('南洲', TEAMS_4, 18, new SeededRNG(99));
    // SF
    cup = advanceContinentalCup(cup, cup.rounds[0].fixtures.map(homeWins));
    expect(cup.rounds[1].roundName).toBe('Final');
    expect(cup.rounds[1].fixtures).toHaveLength(1);
    // Final
    const finalFix = cup.rounds[1].fixtures[0];
    cup = advanceContinentalCup(cup, [homeWins(finalFix)]);
    expect(cup.completed).toBe(true);
    expect(cup.winnerId).toBe(finalFix.homeTeamId);
  });

  it('resolves a final tied after extra time via penalty shootout', () => {
    let cup = initContinentalCup('东洲', TEAMS_4, 22, new SeededRNG(123));
    // Advance to final with home wins
    cup = advanceContinentalCup(cup, cup.rounds[0].fixtures.map(homeWins));
    const finalFix = cup.rounds[1].fixtures[0];
    const tiedResult: MatchResult = {
      fixtureId: finalFix.id,
      homeTeamId: finalFix.homeTeamId,
      awayTeamId: finalFix.awayTeamId,
      homeGoals: 1, awayGoals: 1,
      extraTime: true, etHomeGoals: 0, etAwayGoals: 0,
      penalties: true, penaltyHome: 3, penaltyAway: 5,
      events: [], stats: EMPTY_STATS,
      competitionType: 'continental_cup', competitionName: '东洲杯',
      roundLabel: 'Final',
    };
    cup = advanceContinentalCup(cup, [tiedResult]);
    expect(cup.completed).toBe(true);
    expect(cup.winnerId).toBe(finalFix.awayTeamId);
  });

  it('throws when a fixture is missing from results', () => {
    const cup = initContinentalCup('大陆', TEAMS_8, 18, new SeededRNG(1));
    // Pass only half the results
    const partial = cup.rounds[0].fixtures.slice(0, 2).map(homeWins);
    expect(() => advanceContinentalCup(cup, partial)).toThrow(/Missing result/);
  });
});

import { describe, it, expect } from 'vitest';
import { initLeagueCup, advanceLeagueCup } from './league-cup';
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

/**
 * Build a MatchResult where the home team always wins 1-0 (lets us deterministically
 * advance the cup without invoking the real simulator).
 */
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
    competitionType: 'league_cup',
    competitionName: '联赛杯',
    roundLabel: fixture.roundName,
  };
}

const TEAMS_32 = Array.from({ length: 32 }, (_, i) => `t${i + 1}`);

describe('initLeagueCup', () => {
  it('throws on non-32 input', () => {
    expect(() => initLeagueCup(['a', 'b'], 1, new SeededRNG(0))).toThrow(/32 teams/);
    expect(() =>
      initLeagueCup(Array.from({ length: 31 }, (_, i) => `t${i}`), 1, new SeededRNG(0)),
    ).toThrow(/32 teams/);
  });

  it('initialises an R32 round with 16 fixtures covering all 32 teams', () => {
    const cup = initLeagueCup(TEAMS_32, 1, new SeededRNG(11));
    expect(cup.type).toBe('league_cup');
    expect(cup.completed).toBe(false);
    expect(cup.currentRound).toBe(1);
    expect(cup.rounds).toHaveLength(1);
    const r1 = cup.rounds[0];
    expect(r1.roundName).toBe('R32');
    expect(r1.fixtures).toHaveLength(16);
    const teamsUsed = r1.fixtures.flatMap((f) => [f.homeTeamId, f.awayTeamId]);
    expect(new Set(teamsUsed).size).toBe(32);
  });
});

describe('advanceLeagueCup', () => {
  it('produces R16, QF, SF, Final and marks completed=true after the Final', () => {
    let cup = initLeagueCup(TEAMS_32, 1, new SeededRNG(11));

    // R32 -> R16
    let results = cup.rounds[0].fixtures.map(homeWins);
    cup = advanceLeagueCup(cup, results);
    expect(cup.rounds[0].completed).toBe(true);
    expect(cup.rounds).toHaveLength(2);
    expect(cup.rounds[1].roundName).toBe('R16');
    expect(cup.rounds[1].fixtures).toHaveLength(8);
    expect(cup.completed).toBe(false);

    // R16 -> QF
    results = cup.rounds[1].fixtures.map(homeWins);
    cup = advanceLeagueCup(cup, results);
    expect(cup.rounds[2].roundName).toBe('QF');
    expect(cup.rounds[2].fixtures).toHaveLength(4);

    // QF -> SF
    results = cup.rounds[2].fixtures.map(homeWins);
    cup = advanceLeagueCup(cup, results);
    expect(cup.rounds[3].roundName).toBe('SF');
    expect(cup.rounds[3].fixtures).toHaveLength(2);

    // SF -> Final
    results = cup.rounds[3].fixtures.map(homeWins);
    cup = advanceLeagueCup(cup, results);
    expect(cup.rounds[4].roundName).toBe('Final');
    expect(cup.rounds[4].fixtures).toHaveLength(1);
    expect(cup.completed).toBe(false);

    // Final
    const finalFixture = cup.rounds[4].fixtures[0];
    cup = advanceLeagueCup(cup, [homeWins(finalFixture)]);
    expect(cup.completed).toBe(true);
    expect(cup.winnerId).toBe(finalFixture.homeTeamId);

    // All round-level fixtures have a winnerId set
    cup.rounds.forEach((r) => {
      r.fixtures.forEach((f) => expect(f.winnerId).toBeTruthy());
    });
  });
});

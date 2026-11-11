import { describe, it, expect } from 'vitest';
import {
  ballonDorScore,
  buildBallonDorContextResolver,
  type BallonDorContext,
} from './ballon-dor';
import type { StandingEntry } from '../../types/league';
import type { WorldCupState } from '../../types/cup';

/** Top flight size used by `config/competitions.ts`. */
const LEAGUE_SIZE = 16;

function ctx(over: Partial<BallonDorContext> = {}): BallonDorContext {
  return {
    isLeagueChampion: false,
    leaguePosition: 8,
    leagueSize: LEAGUE_SIZE,
    wonContinentalCup: false,
    wonWorldCup: false,
    domesticCupCount: 0,
    leagueLevel: 1,
    minutesPlayed: 2700,
    ...over,
  };
}

describe('ballonDorScore — team achievement', () => {
  it('lifts a champion above an identical mid-table player', () => {
    const champion = ballonDorScore(80, ctx({ isLeagueChampion: true, leaguePosition: 1 }));
    const midTable = ballonDorScore(80, ctx({ leaguePosition: 8 }));
    expect(champion).toBeGreaterThan(midTable);
    expect(champion).toBeCloseTo(80 * 1.18, 6);
  });

  it('rewards a top-four finish less than a title', () => {
    const champion = ballonDorScore(80, ctx({ isLeagueChampion: true, leaguePosition: 1 }));
    const topFour = ballonDorScore(80, ctx({ leaguePosition: 3 }));
    const midTable = ballonDorScore(80, ctx({ leaguePosition: 9 }));
    expect(champion).toBeGreaterThan(topFour);
    expect(topFour).toBeGreaterThan(midTable);
  });

  it('penalises a bottom-four finish', () => {
    const bottom = ballonDorScore(80, ctx({ leaguePosition: 15 }));
    const midTable = ballonDorScore(80, ctx({ leaguePosition: 8 }));
    expect(bottom).toBeLessThan(midTable);
    expect(bottom).toBeCloseTo(80 * 0.94, 6);
  });

  it('applies the bottom-place penalty across the whole bottom four', () => {
    // 16-team table: places 13-16 are the bottom four, 12 is not.
    expect(ballonDorScore(80, ctx({ leaguePosition: 13 }))).toBeCloseTo(80 * 0.94, 6);
    expect(ballonDorScore(80, ctx({ leaguePosition: 12 }))).toBeCloseTo(80, 6);
  });

  it('scales the bottom places to the table size', () => {
    // An 8-team table: places 5-8 are the bottom four.
    const small = ctx({ leagueSize: 8 });
    expect(ballonDorScore(80, { ...small, leaguePosition: 5 })).toBeCloseTo(80 * 0.94, 6);
    expect(ballonDorScore(80, { ...small, leaguePosition: 4 })).toBeCloseTo(80 * 1.08, 6);
  });

  it('stacks continental and world cup honours', () => {
    const plain = ballonDorScore(80, ctx());
    const continental = ballonDorScore(80, ctx({ wonContinentalCup: true }));
    const world = ballonDorScore(80, ctx({ wonWorldCup: true }));
    const both = ballonDorScore(80, ctx({ wonContinentalCup: true, wonWorldCup: true }));
    expect(continental).toBeGreaterThan(plain);
    expect(world).toBeGreaterThan(continental);
    expect(both).toBeGreaterThan(world);
  });

  it('uses multiplication, so a weak champion does not beat a strong runner-up', () => {
    // 70 x 1.18 = 82.6, still short of an outstanding 90 at 1.08 = 97.2
    const weakChampion = ballonDorScore(70, ctx({ isLeagueChampion: true, leaguePosition: 1 }));
    const strongSecond = ballonDorScore(90, ctx({ leaguePosition: 2 }));
    expect(strongSecond).toBeGreaterThan(weakChampion);
  });
});

describe('ballonDorScore — league tier discount', () => {
  it('discounts lower tiers so the award stays a world honour', () => {
    const top = ballonDorScore(85, ctx({ leagueLevel: 1 }));
    const tier2 = ballonDorScore(85, ctx({ leagueLevel: 2, leaguePosition: 0, leagueSize: 0 }));
    const tier3 = ballonDorScore(85, ctx({ leagueLevel: 3, leaguePosition: 0, leagueSize: 0 }));
    expect(top).toBeGreaterThan(tier2);
    expect(tier2).toBeGreaterThan(tier3);
    expect(tier2).toBeCloseTo(85 * 0.90, 6);
    expect(tier3).toBeCloseTo(85 * 0.80, 6);
  });

  it('does not stack a relegation-zone penalty on a lower-tier team', () => {
    // Position 0 means "not in the top flight": only the tier discount applies.
    const tier2 = ballonDorScore(85, ctx({ leagueLevel: 2, leaguePosition: 0, leagueSize: 0 }));
    expect(tier2).toBeCloseTo(85 * 0.90, 6);
  });

  it('still lets an exceptional lower-tier season win', () => {
    const tier3Star = ballonDorScore(95, ctx({
      leagueLevel: 3, isLeagueChampion: true, leaguePosition: 0, leagueSize: 0,
    }));
    const topFlightAverage = ballonDorScore(72, ctx({ leagueLevel: 1 }));
    expect(tier3Star).toBeGreaterThan(topFlightAverage);
  });
});

describe('ballonDorScore — domestic cups', () => {
  it('credits a domestic cup, which the pre-redesign award ignored entirely', () => {
    const plain = ballonDorScore(80, ctx());
    const leagueCup = ballonDorScore(80, ctx({ domesticCupCount: 1 }));
    expect(leagueCup).toBeGreaterThan(plain);
    expect(leagueCup).toBeCloseTo(80 * 1.05, 6);
  });

  it('caps a domestic double below a continental cup', () => {
    const double = ballonDorScore(80, ctx({ domesticCupCount: 2 }));
    const continental = ballonDorScore(80, ctx({ wonContinentalCup: true }));
    // 1.05 x 1.05 = 1.1025 would outrank a continental cup, so it is capped.
    expect(double).toBeCloseTo(80 * 1.08, 6);
    expect(continental).toBeGreaterThan(double);
  });

  it('leaves a team with no domestic cup untouched', () => {
    expect(ballonDorScore(80, ctx({ domesticCupCount: 0 }))).toBeCloseTo(80, 6);
  });
});

describe('ballonDorScore — sample gate', () => {
  it('applies no penalty at or above the full-sample threshold', () => {
    expect(ballonDorScore(80, ctx({ minutesPlayed: 1800 }))).toBeCloseTo(80, 6);
    expect(ballonDorScore(80, ctx({ minutesPlayed: 3000 }))).toBeCloseTo(80, 6);
  });

  it('applies a mild penalty for a partial season', () => {
    expect(ballonDorScore(80, ctx({ minutesPlayed: 1500 }))).toBeCloseTo(80 * 0.95, 6);
  });

  it('applies a heavier penalty for a thin sample', () => {
    expect(ballonDorScore(80, ctx({ minutesPlayed: 600 }))).toBeCloseTo(80 * 0.85, 6);
  });

  it('keeps a half-season explosion competitive but not dominant', () => {
    const halfSeason = ballonDorScore(92, ctx({ minutesPlayed: 1300 }));
    const fullSeason = ballonDorScore(84, ctx({ minutesPlayed: 2700 }));
    expect(halfSeason).toBeGreaterThan(fullSeason);
    // but a thin sample cannot outrank a clearly better full season
    const thin = ballonDorScore(92, ctx({ minutesPlayed: 500 }));
    const strong = ballonDorScore(88, ctx({ minutesPlayed: 2700 }));
    expect(strong).toBeGreaterThan(thin);
  });
});

describe('buildBallonDorContextResolver', () => {
  function standing(teamId: string, points = 50, over: Partial<StandingEntry> = {}): StandingEntry {
    return {
      teamId, played: 30, won: 15, drawn: 5, lost: 10,
      goalsFor: 40, goalsAgainst: 30, goalDifference: 10,
      points, form: [],
      ...over,
    };
  }

  it('derives league position from points, not array order', () => {
    const standings = [
      standing('third', 40),
      standing('first', 70),
      standing('second', 55),
    ];
    const resolve = buildBallonDorContextResolver(standings, {}, {});
    expect(resolve('first', 2700).leaguePosition).toBe(1);
    expect(resolve('second', 2700).leaguePosition).toBe(2);
    expect(resolve('third', 2700).leaguePosition).toBe(3);
  });

  it('ignores previousPosition, which describes last season', () => {
    const standings = [
      standing('a', 70, { previousPosition: 16 }),
      standing('b', 40, { previousPosition: 1 }),
    ];
    const resolve = buildBallonDorContextResolver(standings, {}, {});
    expect(resolve('a', 2700).leaguePosition).toBe(1);
    expect(resolve('b', 2700).leaguePosition).toBe(2);
    expect(resolve('b', 2700).isLeagueChampion).toBe(false);
  });

  it('marks the champion from the table without an honours argument', () => {
    const standings = [standing('champ', 70), standing('other', 40)];
    const resolve = buildBallonDorContextResolver(standings, {}, {});
    expect(resolve('champ', 2700).isLeagueChampion).toBe(true);
    expect(resolve('other', 2700).isLeagueChampion).toBe(false);
  });

  it('breaks a points tie with the engine tiebreakers', () => {
    // Level on points: goal difference decides.
    const standings = [
      standing('lowerGD', 60, { goalDifference: 5 }),
      standing('higherGD', 60, { goalDifference: 20 }),
    ];
    const resolve = buildBallonDorContextResolver(standings, {}, {});
    expect(resolve('higherGD', 2700).leaguePosition).toBe(1);
    expect(resolve('lowerGD', 2700).leaguePosition).toBe(2);
  });

  it('reports the league size alongside the position', () => {
    const standings = [standing('a', 70), standing('b', 40)];
    const resolve = buildBallonDorContextResolver(standings, {}, {});
    expect(resolve('a', 2700).leagueSize).toBe(2);
  });

  it('matches any of the three continental cup winners', () => {
    const standings = [standing('a', 70), standing('b', 40), standing('c', 30)];
    const resolve = buildBallonDorContextResolver(
      standings,
      { continentalCupWinners: ['b', 'c'] },
      {},
    );
    expect(resolve('a', 2700).wonContinentalCup).toBe(false);
    expect(resolve('b', 2700).wonContinentalCup).toBe(true);
    expect(resolve('c', 2700).wonContinentalCup).toBe(true);
  });

  it('treats an omitted honours lookup as no cups won', () => {
    const resolve = buildBallonDorContextResolver([standing('a', 70)], {}, {});
    expect(resolve('a', 2700).wonContinentalCup).toBe(false);
    expect(resolve('a', 2700).domesticCupCount).toBe(0);
  });

  it('counts domestic cup trophies, including a double', () => {
    const standings = [standing('a', 70), standing('b', 40)];
    const single = buildBallonDorContextResolver(
      standings, { domesticCupWinners: ['a'] }, {},
    );
    expect(single('a', 2700).domesticCupCount).toBe(1);
    expect(single('b', 2700).domesticCupCount).toBe(0);

    const double = buildBallonDorContextResolver(
      standings, { domesticCupWinners: ['a', 'a'] }, {},
    );
    expect(double('a', 2700).domesticCupCount).toBe(2);
  });

  it('falls back to level 1 when the season start level is unknown', () => {
    const resolve = buildBallonDorContextResolver([standing('a', 70)], {}, {});
    expect(resolve('a', 2700).leagueLevel).toBe(1);
  });

  it('reads the season start level rather than the current one', () => {
    const resolve = buildBallonDorContextResolver([standing('a', 70)], {}, { a: 2 });
    expect(resolve('a', 2700).leagueLevel).toBe(2);
  });

  it('gives a team outside the top flight no table position', () => {
    const standings = [standing('a', 70), standing('b', 40)];
    const resolve = buildBallonDorContextResolver(standings, {}, { missing: 2 });
    const context = resolve('missing', 2700);
    expect(context.leaguePosition).toBe(0);
    expect(context.leagueSize).toBe(0);
    expect(context.isLeagueChampion).toBe(false);
    expect(context.leagueLevel).toBe(2);
  });

  it('reports no world cup winner while the tournament is unfinished', () => {
    const worldCup = {
      groups: [], knockoutRounds: [], groupStageCompleted: true,
      completed: false, winnerId: 'provisional', participantIds: ['a'],
    } as unknown as WorldCupState;
    const resolve = buildBallonDorContextResolver([standing('a', 70)], {}, {}, worldCup);
    expect(resolve('a', 2700).wonWorldCup).toBe(false);
  });

  it('reports the world cup winner once the tournament is complete', () => {
    const worldCup = {
      groups: [], knockoutRounds: [], groupStageCompleted: true,
      completed: true, winnerId: 'a', participantIds: ['a', 'b'],
    } as unknown as WorldCupState;
    const resolve = buildBallonDorContextResolver(
      [standing('a', 70), standing('b', 40)], {}, {}, worldCup,
    );
    expect(resolve('a', 2700).wonWorldCup).toBe(true);
    expect(resolve('b', 2700).wonWorldCup).toBe(false);
  });

  it('handles a null world cup (pre-timing-redesign saves)', () => {
    const resolve = buildBallonDorContextResolver([standing('a', 70)], {}, {}, null);
    expect(resolve('a', 2700).wonWorldCup).toBe(false);
  });
});

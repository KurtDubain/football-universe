import { describe, expect, it } from 'vitest';
import type { MatchFixture } from '../../types/match';
import type { TeamBase, TeamState } from '../../types/team';
import { calculateMarketOdds, predictMatch } from './prediction';
import { SeededRNG } from './rng';
import { simulateMatch } from './simulator';
import type { Player, PlayerPosition } from '../../types/player';

function team(id: string, overall: number): TeamBase {
  return {
    id, name: id, shortName: id, color: '#000', tier: 'mid', overall,
    attack: overall, midfield: overall, defense: overall, stability: overall,
    depth: overall, reputation: overall, initialLeagueLevel: 1, expectation: 3,
    region: '测试',
  };
}

function state(id: string): TeamState {
  return {
    id, leagueLevel: 1, morale: 60, fatigue: 10, momentum: 0,
    squadHealth: 90, coachPressure: 10, recentForm: [],
  };
}

function fixture(neutral = false): MatchFixture {
  return {
    id: 'forecast', homeTeamId: 'home', awayTeamId: 'away', competitionType: 'league',
    competitionName: '测试联赛', roundLabel: 'R1', isNeutralVenue: neutral,
  };
}

function squad(teamId: string, starInjuredUntil = 0): Player[] {
  const positions: PlayerPosition[] = [
    'GK', 'GK', 'DF', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW', 'FW', 'FW',
  ];
  return positions.map((position, index) => ({
    uuid: `${teamId}-${index}`,
    teamId,
    name: `${teamId}-${index}`,
    number: index + 1,
    position,
    rating: index === 11 ? 96 : 78 - index * 0.2,
    peakRating: index === 11 ? 96 : 80,
    peakAge: 27,
    goalScoring: position === 'FW' ? 75 : 20,
    marketValue: 20,
    age: 26,
    ...(index === 11 && starInjuredUntil > 0 ? { injuredUntilWindow: starInjuredUntil } : {}),
  }));
}

describe('shared match forecast', () => {
  it('normalizes probabilities and favors a clearly stronger away team', () => {
    const prediction = predictMatch(team('home', 70), team('away', 92), state('home'), state('away'), null, null, {
      fixture: fixture(),
    });

    expect(prediction.homeWinPct + prediction.drawPct + prediction.awayWinPct).toBe(100);
    expect(prediction.awayWinPct).toBeGreaterThan(prediction.homeWinPct);
    expect(prediction.verdict).toContain('away');
  });

  it('removes home advantage at a neutral venue', () => {
    const home = team('home', 80);
    const away = team('away', 80);
    const homeState = state('home');
    const awayState = state('away');
    const normal = predictMatch(home, away, homeState, awayState, null, null, { fixture: fixture() });
    const neutral = predictMatch(home, away, homeState, awayState, null, null, { fixture: fixture(true) });

    expect(normal.homeWinPct).toBeGreaterThan(neutral.homeWinPct);
    expect(Math.abs(neutral.homeWinPct - neutral.awayWinPct)).toBeLessThanOrEqual(1);
  });

  it('prices the predicted favorite at lower odds and persists the same forecast in simulation', () => {
    const home = team('home', 86);
    const away = team('away', 72);
    const homeState = state('home');
    const awayState = state('away');
    const matchFixture = fixture();
    const prediction = predictMatch(home, away, homeState, awayState, null, null, { fixture: matchFixture });
    const odds = calculateMarketOdds(prediction);
    const simulated = simulateMatch({
      homeTeam: home, awayTeam: away, homeState, awayState, homeCoach: null, awayCoach: null,
      competitionType: 'league', isKnockout: false, rng: new SeededRNG(42),
    }, matchFixture).matchResult;

    expect(odds.home).toBeLessThan(odds.away);
    expect(simulated.prediction?.homeWinPct).toBe(prediction.homeWinPct);
    expect(simulated.prediction?.drawPct).toBe(prediction.drawPct);
    expect(simulated.prediction?.awayWinPct).toBe(prediction.awayWinPct);
  });

  it('keeps injury-adjusted squad boosts identical in prediction and simulation', () => {
    const home = team('home', 82);
    const away = team('away', 82);
    const homeState = state('home');
    const awayState = state('away');
    const matchFixture = fixture();
    const injuredHome = squad('home', 20);
    const awaySquad = squad('away');
    const prediction = predictMatch(home, away, homeState, awayState, null, null, {
      fixture: matchFixture,
      homeSquad: injuredHome,
      awaySquad,
      globalWindowIdx: 10,
    });
    const healthyPrediction = predictMatch(home, away, homeState, awayState, null, null, {
      fixture: matchFixture,
      homeSquad: squad('home'),
      awaySquad,
      globalWindowIdx: 10,
    });
    const simulated = simulateMatch({
      homeTeam: home,
      awayTeam: away,
      homeState,
      awayState,
      homeCoach: null,
      awayCoach: null,
      homeSquad: injuredHome,
      awaySquad,
      globalWindowIdx: 10,
      competitionType: 'league',
      isKnockout: false,
      rng: new SeededRNG(91),
    }, matchFixture).matchResult;

    expect(prediction.homeWinPct).toBeLessThan(healthyPrediction.homeWinPct);
    expect(simulated.prediction).toMatchObject({
      homeWinPct: prediction.homeWinPct,
      drawPct: prediction.drawPct,
      awayWinPct: prediction.awayWinPct,
    });
  });
});

import { describe, expect, it } from 'vitest';
import type { MatchResult } from '../../types/match';
import { resolveBetOutcome, settleBets, type PendingBet } from './bet-settlement';

function result(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    fixtureId: 'fixture-1',
    homeTeamId: 'home',
    awayTeamId: 'away',
    homeGoals: 1,
    awayGoals: 0,
    extraTime: false,
    penalties: false,
    events: [],
    stats: {
      possession: [50, 50],
      shots: [5, 5],
      shotsOnTarget: [2, 2],
      corners: [2, 2],
      fouls: [8, 8],
      yellowCards: [0, 0],
      redCards: [0, 0],
    },
    competitionType: 'league',
    competitionName: '联赛',
    roundLabel: '第1轮',
    ...overrides,
  };
}

function bet(overrides: Partial<PendingBet> = {}): PendingBet {
  return { fixtureId: 'fixture-1', outcome: 'home', amount: 50, odds: 2, ...overrides };
}

describe('bet settlement', () => {
  it('settles matching fixtures once and keeps unrelated bets pending', () => {
    const unrelated = bet({ fixtureId: 'fixture-2', outcome: 'away' });
    const settled = settleBets(900, [bet(), unrelated], [result()]);

    expect(settled.coins).toBe(1000);
    expect(settled.pendingBets).toEqual([unrelated]);
    expect(settled.settlements).toEqual([expect.objectContaining({
      fixtureId: 'fixture-1',
      actualOutcome: 'home',
      won: true,
      payout: 100,
    })]);

    const repeated = settleBets(settled.coins, settled.pendingBets, [result()]);
    expect(repeated.coins).toBe(1000);
    expect(repeated.settlements).toEqual([]);
  });

  it('does not discard or pay bets on windows without their fixture', () => {
    const pending = bet();
    expect(settleBets(950, [pending], [])).toEqual({
      coins: 950,
      pendingBets: [pending],
      settlements: [],
    });
    expect(settleBets(950, [pending], [result({ fixtureId: 'other' })])).toEqual({
      coins: 950,
      pendingBets: [pending],
      settlements: [],
    });
  });

  it('uses regulation plus extra-time goals', () => {
    const extraTimeResult = result({
      homeGoals: 1,
      awayGoals: 1,
      extraTime: true,
      etHomeGoals: 0,
      etAwayGoals: 1,
    });
    expect(resolveBetOutcome(extraTimeResult)).toBe('away');
  });

  it('uses the shootout winner when extra time remains level', () => {
    const shootoutResult = result({
      homeGoals: 0,
      awayGoals: 0,
      extraTime: true,
      etHomeGoals: 0,
      etAwayGoals: 0,
      penalties: true,
      penaltyHome: 5,
      penaltyAway: 4,
    });
    expect(resolveBetOutcome(shootoutResult)).toBe('home');
  });

  it('pays nothing for an incorrect prediction', () => {
    const settled = settleBets(950, [bet({ outcome: 'away' })], [result()]);
    expect(settled.coins).toBe(950);
    expect(settled.pendingBets).toEqual([]);
    expect(settled.settlements[0]).toMatchObject({ won: false, payout: 0 });
  });

  it('settles a duplicated fixture only once even if a malformed save contains duplicates', () => {
    const settled = settleBets(900, [bet(), bet()], [result()]);
    expect(settled.coins).toBe(1000);
    expect(settled.pendingBets).toEqual([]);
    expect(settled.settlements).toHaveLength(1);
  });
});

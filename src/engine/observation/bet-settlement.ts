import type { MatchResult } from '../../types/match';

export type BetOutcome = 'home' | 'draw' | 'away';

export interface PendingBet {
  fixtureId: string;
  outcome: BetOutcome;
  amount: number;
  odds: number;
}

export interface BetSettlement {
  fixtureId: string;
  predictedOutcome: BetOutcome;
  actualOutcome: BetOutcome;
  amount: number;
  payout: number;
  won: boolean;
}

export interface BetSettlementResult {
  coins: number;
  pendingBets: PendingBet[];
  settlements: BetSettlement[];
}

/** Resolve the final sporting winner, including extra time and shootouts. */
export function resolveBetOutcome(result: MatchResult): BetOutcome {
  const homeGoals = result.homeGoals + (result.etHomeGoals ?? 0);
  const awayGoals = result.awayGoals + (result.etAwayGoals ?? 0);
  if (homeGoals > awayGoals) return 'home';
  if (awayGoals > homeGoals) return 'away';
  if (result.penalties && result.penaltyHome != null && result.penaltyAway != null) {
    return result.penaltyHome > result.penaltyAway ? 'home' : 'away';
  }
  return 'draw';
}

/**
 * Settle only bets whose fixtures appear in this result batch.
 *
 * Unmatched bets stay pending, so a non-match window or a multi-window jump
 * can never silently discard a user's prediction.
 */
export function settleBets(
  coins: number,
  bets: PendingBet[],
  results: MatchResult[],
): BetSettlementResult {
  if (bets.length === 0 || results.length === 0) {
    return { coins, pendingBets: bets, settlements: [] };
  }

  const resultByFixture = new Map(results.map(result => [result.fixtureId, result]));
  const pendingBets: PendingBet[] = [];
  const settlements: BetSettlement[] = [];
  const settledFixtureIds = new Set<string>();
  let nextCoins = coins;

  for (const bet of bets) {
    const result = resultByFixture.get(bet.fixtureId);
    if (!result) {
      pendingBets.push(bet);
      continue;
    }
    if (settledFixtureIds.has(bet.fixtureId)) continue;
    settledFixtureIds.add(bet.fixtureId);

    const actualOutcome = resolveBetOutcome(result);
    const won = actualOutcome === bet.outcome;
    const payout = won ? Math.round(bet.amount * bet.odds) : 0;
    nextCoins += payout;
    settlements.push({
      fixtureId: bet.fixtureId,
      predictedOutcome: bet.outcome,
      actualOutcome,
      amount: bet.amount,
      payout,
      won,
    });
  }

  return { coins: nextCoins, pendingBets, settlements };
}

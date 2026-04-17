import { CupState, CupRound, CupFixture } from '../../types/cup';
import { MatchResult } from '../../types/match';
import { SeededRNG } from '../match/rng';
import { drawSimpleKnockout } from './draw';

/** Round names in order. 32 -> 16 -> 8 -> 4 -> 2 teams. */
const ROUND_NAMES = ['R32', 'R16', 'QF', 'SF', 'Final'] as const;

/**
 * Determine the winner of a single-leg knockout match.
 * Checks total score (regulation + extra time), then penalties.
 */
function determineSingleMatchWinner(result: MatchResult): string {
  const totalHome = result.homeGoals + (result.etHomeGoals ?? 0);
  const totalAway = result.awayGoals + (result.etAwayGoals ?? 0);

  if (totalHome !== totalAway) {
    return totalHome > totalAway ? result.homeTeamId : result.awayTeamId;
  }

  // Score is level after extra time -> penalties decide
  if (result.penalties && result.penaltyHome != null && result.penaltyAway != null) {
    return result.penaltyHome > result.penaltyAway
      ? result.homeTeamId
      : result.awayTeamId;
  }

  // Fallback (should not happen if match engine always resolves knockouts)
  return result.homeTeamId;
}

/**
 * Extract the season number from the first fixture ID in the cup state.
 * Fixture IDs follow the pattern LC-S{season}-...
 */
function extractSeason(cup: CupState): number {
  const firstFixture = cup.rounds[0]?.fixtures[0];
  if (!firstFixture) return 1;
  const match = firstFixture.id.match(/LC-S(\d+)/);
  return match ? parseInt(match[1], 10) : 1;
}

/**
 * Initialize the league cup with all 32 teams.
 * Draws the R32 bracket. All matches are single-leg.
 * Round names: 'R32', 'R16', 'QF', 'SF', 'Final'
 */
export function initLeagueCup(
  teamIds: string[],
  seasonNumber: number,
  rng: SeededRNG,
): CupState {
  if (teamIds.length !== 32) {
    throw new Error(`League cup requires exactly 32 teams, got ${teamIds.length}`);
  }

  const pairs = drawSimpleKnockout(teamIds, rng);

  const fixtures: CupFixture[] = pairs.map((pair, i) => ({
    id: `LC-S${seasonNumber}-${ROUND_NAMES[0]}-M${i + 1}`,
    round: 1,
    roundName: ROUND_NAMES[0],
    homeTeamId: pair[0],
    awayTeamId: pair[1],
  }));

  const firstRound: CupRound = {
    roundNumber: 1,
    roundName: ROUND_NAMES[0],
    fixtures,
    completed: false,
  };

  return {
    name: '联赛杯',
    type: 'league_cup',
    rounds: [firstRound],
    currentRound: 1,
    completed: false,
  };
}

/**
 * Get fixtures for the current round.
 */
export function getLeagueCupCurrentFixtures(cup: CupState): CupFixture[] {
  const round = cup.rounds.find((r) => r.roundNumber === cup.currentRound);
  return round ? round.fixtures : [];
}

/**
 * Advance the league cup after a round's results.
 * Determines winners and creates next round's fixtures.
 *
 * Winner of match 1 vs winner of match 2, winner of match 3 vs winner of match 4, etc.
 */
export function advanceLeagueCup(
  cup: CupState,
  results: MatchResult[],
): CupState {
  const currentRound = cup.rounds.find((r) => r.roundNumber === cup.currentRound);
  if (!currentRound) {
    throw new Error(`Current round ${cup.currentRound} not found`);
  }

  // Map results by fixtureId for quick lookup
  const resultMap = new Map(results.map((r) => [r.fixtureId, r]));

  // Determine winners for each fixture in the current round
  const winners: string[] = [];
  for (const fixture of currentRound.fixtures) {
    const result = resultMap.get(fixture.id);
    if (!result) {
      throw new Error(`Missing result for fixture ${fixture.id}`);
    }

    // Record result on fixture
    fixture.result = {
      home: result.homeGoals + (result.etHomeGoals ?? 0),
      away: result.awayGoals + (result.etAwayGoals ?? 0),
      extraTime: result.extraTime || undefined,
      penalties: result.penalties || undefined,
      penHome: result.penaltyHome,
      penAway: result.penaltyAway,
    };

    const winnerId = determineSingleMatchWinner(result);
    fixture.winnerId = winnerId;
    winners.push(winnerId);
  }

  currentRound.completed = true;

  // Check if this was the final round
  const roundIndex = cup.currentRound; // 1-based
  if (roundIndex >= ROUND_NAMES.length) {
    // This was the Final
    return {
      ...cup,
      completed: true,
      winnerId: winners[0],
    };
  }

  // Create next round's fixtures
  const season = extractSeason(cup);
  const nextRoundNumber = roundIndex + 1;
  const nextRoundName = ROUND_NAMES[nextRoundNumber - 1];

  const nextFixtures: CupFixture[] = [];
  for (let i = 0; i < winners.length; i += 2) {
    nextFixtures.push({
      id: `LC-S${season}-${nextRoundName}-M${Math.floor(i / 2) + 1}`,
      round: nextRoundNumber,
      roundName: nextRoundName,
      homeTeamId: winners[i],
      awayTeamId: winners[i + 1],
    });
  }

  const nextRound: CupRound = {
    roundNumber: nextRoundNumber,
    roundName: nextRoundName,
    fixtures: nextFixtures,
    completed: false,
  };

  return {
    ...cup,
    rounds: [...cup.rounds, nextRound],
    currentRound: nextRoundNumber,
  };
}

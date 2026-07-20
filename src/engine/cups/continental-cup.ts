import { ContinentalCupState, CupRound, CupFixture, CupRegion } from '../../types/cup';
import { MatchResult } from '../../types/match';
import { SeededRNG } from '../match/rng';
import { drawSimpleKnockout } from './draw';

/**
 * Continental cups — three intra-continent knockouts that run every four
 * seasons (S2, S6, S10, ...). Single-leg knockout with a compact,
 * qualification-only field (8 Mainland clubs, 4 Southern/Eastern clubs).
 *
 * Naming convention for fixture IDs:
 *   CC-{type}-S{season}-{round}-M{n}
 *   where {type} is one of mainland_cup / southern_cup / eastern_cup
 *
 * The cup state's `type` is specifically the continental type (not a generic
 * 'continental_cup') so trophy attribution and downstream UI can distinguish
 * the three without re-reading `region`.
 */

const ROUND_NAMES_8  = ['QF', 'SF', 'Final'] as const;
const ROUND_NAMES_4  = ['SF', 'Final'] as const;

type RegionToType = {
  '大陆': 'mainland_cup';
  '南洲': 'southern_cup';
  '东洲': 'eastern_cup';
};

const REGION_TO_TYPE: RegionToType = {
  '大陆': 'mainland_cup',
  '南洲': 'southern_cup',
  '东洲': 'eastern_cup',
};

const REGION_TO_NAME: Record<CupRegion, string> = {
  '大陆': '大陆杯',
  '南洲': '南洲杯',
  '东洲': '东洲杯',
};

/**
 * Single-leg winner: total score after extra time, then penalties. Same shape
 * as `league-cup.ts:determineSingleMatchWinner`.
 */
function determineSingleMatchWinner(result: MatchResult): string {
  const totalHome = result.homeGoals + (result.etHomeGoals ?? 0);
  const totalAway = result.awayGoals + (result.etAwayGoals ?? 0);
  if (totalHome !== totalAway) {
    return totalHome > totalAway ? result.homeTeamId : result.awayTeamId;
  }
  if (result.penalties && result.penaltyHome != null && result.penaltyAway != null) {
    return result.penaltyHome > result.penaltyAway ? result.homeTeamId : result.awayTeamId;
  }
  return result.homeTeamId;
}

function fixtureIdPrefix(type: ContinentalCupState['type'], season: number): string {
  return `CC-${type}-S${season}`;
}

/**
 * Initialize a continental cup. Validates team count by region (8 for 大陆,
 * 4 for 南洲 / 东洲), draws the first round via `drawSimpleKnockout`.
 *
 * Throws if the team count doesn't match the region's required size — caller
 * should never call this with an empty team list (off-year detection lives
 * upstream in season-manager).
 */
export function initContinentalCup(
  region: CupRegion,
  teamIds: string[],
  seasonNumber: number,
  rng: SeededRNG,
): ContinentalCupState {
  const expectedSize = region === '大陆' ? 8 : 4;
  if (teamIds.length !== expectedSize) {
    throw new Error(
      `${REGION_TO_NAME[region]} requires exactly ${expectedSize} teams, got ${teamIds.length}`,
    );
  }
  const type = REGION_TO_TYPE[region];
  const roundNames = region === '大陆' ? ROUND_NAMES_8 : ROUND_NAMES_4;

  const pairs = drawSimpleKnockout(teamIds, rng);
  const prefix = fixtureIdPrefix(type, seasonNumber);

  const fixtures: CupFixture[] = pairs.map((pair, i) => ({
    id: `${prefix}-${roundNames[0]}-M${i + 1}`,
    round: 1,
    roundName: roundNames[0],
    homeTeamId: pair[0],
    awayTeamId: pair[1],
  }));

  const firstRound: CupRound = {
    roundNumber: 1,
    roundName: roundNames[0],
    fixtures,
    completed: false,
  };

  return {
    name: REGION_TO_NAME[region],
    type,
    region,
    rounds: [firstRound],
    currentRound: 1,
    completed: false,
  };
}

/** Fixtures for the cup's current (active) round. */
export function getContinentalCupCurrentFixtures(cup: ContinentalCupState): CupFixture[] {
  const round = cup.rounds.find((r) => r.roundNumber === cup.currentRound);
  return round ? round.fixtures : [];
}

/**
 * Advance the cup after a round's results: write results onto fixtures,
 * determine winners, and either spawn the next round or mark the cup done.
 */
export function advanceContinentalCup(
  cup: ContinentalCupState,
  results: MatchResult[],
): ContinentalCupState {
  const currentRound = cup.rounds.find((r) => r.roundNumber === cup.currentRound);
  if (!currentRound) {
    throw new Error(`Current round ${cup.currentRound} not found in ${cup.name}`);
  }
  const resultMap = new Map(results.map((r) => [r.fixtureId, r]));

  const winners: string[] = [];
  for (const fixture of currentRound.fixtures) {
    const result = resultMap.get(fixture.id);
    if (!result) {
      throw new Error(`Missing result for fixture ${fixture.id} (${cup.name})`);
    }
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

  const roundNames = cup.region === '大陆' ? ROUND_NAMES_8 : ROUND_NAMES_4;
  if (cup.currentRound >= roundNames.length) {
    // Final just played — winner is the lone surviving entry.
    return {
      ...cup,
      completed: true,
      winnerId: winners[0],
    };
  }

  const nextRoundNumber = cup.currentRound + 1;
  const nextRoundName = roundNames[nextRoundNumber - 1];
  const prefix = fixtureIdPrefix(cup.type, extractSeason(cup));
  const nextFixtures: CupFixture[] = [];
  for (let i = 0; i < winners.length; i += 2) {
    nextFixtures.push({
      id: `${prefix}-${nextRoundName}-M${Math.floor(i / 2) + 1}`,
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

/**
 * Extract season number from a fixture id of the form "CC-{type}-S{N}-...".
 * Returns 1 if no fixture is present (unreachable in practice — the cup is
 * always initialised with at least one fixture).
 */
function extractSeason(cup: ContinentalCupState): number {
  const firstFixture = cup.rounds[0]?.fixtures[0];
  if (!firstFixture) return 1;
  const match = firstFixture.id.match(/-S(\d+)-/);
  return match ? parseInt(match[1], 10) : 1;
}

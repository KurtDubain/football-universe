import type { WorldCupState } from '../../types/cup';
import type { StandingEntry } from '../../types/league';
import { sortStandings } from '../standings/standings';
import {
  BALLON_DOR_TEAM,
  TIER_COEFFICIENT,
  type LeagueTier,
} from './award-weights';
import {
  ballonDorTeamFactor,
  domesticCupMultiplier,
  placementOf,
  sampleGateMultiplier,
  type TeamPlacement,
} from './award-scoring';

/**
 * Ballon d'Or scoring, kept separate from the player-page season score.
 *
 * `seasonScore` has to stay stable, cross-season comparable and free of team
 * context — the player page, career board, transfer value and the narrative
 * scanner all read it. The Ballon d'Or asks a different question: who shone
 * brightest *this season*. That needs team achievement, which `seasonScore`
 * deliberately excludes, so the two must not share a formula.
 *
 * Multipliers rather than additions: an additive bonus would lift a mediocre
 * player on a champion side above a genuinely outstanding one. Multiplying
 * means only players who are already strong benefit from team success.
 *
 * Callers pass a **tier-neutral** score (see `tierNeutralScore`), because this
 * function applies the tier coefficient itself. Passing a raw `seasonScore`
 * would discount lower tiers twice.
 */

/** Team achievement and sample context for one award candidate. */
export interface BallonDorContext extends TeamPlacement {
  /** True when the team finished first in the top flight. */
  isLeagueChampion: boolean;
  wonContinentalCup: boolean;
  wonWorldCup: boolean;
  /** League cup + super cup trophies won this season. */
  domesticCupCount: number;
  minutesPlayed: number;
}

/**
 * Weight one candidate for the Ballon d'Or.
 *
 * @param tierNeutralSeasonScore The player's season score with the league
 *   strength term removed, so the tier coefficient below is the only tier
 *   weighting applied.
 * @param context Team achievement and sample size for that player.
 */
export function ballonDorScore(
  tierNeutralSeasonScore: number,
  context: BallonDorContext,
): number {
  let multiplier = ballonDorTeamFactor(context);

  if (context.wonContinentalCup) multiplier *= BALLON_DOR_TEAM.continentalCup;
  if (context.wonWorldCup) multiplier *= BALLON_DOR_TEAM.worldCup;
  multiplier *= domesticCupMultiplier(context.domesticCupCount);

  multiplier *= TIER_COEFFICIENT[context.leagueLevel];

  return tierNeutralSeasonScore * multiplier * sampleGateMultiplier(context.minutesPlayed);
}

/**
 * Honours that cannot be derived from the league table.
 *
 * The champion is deliberately absent: it is read from the standings with the
 * engine's own tiebreakers, so the award can never disagree with the table.
 */
export interface TeamHonourLookup {
  /** Winners of the continental cups that ran and completed this season. */
  continentalCupWinners?: readonly string[];
  /**
   * Winners of the domestic cups (league cup, super cup). Before the redesign
   * these were omitted entirely, so a domestic double contributed nothing to
   * any individual award.
   */
  domesticCupWinners?: readonly string[];
}

/**
 * Build a per-team Ballon d'Or context resolver for one season.
 *
 * The World Cup is read from live state. Before the timing redesign it does
 * not exist yet at award time, in which case `wonWorldCup` is simply false —
 * the multiplier activates once the World Cup runs inside the season.
 */
export function buildBallonDorContextResolver(
  standings: StandingEntry[],
  honours: TeamHonourLookup,
  seasonStartLevels: Record<string, LeagueTier | undefined>,
  worldCup?: WorldCupState | null,
): (teamId: string, minutesPlayed: number) => BallonDorContext {
  // Rank once with the canonical tiebreakers. Array order is not a guaranteed
  // ranking, and `previousPosition` is last season's table — never this one.
  const positionByTeam = new Map(
    sortStandings(standings).map((row, index) => [row.teamId, index + 1] as const),
  );
  const leagueSize = standings.length;
  const continentalWinners = new Set(honours.continentalCupWinners ?? []);
  const domesticWinners = honours.domesticCupWinners ?? [];
  const worldCupWinner = worldCup?.completed ? worldCup.winnerId : undefined;

  return (teamId: string, minutesPlayed: number): BallonDorContext => {
    const leaguePosition = positionByTeam.get(teamId) ?? 0;
    return {
      ...placementOf(
        leaguePosition,
        leaguePosition === 0 ? 0 : leagueSize,
        seasonStartLevels[teamId] ?? 1,
      ),
      isLeagueChampion: leaguePosition === 1,
      wonContinentalCup: continentalWinners.has(teamId),
      wonWorldCup: worldCupWinner === teamId,
      domesticCupCount: domesticWinners.filter(id => id === teamId).length,
      minutesPlayed,
    };
  };
}

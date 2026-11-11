import type { WorldCupState } from '../../types/cup';
import type { StandingEntry } from '../../types/league';
import { sortStandings } from '../standings/standings';

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
 */

/** Team achievement and sample context for one award candidate. */
export interface BallonDorContext {
  /** True when the team finished first in the top flight. */
  isLeagueChampion: boolean;
  /**
   * Final top-flight position, 1-indexed, or 0 when the team did not play in
   * the top flight this season.
   *
   * Lower-tier teams are described by `leagueLevel`, never by a fabricated
   * position: an invented bottom-of-the-table rank would stack the
   * relegation-zone penalty on top of the tier discount.
   */
  leaguePosition: number;
  /** Teams in the top flight; 0 when the team is not in it. */
  leagueSize: number;
  wonContinentalCup: boolean;
  wonWorldCup: boolean;
  leagueLevel: 1 | 2 | 3;
  minutesPlayed: number;
}

// Team achievement multipliers.
const CHAMPION_MULTIPLIER = 1.18;
const TOP_FOUR_MULTIPLIER = 1.08;
const BOTTOM_FOUR_MULTIPLIER = 0.94;
const CONTINENTAL_CUP_MULTIPLIER = 1.10;
/** Four-year interval makes this the rarest honour in the game. */
const WORLD_CUP_MULTIPLIER = 1.15;

/** Cut-off for the top-four bonus, in league places. */
const TOP_FOUR_CUTOFF = 4;
/**
 * Size of the relegation zone the bottom-four penalty applies to. Derived
 * from the table size rather than hard-coded, so it survives a change to the
 * top-flight team count in `config/competitions.ts`.
 */
const BOTTOM_PLACES = 4;

// The Ballon d'Or is a world award, so lower tiers are discounted. This also
// aligns the award with best defender / goalkeeper, which are already
// restricted to the top flight.
const TIER_2_MULTIPLIER = 0.90;
const TIER_3_MULTIPLIER = 0.78;

// Sample gates. The previous hard cut at five appearances was far too loose.
const FULL_SAMPLE_MINUTES = 1800;
const PARTIAL_SAMPLE_MINUTES = 1200;
const PARTIAL_SAMPLE_MULTIPLIER = 0.95;
const THIN_SAMPLE_MULTIPLIER = 0.85;

/**
 * Weight one candidate for the Ballon d'Or.
 *
 * @param seasonScore The player's attendance-aware cross-position season score.
 * @param context     Team achievement and sample size for that player.
 */
export function ballonDorScore(seasonScore: number, context: BallonDorContext): number {
  let multiplier = 1.0;

  if (context.isLeagueChampion) {
    multiplier *= CHAMPION_MULTIPLIER;
  } else if (context.leaguePosition > 0) {
    // Only top-flight teams have a table position to judge.
    if (context.leaguePosition <= TOP_FOUR_CUTOFF) {
      multiplier *= TOP_FOUR_MULTIPLIER;
    } else if (context.leaguePosition > context.leagueSize - BOTTOM_PLACES) {
      multiplier *= BOTTOM_FOUR_MULTIPLIER;
    }
  }

  if (context.wonContinentalCup) multiplier *= CONTINENTAL_CUP_MULTIPLIER;
  if (context.wonWorldCup) multiplier *= WORLD_CUP_MULTIPLIER;

  if (context.leagueLevel === 2) multiplier *= TIER_2_MULTIPLIER;
  if (context.leagueLevel === 3) multiplier *= TIER_3_MULTIPLIER;

  const sampleGate = context.minutesPlayed >= FULL_SAMPLE_MINUTES ? 1.0
    : context.minutesPlayed >= PARTIAL_SAMPLE_MINUTES ? PARTIAL_SAMPLE_MULTIPLIER
    : THIN_SAMPLE_MULTIPLIER;

  return seasonScore * multiplier * sampleGate;
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
  seasonStartLevels: Record<string, 1 | 2 | 3 | undefined>,
  worldCup?: WorldCupState | null,
): (teamId: string, minutesPlayed: number) => BallonDorContext {
  // Rank once with the canonical tiebreakers. Array order is not a guaranteed
  // ranking, and `previousPosition` is last season's table — never this one.
  const positionByTeam = new Map(
    sortStandings(standings).map((row, index) => [row.teamId, index + 1] as const),
  );
  const leagueSize = standings.length;
  const continentalWinners = new Set(honours.continentalCupWinners ?? []);
  const worldCupWinner = worldCup?.completed ? worldCup.winnerId : undefined;

  return (teamId: string, minutesPlayed: number): BallonDorContext => {
    const leaguePosition = positionByTeam.get(teamId) ?? 0;
    return {
      isLeagueChampion: leaguePosition === 1,
      leaguePosition,
      leagueSize: leaguePosition === 0 ? 0 : leagueSize,
      wonContinentalCup: continentalWinners.has(teamId),
      wonWorldCup: worldCupWinner === teamId,
      leagueLevel: seasonStartLevels[teamId] ?? 1,
      minutesPlayed,
    };
  };
}

import { StandingEntry } from '../../types/league';
import { MatchResult } from '../../types/match';

/** Maximum number of recent results kept in the form array. */
const MAX_FORM_LENGTH = 5;

/**
 * Create initial empty standings for a list of team IDs.
 * All stats start at zero, form is empty.
 */
export function createInitialStandings(teamIds: string[]): StandingEntry[] {
  return teamIds.map((teamId) => ({
    teamId,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    form: [],
  }));
}

/**
 * Update standings after a round of matches.
 * Returns a new standings array sorted by: points desc, goal difference desc, goals for desc.
 * Does not mutate the input array.
 */
export function updateStandings(
  currentStandings: StandingEntry[],
  results: MatchResult[],
): StandingEntry[] {
  // Record previous positions before re-sorting
  const prevPositions = new Map<string, number>();
  currentStandings.forEach((e, i) => prevPositions.set(e.teamId, i + 1));

  // Deep clone so we don't mutate the original
  const standings = currentStandings.map((entry) => ({
    ...entry,
    form: [...entry.form],
    previousPosition: prevPositions.get(entry.teamId),
  }));

  for (const result of results) {
    const homeEntry = standings.find((e) => e.teamId === result.homeTeamId);
    const awayEntry = standings.find((e) => e.teamId === result.awayTeamId);
    if (!homeEntry || !awayEntry) continue;

    const { homeGoals, awayGoals } = result;

    // Matches played
    homeEntry.played++;
    awayEntry.played++;

    // Goals
    homeEntry.goalsFor += homeGoals;
    homeEntry.goalsAgainst += awayGoals;
    awayEntry.goalsFor += awayGoals;
    awayEntry.goalsAgainst += homeGoals;

    // Goal difference
    homeEntry.goalDifference = homeEntry.goalsFor - homeEntry.goalsAgainst;
    awayEntry.goalDifference = awayEntry.goalsFor - awayEntry.goalsAgainst;

    // Win / Draw / Loss + points + form
    if (homeGoals > awayGoals) {
      homeEntry.won++;
      homeEntry.points += 3;
      homeEntry.form.push('W');
      awayEntry.lost++;
      awayEntry.form.push('L');
    } else if (homeGoals < awayGoals) {
      homeEntry.lost++;
      homeEntry.form.push('L');
      awayEntry.won++;
      awayEntry.points += 3;
      awayEntry.form.push('W');
    } else {
      homeEntry.drawn++;
      homeEntry.points += 1;
      homeEntry.form.push('D');
      awayEntry.drawn++;
      awayEntry.points += 1;
      awayEntry.form.push('D');
    }

    // Keep only last N form entries
    if (homeEntry.form.length > MAX_FORM_LENGTH) {
      homeEntry.form = homeEntry.form.slice(-MAX_FORM_LENGTH);
    }
    if (awayEntry.form.length > MAX_FORM_LENGTH) {
      awayEntry.form = awayEntry.form.slice(-MAX_FORM_LENGTH);
    }
  }

  return sortStandings(standings);
}

/**
 * Sort standings by tiebreaker rules:
 * 1. Points (descending)
 * 2. Goal difference (descending)
 * 3. Goals for (descending)
 * 4. Team ID alphabetical (final deterministic tiebreaker)
 *
 * Returns a new sorted array; does not mutate the input.
 */
export function sortStandings(standings: StandingEntry[]): StandingEntry[] {
  return [...standings].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    return a.teamId.localeCompare(b.teamId);
  });
}

/**
 * Get a team's position in the standings (1-indexed).
 * Standings are sorted before lookup so the caller doesn't need to pre-sort.
 * Returns -1 if the team is not found.
 */
export function getTeamPosition(standings: StandingEntry[], teamId: string): number {
  const sorted = sortStandings(standings);
  const index = sorted.findIndex((e) => e.teamId === teamId);
  return index === -1 ? -1 : index + 1;
}

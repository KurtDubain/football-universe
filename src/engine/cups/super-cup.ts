import { SuperCupState, SuperCupGroup, CupRound, CupFixture } from '../../types/cup';
import { StandingEntry } from '../../types/league';
import { MatchResult } from '../../types/match';
import { SeededRNG } from '../match/rng';
import { drawGroups } from './draw';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createEmptyStanding(teamId: string): StandingEntry {
  return {
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
  };
}

/**
 * Generate double round-robin fixtures for a group.
 *
 * Uses the circle (polygon) method:
 *   - Fix team 0 in place, rotate the remaining teams each round.
 *   - First half (rounds 1..n-1): generated order determines home/away.
 *   - Second half (rounds n..2(n-1)): swap home/away for the return fixtures.
 *
 * For 4 teams this produces 6 rounds of 2 matches each (= 6 games per team).
 */
function generateGroupFixtures(
  teamIds: string[],
  groupIndex: number,
  seasonNumber: number,
): CupFixture[] {
  const n = teamIds.length;
  const fixtures: CupFixture[] = [];

  const fixed = teamIds[0];
  const rotating = teamIds.slice(1);
  const numSingleRounds = n - 1;
  const singleRoundMatches: [string, string][][] = [];

  for (let r = 0; r < numSingleRounds; r++) {
    const roundMatches: [string, string][] = [];
    // Fixed team vs last in rotation
    roundMatches.push([fixed, rotating[rotating.length - 1]]);
    // Remaining pairs
    for (let i = 0; i < Math.floor((n - 1) / 2); i++) {
      roundMatches.push([rotating[i], rotating[rotating.length - 2 - i]]);
    }
    singleRoundMatches.push(roundMatches);
    // Rotate right: move last element to front
    rotating.unshift(rotating.pop()!);
  }

  // Double round-robin: second half reverses home/away
  const allRoundMatches = [
    ...singleRoundMatches,
    ...singleRoundMatches.map((round) =>
      round.map(([h, a]): [string, string] => [a, h]),
    ),
  ];

  const groupLetter = String.fromCharCode(65 + groupIndex); // A, B, C, D

  for (let r = 0; r < allRoundMatches.length; r++) {
    const roundMatches = allRoundMatches[r];
    for (let m = 0; m < roundMatches.length; m++) {
      fixtures.push({
        id: `SC-S${seasonNumber}-G${groupLetter}-R${r + 1}-M${m + 1}`,
        round: r + 1,
        roundName: `Group ${groupLetter} - R${r + 1}`,
        homeTeamId: roundMatches[m][0],
        awayTeamId: roundMatches[m][1],
      });
    }
  }

  return fixtures;
}

/**
 * Extract the season number embedded in the first group fixture ID.
 */
function extractSeason(state: SuperCupState): number {
  const firstFixture = state.groups[0]?.fixtures[0];
  if (!firstFixture) return 1;
  const m = firstFixture.id.match(/SC-S(\d+)/);
  return m ? parseInt(m[1], 10) : 1;
}

/**
 * Determine the winner of a two-legged tie given both leg fixtures and the
 * second-leg MatchResult (needed for penalty info).
 *
 * Resolution order:
 *   1. Aggregate score (regulation + ET goals from both legs).
 *   2. Away goals rule (if enabled).
 *   3. Penalties from the second leg.
 */
function determineWinnerTwoLegged(
  firstLegFixture: CupFixture,
  secondLegFixture: CupFixture,
  secondLegResult: MatchResult,
  awayGoalRule: boolean,
): string {
  const firstLeg = firstLegFixture.result!;
  const secondLeg = secondLegFixture.result!;

  // team1 is home in leg 1, away in leg 2
  // team2 is away in leg 1, home in leg 2
  const team1 = firstLegFixture.homeTeamId;
  const team2 = firstLegFixture.awayTeamId;

  const team1Agg = firstLeg.home + secondLeg.away; // home in L1 + away in L2
  const team2Agg = firstLeg.away + secondLeg.home; // away in L1 + home in L2

  if (team1Agg !== team2Agg) {
    return team1Agg > team2Agg ? team1 : team2;
  }

  // Aggregate level -> apply away goals rule
  if (awayGoalRule) {
    const team1Away = secondLeg.away; // team1's away goals (scored in L2)
    const team2Away = firstLeg.away;  // team2's away goals (scored in L1)
    if (team1Away !== team2Away) {
      return team1Away > team2Away ? team1 : team2;
    }
  }

  // Still level -> penalties from the second leg decide
  if (
    secondLegResult.penalties &&
    secondLegResult.penaltyHome != null &&
    secondLegResult.penaltyAway != null
  ) {
    // In the second leg: home = team2, away = team1
    return secondLegResult.penaltyHome > secondLegResult.penaltyAway
      ? team2
      : team1;
  }

  // Fallback (should not occur if match engine resolves ties)
  return secondLegFixture.homeTeamId;
}

/**
 * Determine the winner of a single-leg knockout match (used for the Final).
 */
function determineSingleMatchWinner(result: MatchResult): string {
  const totalHome = result.homeGoals + (result.etHomeGoals ?? 0);
  const totalAway = result.awayGoals + (result.etAwayGoals ?? 0);

  if (totalHome !== totalAway) {
    return totalHome > totalAway ? result.homeTeamId : result.awayTeamId;
  }

  if (result.penalties && result.penaltyHome != null && result.penaltyAway != null) {
    return result.penaltyHome > result.penaltyAway
      ? result.homeTeamId
      : result.awayTeamId;
  }

  return result.homeTeamId;
}

/**
 * Record a knockout match result on a CupFixture, including ET goals.
 */
function recordKnockoutResult(fixture: CupFixture, result: MatchResult): void {
  fixture.result = {
    home: result.homeGoals + (result.etHomeGoals ?? 0),
    away: result.awayGoals + (result.etAwayGoals ?? 0),
    extraTime: result.extraTime || undefined,
    penalties: result.penalties || undefined,
    penHome: result.penaltyHome,
    penAway: result.penaltyAway,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the super cup.
 * Draw 16 teams into 4 groups of 4.
 * Generate all group stage fixtures (6 rounds of matches per group).
 * The group standings use the same StandingEntry type as leagues.
 */
export function initSuperCup(
  qualifiedTeamIds: string[],
  seasonNumber: number,
  rng: SeededRNG,
  awayGoalRule: boolean,
): SuperCupState {
  if (qualifiedTeamIds.length !== 16) {
    throw new Error(`Super cup requires 16 teams, got ${qualifiedTeamIds.length}`);
  }

  const groupTeams = drawGroups(qualifiedTeamIds, 4, rng);

  const groups: SuperCupGroup[] = groupTeams.map((teamIds, i) => ({
    groupName: String.fromCharCode(65 + i),
    teamIds,
    standings: teamIds.map(createEmptyStanding),
    fixtures: generateGroupFixtures(teamIds, i, seasonNumber),
  }));

  return {
    groups,
    knockoutRounds: [],
    groupStageCompleted: false,
    completed: false,
    awayGoalRule,
  };
}

/**
 * Get fixtures for a specific group stage round (1-6).
 * Returns fixtures across all groups for that round number.
 */
export function getSuperCupGroupFixtures(
  state: SuperCupState,
  round: number,
): CupFixture[] {
  const fixtures: CupFixture[] = [];
  for (const group of state.groups) {
    for (const fixture of group.fixtures) {
      if (fixture.round === round) {
        fixtures.push(fixture);
      }
    }
  }
  return fixtures;
}

/**
 * Update group standings after a round of group matches.
 * Processes only fixtures whose results haven't been recorded yet.
 * Re-sorts standings by points, then goal difference, then goals scored.
 */
export function updateSuperCupGroupStandings(
  state: SuperCupState,
  results: MatchResult[],
): SuperCupState {
  const resultMap = new Map(results.map((r) => [r.fixtureId, r]));

  const updatedGroups = state.groups.map((group) => {
    // Deep-copy standings so we don't mutate the original
    const standingsMap = new Map(
      group.standings.map((s) => [s.teamId, { ...s, form: [...s.form] }]),
    );

    for (const fixture of group.fixtures) {
      const result = resultMap.get(fixture.id);
      if (!result) continue;
      if (fixture.result) continue; // Already processed

      // Record group match result (no extra time in group stage)
      fixture.result = {
        home: result.homeGoals,
        away: result.awayGoals,
      };

      const homeEntry = standingsMap.get(fixture.homeTeamId)!;
      const awayEntry = standingsMap.get(fixture.awayTeamId)!;

      homeEntry.played++;
      awayEntry.played++;
      homeEntry.goalsFor += result.homeGoals;
      homeEntry.goalsAgainst += result.awayGoals;
      awayEntry.goalsFor += result.awayGoals;
      awayEntry.goalsAgainst += result.homeGoals;

      if (result.homeGoals > result.awayGoals) {
        homeEntry.won++;
        homeEntry.points += 3;
        homeEntry.form.push('W');
        awayEntry.lost++;
        awayEntry.form.push('L');
      } else if (result.homeGoals < result.awayGoals) {
        awayEntry.won++;
        awayEntry.points += 3;
        awayEntry.form.push('W');
        homeEntry.lost++;
        homeEntry.form.push('L');
      } else {
        homeEntry.drawn++;
        awayEntry.drawn++;
        homeEntry.points += 1;
        awayEntry.points += 1;
        homeEntry.form.push('D');
        awayEntry.form.push('D');
      }

      homeEntry.goalDifference = homeEntry.goalsFor - homeEntry.goalsAgainst;
      awayEntry.goalDifference = awayEntry.goalsFor - awayEntry.goalsAgainst;
    }

    // Sort standings: points -> GD -> GF (descending)
    const sorted = Array.from(standingsMap.values()).sort(
      (a, b) =>
        b.points - a.points ||
        b.goalDifference - a.goalDifference ||
        b.goalsFor - a.goalsFor,
    );

    return { ...group, standings: sorted };
  });

  return { ...state, groups: updatedGroups };
}

/**
 * After all 6 group rounds, determine who qualifies (top 2 per group = 8 teams).
 * Generate QF fixtures (two-legged):
 *   1A vs 2B, 1B vs 2A, 1C vs 2D, 1D vs 2C
 */
export function completeSuperCupGroupStage(
  state: SuperCupState,
  rng: SeededRNG,
): SuperCupState {
  const season = extractSeason(state);

  // QF pairings: group winner vs runner-up of paired group
  const pairings: [string, string][] = [
    [state.groups[0].standings[0].teamId, state.groups[1].standings[1].teamId], // 1A vs 2B
    [state.groups[1].standings[0].teamId, state.groups[0].standings[1].teamId], // 1B vs 2A
    [state.groups[2].standings[0].teamId, state.groups[3].standings[1].teamId], // 1C vs 2D
    [state.groups[3].standings[0].teamId, state.groups[2].standings[1].teamId], // 1D vs 2C
  ];

  // QF first leg: higher-seeded team at home
  const qfL1Fixtures: CupFixture[] = pairings.map((pair, i) => ({
    id: `SC-S${season}-QF-M${i + 1}-L1`,
    round: 1,
    roundName: 'QF',
    homeTeamId: pair[0],
    awayTeamId: pair[1],
  }));

  // QF second leg: reverse home/away
  const qfL2Fixtures: CupFixture[] = pairings.map((pair, i) => ({
    id: `SC-S${season}-QF-M${i + 1}-L2`,
    round: 2,
    roundName: 'QF',
    homeTeamId: pair[1],
    awayTeamId: pair[0],
  }));

  const knockoutRounds: CupRound[] = [
    { roundNumber: 1, roundName: 'QF-L1', fixtures: qfL1Fixtures, completed: false },
    { roundNumber: 2, roundName: 'QF-L2', fixtures: qfL2Fixtures, completed: false },
  ];

  return {
    ...state,
    groupStageCompleted: true,
    knockoutRounds,
  };
}

/**
 * Advance knockout round after results.
 *
 * The knockout phase has up to 5 rounds stored in knockoutRounds[]:
 *   QF-L1, QF-L2, SF-L1, SF-L2, Final
 *
 * - First legs (QF-L1, SF-L1): record results only; winners TBD after L2.
 * - Second legs (QF-L2, SF-L2): aggregate scores to determine winners,
 *   then generate the next round's fixtures.
 * - Final: single match; determines the tournament winner.
 *
 * For two-legged ties: aggregate scores. If level, away goals rule (if enabled),
 * then extra time and penalties on second leg.
 * For final: single match, knockout rules.
 */
export function advanceSuperCupKnockout(
  state: SuperCupState,
  results: MatchResult[],
  rng: SeededRNG,
): SuperCupState {
  const resultMap = new Map(results.map((r) => [r.fixtureId, r]));

  // Find the first incomplete knockout round
  const currentRoundIdx = state.knockoutRounds.findIndex((r) => !r.completed);
  if (currentRoundIdx === -1) return state;

  const currentRound = state.knockoutRounds[currentRoundIdx];
  const season = extractSeason(state);

  // Record results on all fixtures in this round
  for (const fixture of currentRound.fixtures) {
    const result = resultMap.get(fixture.id);
    if (!result) continue;
    recordKnockoutResult(fixture, result);
  }

  currentRound.completed = true;

  const roundName = currentRound.roundName;

  // ---- First legs: just record, wait for second leg ----
  if (roundName === 'QF-L1' || roundName === 'SF-L1') {
    return { ...state };
  }

  // ---- Second legs: determine aggregate winners, create next round ----
  if (roundName === 'QF-L2' || roundName === 'SF-L2') {
    const firstLegRound = state.knockoutRounds[currentRoundIdx - 1];
    const winners: string[] = [];

    for (let i = 0; i < currentRound.fixtures.length; i++) {
      const firstLegFixture = firstLegRound.fixtures[i];
      const secondLegFixture = currentRound.fixtures[i];
      const secondLegResult = resultMap.get(secondLegFixture.id)!;

      const winnerId = determineWinnerTwoLegged(
        firstLegFixture,
        secondLegFixture,
        secondLegResult,
        state.awayGoalRule,
      );

      firstLegFixture.winnerId = winnerId;
      secondLegFixture.winnerId = winnerId;
      winners.push(winnerId);
    }

    if (roundName === 'QF-L2') {
      // Create SF fixtures (two-legged)
      const sfPairings: [string, string][] = [];
      for (let i = 0; i < winners.length; i += 2) {
        sfPairings.push([winners[i], winners[i + 1]]);
      }

      const sfL1Fixtures: CupFixture[] = sfPairings.map((pair, i) => ({
        id: `SC-S${season}-SF-M${i + 1}-L1`,
        round: 3,
        roundName: 'SF',
        homeTeamId: pair[0],
        awayTeamId: pair[1],
      }));

      const sfL2Fixtures: CupFixture[] = sfPairings.map((pair, i) => ({
        id: `SC-S${season}-SF-M${i + 1}-L2`,
        round: 4,
        roundName: 'SF',
        homeTeamId: pair[1],
        awayTeamId: pair[0],
      }));

      state.knockoutRounds.push(
        { roundNumber: 3, roundName: 'SF-L1', fixtures: sfL1Fixtures, completed: false },
        { roundNumber: 4, roundName: 'SF-L2', fixtures: sfL2Fixtures, completed: false },
      );
    } else {
      // SF-L2 -> create Final (single match)
      const finalFixture: CupFixture = {
        id: `SC-S${season}-Final-M1-L1`,
        round: 5,
        roundName: 'Final',
        homeTeamId: winners[0],
        awayTeamId: winners[1],
      };

      state.knockoutRounds.push({
        roundNumber: 5,
        roundName: 'Final',
        fixtures: [finalFixture],
        completed: false,
      });
    }

    return { ...state };
  }

  // ---- Final: single-match knockout ----
  if (roundName === 'Final') {
    const finalFixture = currentRound.fixtures[0];
    const result = resultMap.get(finalFixture.id);
    if (result) {
      const winnerId = determineSingleMatchWinner(result);
      finalFixture.winnerId = winnerId;

      return {
        ...state,
        completed: true,
        winnerId,
      };
    }
  }

  return { ...state };
}

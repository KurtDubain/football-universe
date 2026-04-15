import { WorldCupState, SuperCupGroup, CupRound, CupFixture } from '../../types/cup';
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
 * Generate double round-robin fixtures for a group (same algorithm as super cup).
 * Circle method: fix team 0, rotate the rest.
 * First half home/away as generated, second half reversed.
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
    roundMatches.push([fixed, rotating[rotating.length - 1]]);
    for (let i = 0; i < Math.floor((n - 1) / 2); i++) {
      roundMatches.push([rotating[i], rotating[rotating.length - 2 - i]]);
    }
    singleRoundMatches.push(roundMatches);
    rotating.unshift(rotating.pop()!);
  }

  const allRoundMatches = [
    ...singleRoundMatches,
    ...singleRoundMatches.map((round) =>
      round.map(([h, a]): [string, string] => [a, h]),
    ),
  ];

  const groupLetter = String.fromCharCode(65 + groupIndex);

  for (let r = 0; r < allRoundMatches.length; r++) {
    const roundMatches = allRoundMatches[r];
    for (let m = 0; m < roundMatches.length; m++) {
      fixtures.push({
        id: `WC-S${seasonNumber}-G${groupLetter}-R${r + 1}-M${m + 1}`,
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
 * Extract the season number from the first group fixture ID.
 */
function extractSeason(state: WorldCupState): number {
  const firstFixture = state.groups[0]?.fixtures[0];
  if (!firstFixture) return 1;
  const m = firstFixture.id.match(/WC-S(\d+)/);
  return m ? parseInt(m[1], 10) : 1;
}

/**
 * Determine the winner of a single-leg knockout match.
 * Checks regulation + ET goals, then penalties.
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

/** Map from number of matches in a round to its name. */
const KNOCKOUT_NAME: Record<number, string> = {
  8: 'R16',
  4: 'QF',
  2: 'SF',
  1: 'Final',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Select 16 teams for world cup.
 * Takes the top 16 teams by their overall rating at the time of selection.
 */
export function selectWorldCupParticipants(
  allTeamIds: string[],
  teamOveralls: Record<string, number>,
): string[] {
  return [...allTeamIds]
    .sort((a, b) => (teamOveralls[b] ?? 0) - (teamOveralls[a] ?? 0))
    .slice(0, 16);
}

/**
 * Initialize the world cup.
 * Draw 16 teams into 4 groups of 4 with pot-based seeding.
 * Generate group stage fixtures (6 rounds per group, double round-robin).
 *
 * Pots (based on the order of participantIds, which should be pre-sorted
 * by overall rating from selectWorldCupParticipants):
 *   Pot 1: teams 1-4 (highest rated)
 *   Pot 2: teams 5-8
 *   Pot 3: teams 9-12
 *   Pot 4: teams 13-16
 */
export function initWorldCup(
  participantIds: string[],
  seasonNumber: number,
  rng: SeededRNG,
): WorldCupState {
  if (participantIds.length !== 16) {
    throw new Error(`World cup requires 16 teams, got ${participantIds.length}`);
  }

  // Pot-based seeding: 4 pots of 4 teams each
  const pots: string[][] = [
    participantIds.slice(0, 4),
    participantIds.slice(4, 8),
    participantIds.slice(8, 12),
    participantIds.slice(12, 16),
  ];

  const groupTeams = drawGroups(participantIds, 4, rng, pots);

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
    participantIds,
  };
}

/**
 * Update group standings after a round.
 * Processes only fixtures whose results haven't been recorded yet.
 * Re-sorts standings by points, then goal difference, then goals scored.
 */
export function updateWorldCupGroupStandings(
  state: WorldCupState,
  results: MatchResult[],
): WorldCupState {
  const resultMap = new Map(results.map((r) => [r.fixtureId, r]));

  const updatedGroups = state.groups.map((group) => {
    const standingsMap = new Map(
      group.standings.map((s) => [s.teamId, { ...s, form: [...s.form] }]),
    );

    for (const fixture of group.fixtures) {
      const result = resultMap.get(fixture.id);
      if (!result) continue;
      if (fixture.result) continue; // Already processed

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
 * Complete group stage. ALL 16 teams enter knockout.
 *
 * Ranking: all teams ranked by group position, then by points, GD, GF.
 * R16 pairings: rank 1 vs rank 16, rank 2 vs rank 15, ..., rank 8 vs rank 9.
 * This ensures group winners (ranks 1-4) face group 4th-placers (ranks 13-16)
 * from other groups, rewarding strong group-stage performance.
 *
 * The higher-ranked team in each pair gets home advantage.
 */
export function completeWorldCupGroupStage(
  state: WorldCupState,
  rng: SeededRNG,
): WorldCupState {
  const season = extractSeason(state);

  // Build a global ranking: position within group is primary, then tiebreakers
  const rankedTeams: {
    teamId: string;
    groupIndex: number;
    position: number;
    standing: StandingEntry;
  }[] = [];

  for (let gi = 0; gi < state.groups.length; gi++) {
    const group = state.groups[gi];
    for (let pos = 0; pos < group.standings.length; pos++) {
      rankedTeams.push({
        teamId: group.standings[pos].teamId,
        groupIndex: gi,
        position: pos + 1, // 1-indexed
        standing: group.standings[pos],
      });
    }
  }

  // Sort: group position first (1st placers before 2nd, etc.), then points/GD/GF
  rankedTeams.sort(
    (a, b) =>
      a.position - b.position ||
      b.standing.points - a.standing.points ||
      b.standing.goalDifference - a.standing.goalDifference ||
      b.standing.goalsFor - a.standing.goalsFor,
  );

  // R16 pairings: rank 1 vs rank 16, rank 2 vs rank 15, etc.
  const totalTeams = rankedTeams.length;
  const r16Fixtures: CupFixture[] = [];

  for (let i = 0; i < totalTeams / 2; i++) {
    const higher = rankedTeams[i];
    const lower = rankedTeams[totalTeams - 1 - i];

    r16Fixtures.push({
      id: `WC-S${season}-R16-M${i + 1}`,
      round: 1,
      roundName: 'R16',
      homeTeamId: higher.teamId,
      awayTeamId: lower.teamId,
    });
  }

  const knockoutRounds: CupRound[] = [
    { roundNumber: 1, roundName: 'R16', fixtures: r16Fixtures, completed: false },
  ];

  return {
    ...state,
    groupStageCompleted: true,
    knockoutRounds,
  };
}

/**
 * Advance knockout round. Single-leg elimination with ET/pens.
 *
 * After processing results, winners are paired in order for the next round:
 *   winner of M1 vs winner of M2, winner of M3 vs winner of M4, etc.
 *
 * When only 1 fixture remains (Final), its winner becomes the tournament winner.
 */
export function advanceWorldCupKnockout(
  state: WorldCupState,
  results: MatchResult[],
  rng: SeededRNG,
): WorldCupState {
  const resultMap = new Map(results.map((r) => [r.fixtureId, r]));

  // Find the first incomplete knockout round
  const currentRoundIdx = state.knockoutRounds.findIndex((r) => !r.completed);
  if (currentRoundIdx === -1) return state;

  const currentRound = state.knockoutRounds[currentRoundIdx];
  const winners: string[] = [];

  for (const fixture of currentRound.fixtures) {
    const result = resultMap.get(fixture.id);
    if (!result) continue;

    // Record result including ET goals
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

  // If only 1 fixture (Final), tournament is complete
  if (currentRound.fixtures.length === 1) {
    return {
      ...state,
      completed: true,
      winnerId: winners[0],
    };
  }

  // Create next round
  const season = extractSeason(state);
  const nextMatchCount = winners.length / 2;
  const nextRoundName = KNOCKOUT_NAME[nextMatchCount] || `R${nextMatchCount * 2}`;

  const nextFixtures: CupFixture[] = [];
  for (let i = 0; i < winners.length; i += 2) {
    nextFixtures.push({
      id: `WC-S${season}-${nextRoundName}-M${Math.floor(i / 2) + 1}`,
      round: currentRound.roundNumber + 1,
      roundName: nextRoundName,
      homeTeamId: winners[i],
      awayTeamId: winners[i + 1],
    });
  }

  state.knockoutRounds.push({
    roundNumber: currentRound.roundNumber + 1,
    roundName: nextRoundName,
    fixtures: nextFixtures,
    completed: false,
  });

  return { ...state };
}

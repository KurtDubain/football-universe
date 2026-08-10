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

/** Generate one neutral-venue round robin: 3 rounds and 6 matches per group. */
function generateGroupFixtures(
  teamIds: string[],
  groupIndex: number,
  seasonNumber: number,
  hostTeamId?: string,
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

  const groupLetter = String.fromCharCode(65 + groupIndex);

  for (let r = 0; r < singleRoundMatches.length; r++) {
    const roundMatches = singleRoundMatches[r];
    for (let m = 0; m < roundMatches.length; m++) {
      fixtures.push({
        id: `WC-S${seasonNumber}-G${groupLetter}-R${r + 1}-M${m + 1}`,
        round: r + 1,
        roundName: `Group ${groupLetter} - R${r + 1}`,
        homeTeamId: roundMatches[m][0],
        awayTeamId: roundMatches[m][1],
        isNeutralVenue: true,
        ...(hostTeamId ? { tournamentHostTeamId: hostTeamId } : {}),
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

  throw new Error(`Unresolved knockout result: ${result.fixtureId}`);
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
 * Select all 32 teams for world cup.
 */
export function selectWorldCupParticipants(
  allTeamIds: string[],
  teamOveralls: Record<string, number>,
): string[] {
  // All 32 teams participate
  return [...allTeamIds].sort((a, b) => (teamOveralls[b] ?? 0) - (teamOveralls[a] ?? 0));
}

/**
 * Initialize the world cup — 32 teams, 8 groups of 4.
 *
 * Pot system based on league level for balanced groups:
 *   Pot 1: top 8 (by overall) — seeded into 8 groups
 *   Pot 2: next 8
 *   Pot 3: next 8
 *   Pot 4: bottom 8
 * Each group gets exactly 1 team from each pot.
 */
export function initWorldCup(
  participantIds: string[],
  seasonNumber: number,
  rng: SeededRNG,
  hostTeamId?: string,
): WorldCupState {
  if (participantIds.length !== 32) {
    throw new Error(`World cup requires 32 teams, got ${participantIds.length}`);
  }

  // 4 pots of 8 teams each (already sorted by overall)
  const pots: string[][] = [
    participantIds.slice(0, 8),
    participantIds.slice(8, 16),
    participantIds.slice(16, 24),
    participantIds.slice(24, 32),
  ];

  const groupTeams = drawGroups(participantIds, 8, rng, pots);

  const groups: SuperCupGroup[] = groupTeams.map((teamIds, i) => ({
    groupName: String.fromCharCode(65 + i),
    teamIds,
    standings: teamIds.map(createEmptyStanding),
    fixtures: generateGroupFixtures(teamIds, i, seasonNumber, hostTeamId),
  }));

  return {
    groups,
    knockoutRounds: [],
    groupStageCompleted: false,
    completed: false,
    participantIds,
    ...(hostTeamId ? { hostTeamId } : {}),
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
  const participantRank = new Map(state.participantIds.map((teamId, index) => [teamId, index]));

  const updatedGroups = state.groups.map((group) => {
    const standingsMap = new Map(
      group.standings.map((s) => [s.teamId, { ...s, form: [...s.form] }]),
    );

    const fixtures = group.fixtures.map((fixture) => {
      const result = resultMap.get(fixture.id);
      if (!result || fixture.result) {
        return {
          ...fixture,
          result: fixture.result ? { ...fixture.result } : undefined,
        };
      }

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

      return {
        ...fixture,
        result: {
          home: result.homeGoals,
          away: result.awayGoals,
        },
      };
    });

    const sorted = Array.from(standingsMap.values()).sort(
      (a, b) =>
        b.points - a.points ||
        b.goalDifference - a.goalDifference ||
        b.goalsFor - a.goalsFor ||
        (participantRank.get(a.teamId) ?? 999) - (participantRank.get(b.teamId) ?? 999) ||
        a.teamId.localeCompare(b.teamId),
    );

    return { ...group, fixtures, standings: sorted };
  });

  return { ...state, groups: updatedGroups };
}

/**
 * Complete group stage. Top 2 from each of 8 groups = 16 teams advance.
 *
 * R16 pairings (classic World Cup format):
 *   1A vs 2B, 1B vs 2A, 1C vs 2D, 1D vs 2C,
 *   1E vs 2F, 1F vs 2E, 1G vs 2H, 1H vs 2G
 */
export function completeWorldCupGroupStage(
  state: WorldCupState,
  rng: SeededRNG,
): WorldCupState {
  void rng; // Pairings are deterministic; keep the seeded API stable.
  const season = extractSeason(state);
  const g = state.groups;

  // Classic cross-group pairings
  const pairings: [string, string][] = [];
  const crossPairs = [[0,1],[2,3],[4,5],[6,7]]; // A-B, C-D, E-F, G-H

  for (const [ga, gb] of crossPairs) {
    if (g[ga] && g[gb]) {
      pairings.push([g[ga].standings[0].teamId, g[gb].standings[1].teamId]); // 1st vs 2nd
      pairings.push([g[gb].standings[0].teamId, g[ga].standings[1].teamId]); // 1st vs 2nd
    }
  }

  const r16Fixtures: CupFixture[] = pairings.map((pair, i) => ({
    id: `WC-S${season}-R16-M${i + 1}`,
    round: 1,
    roundName: 'R16',
    homeTeamId: pair[0],
    awayTeamId: pair[1],
    isNeutralVenue: true,
    ...(state.hostTeamId ? { tournamentHostTeamId: state.hostTeamId } : {}),
  }));

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
  void rng; // Pairings are deterministic; keep the seeded API stable.
  const resultMap = new Map(results.map((r) => [r.fixtureId, r]));

  // Find the first incomplete knockout round
  const currentRoundIdx = state.knockoutRounds.findIndex((r) => !r.completed);
  if (currentRoundIdx === -1) return state;
  const sourceRound = state.knockoutRounds[currentRoundIdx];
  const missing = sourceRound.fixtures.find(fixture => !resultMap.has(fixture.id));
  if (missing) throw new Error(`Missing result for fixture ${missing.id}`);

  const knockoutRounds: CupRound[] = state.knockoutRounds.map(round => ({
    ...round,
    fixtures: round.fixtures.map(fixture => ({
      ...fixture,
      result: fixture.result ? { ...fixture.result } : undefined,
    })),
  }));
  const currentRound = knockoutRounds[currentRoundIdx];
  const winners: string[] = [];

  currentRound.fixtures = currentRound.fixtures.map((fixture) => {
    const result = resultMap.get(fixture.id)!;

    const winnerId = determineSingleMatchWinner(result);
    winners.push(winnerId);
    return {
      ...fixture,
      result: {
      home: result.homeGoals + (result.etHomeGoals ?? 0),
      away: result.awayGoals + (result.etAwayGoals ?? 0),
      extraTime: result.extraTime || undefined,
      penalties: result.penalties || undefined,
      penHome: result.penaltyHome,
      penAway: result.penaltyAway,
      },
      winnerId,
    };
  });

  currentRound.completed = true;

  // If only 1 fixture (Final), tournament is complete
  if (currentRound.fixtures.length === 1) {
    return {
      ...state,
      knockoutRounds,
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
      isNeutralVenue: true,
      ...(state.hostTeamId ? { tournamentHostTeamId: state.hostTeamId } : {}),
    });
  }

  knockoutRounds.push({
    roundNumber: currentRound.roundNumber + 1,
    roundName: nextRoundName,
    fixtures: nextFixtures,
    completed: false,
  });

  return { ...state, knockoutRounds };
}

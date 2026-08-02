import type {
  ContinentalCupState,
  CupFixture,
  CupRegion,
  CupRound,
  SuperCupGroup,
} from '../../types/cup';
import type { StandingEntry } from '../../types/league';
import type { MatchResult } from '../../types/match';
import { SeededRNG } from '../match/rng';
import { drawGroups } from './draw';

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

function generateGroupFixtures(
  type: ContinentalCupState['type'],
  teamIds: string[],
  groupIndex: number,
  seasonNumber: number,
): CupFixture[] {
  const fixed = teamIds[0];
  const rotating = teamIds.slice(1);
  const rounds: [string, string][][] = [];

  for (let round = 0; round < teamIds.length - 1; round++) {
    const matches: [string, string][] = [
      [fixed, rotating[rotating.length - 1]],
    ];
    for (let index = 0; index < Math.floor((teamIds.length - 1) / 2); index++) {
      matches.push([rotating[index], rotating[rotating.length - 2 - index]]);
    }
    rounds.push(matches);
    rotating.unshift(rotating.pop()!);
  }

  const groupName = String.fromCharCode(65 + groupIndex);
  return rounds.flatMap((matches, roundIndex) =>
    matches.map(([homeTeamId, awayTeamId], matchIndex) => ({
      id: `CC-${type}-S${seasonNumber}-G${groupName}-R${roundIndex + 1}-M${matchIndex + 1}`,
      round: roundIndex + 1,
      roundName: `Group ${groupName} - R${roundIndex + 1}`,
      homeTeamId,
      awayTeamId,
      isNeutralVenue: true,
    })),
  );
}

function determineSingleMatchWinner(result: MatchResult): string {
  const totalHome = result.homeGoals + (result.etHomeGoals ?? 0);
  const totalAway = result.awayGoals + (result.etAwayGoals ?? 0);
  if (totalHome !== totalAway) {
    return totalHome > totalAway ? result.homeTeamId : result.awayTeamId;
  }
  if (result.penalties && result.penaltyHome != null && result.penaltyAway != null) {
    return result.penaltyHome > result.penaltyAway ? result.homeTeamId : result.awayTeamId;
  }
  throw new Error(`Unresolved knockout result: ${result.fixtureId}`);
}

function extractSeason(cup: ContinentalCupState): number {
  const fixture = cup.groups[0]?.fixtures[0] ?? cup.rounds[0]?.fixtures[0];
  const match = fixture?.id.match(/-S(\d+)-/);
  return match ? Number.parseInt(match[1], 10) : 1;
}

function updateGroupStandings(
  cup: ContinentalCupState,
  results: MatchResult[],
): ContinentalCupState {
  const resultMap = new Map(results.map(result => [result.fixtureId, result]));
  const seedRank = new Map(cup.qualificationOrder.map((teamId, index) => [teamId, index]));

  const groups = cup.groups.map((group) => {
    const standings = new Map(
      group.standings.map(entry => [entry.teamId, { ...entry, form: [...entry.form] }]),
    );
    const fixtures = group.fixtures.map((fixture) => {
      const result = resultMap.get(fixture.id);
      if (!result || fixture.result) {
        return {
          ...fixture,
          result: fixture.result ? { ...fixture.result } : undefined,
        };
      }

      const home = standings.get(fixture.homeTeamId)!;
      const away = standings.get(fixture.awayTeamId)!;
      home.played++;
      away.played++;
      home.goalsFor += result.homeGoals;
      home.goalsAgainst += result.awayGoals;
      away.goalsFor += result.awayGoals;
      away.goalsAgainst += result.homeGoals;

      if (result.homeGoals > result.awayGoals) {
        home.won++;
        home.points += 3;
        home.form.push('W');
        away.lost++;
        away.form.push('L');
      } else if (result.homeGoals < result.awayGoals) {
        away.won++;
        away.points += 3;
        away.form.push('W');
        home.lost++;
        home.form.push('L');
      } else {
        home.drawn++;
        away.drawn++;
        home.points++;
        away.points++;
        home.form.push('D');
        away.form.push('D');
      }
      home.goalDifference = home.goalsFor - home.goalsAgainst;
      away.goalDifference = away.goalsFor - away.goalsAgainst;

      return {
        ...fixture,
        result: {
          home: result.homeGoals,
          away: result.awayGoals,
        },
      };
    });

    const sorted = [...standings.values()].sort((a, b) =>
      b.points - a.points
      || b.goalDifference - a.goalDifference
      || b.goalsFor - a.goalsFor
      || (seedRank.get(a.teamId) ?? 999) - (seedRank.get(b.teamId) ?? 999)
      || a.teamId.localeCompare(b.teamId),
    );
    return { ...group, fixtures, standings: sorted };
  });

  return { ...cup, groups };
}

function completeGroupStage(cup: ContinentalCupState): ContinentalCupState {
  const season = extractSeason(cup);
  const pairings: [string, string][] = cup.region === '大陆'
    ? [
        [cup.groups[0].standings[0].teamId, cup.groups[1].standings[1].teamId],
        [cup.groups[1].standings[0].teamId, cup.groups[0].standings[1].teamId],
      ]
    : [[cup.groups[0].standings[0].teamId, cup.groups[0].standings[1].teamId]];
  const roundName = cup.region === '大陆' ? 'SF' : 'Final';
  const fixtures: CupFixture[] = pairings.map(([homeTeamId, awayTeamId], index) => ({
    id: `CC-${cup.type}-S${season}-${roundName}-M${index + 1}`,
    round: 1,
    roundName,
    homeTeamId,
    awayTeamId,
    isNeutralVenue: true,
  }));

  return {
    ...cup,
    groupStageCompleted: true,
    currentRound: 1,
    rounds: [{
      roundNumber: 1,
      roundName,
      fixtures,
      completed: false,
    }],
  };
}

/**
 * Initialize one coefficient-qualified continental cup.
 *
 * Mainland: two groups of four, then SF and Final.
 * Southern/Eastern: one group of four, then Final.
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
  const groupCount = region === '大陆' ? 2 : 1;
  const pots = region === '大陆'
    ? [
        teamIds.slice(0, 2),
        teamIds.slice(2, 4),
        teamIds.slice(4, 6),
        teamIds.slice(6, 8),
      ]
    : undefined;
  const groupTeams = drawGroups(teamIds, groupCount, rng, pots);
  const groups: SuperCupGroup[] = groupTeams.map((groupTeamIds, index) => ({
    groupName: String.fromCharCode(65 + index),
    teamIds: groupTeamIds,
    standings: groupTeamIds.map(createEmptyStanding),
    fixtures: generateGroupFixtures(type, groupTeamIds, index, seasonNumber),
  }));

  return {
    name: REGION_TO_NAME[region],
    type,
    region,
    groups,
    groupStageCompleted: false,
    participantIds: [...teamIds],
    qualificationOrder: [...teamIds],
    rounds: [],
    currentRound: 0,
    completed: false,
  };
}

export function getContinentalCupCurrentFixtures(cup: ContinentalCupState): CupFixture[] {
  if (!cup.groupStageCompleted) {
    for (let round = 1; round <= 3; round++) {
      const fixtures = cup.groups.flatMap(group =>
        group.fixtures.filter(fixture => fixture.round === round),
      );
      if (fixtures.some(fixture => !fixture.result)) return fixtures;
    }
    return [];
  }
  const round = cup.rounds.find(item => item.roundNumber === cup.currentRound);
  return round?.fixtures ?? [];
}

export function advanceContinentalCup(
  cup: ContinentalCupState,
  results: MatchResult[],
): ContinentalCupState {
  if (!cup.groupStageCompleted) {
    const currentFixtures = getContinentalCupCurrentFixtures(cup);
    const resultIds = new Set(results.map(result => result.fixtureId));
    const missing = currentFixtures.find(fixture => !resultIds.has(fixture.id));
    if (missing) throw new Error(`Missing result for fixture ${missing.id} (${cup.name})`);
    const updated = updateGroupStandings(cup, results);
    const groupStageCompleted = updated.groups.every(group =>
      group.fixtures.every(fixture => fixture.result),
    );
    return groupStageCompleted ? completeGroupStage(updated) : updated;
  }

  const currentRoundIndex = cup.rounds.findIndex(round => round.roundNumber === cup.currentRound);
  if (currentRoundIndex === -1) {
    throw new Error(`Current round ${cup.currentRound} not found in ${cup.name}`);
  }

  const resultMap = new Map(results.map(result => [result.fixtureId, result]));
  const rounds: CupRound[] = cup.rounds.map(round => ({
    ...round,
    fixtures: round.fixtures.map(fixture => ({
      ...fixture,
      result: fixture.result ? { ...fixture.result } : undefined,
    })),
  }));
  const currentRound = rounds[currentRoundIndex];
  const winners: string[] = [];

  currentRound.fixtures = currentRound.fixtures.map((fixture) => {
    const result = resultMap.get(fixture.id);
    if (!result) throw new Error(`Missing result for fixture ${fixture.id} (${cup.name})`);
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

  if (currentRound.fixtures.length === 1) {
    return {
      ...cup,
      rounds,
      completed: true,
      winnerId: winners[0],
    };
  }

  const finalFixture: CupFixture = {
    id: `CC-${cup.type}-S${extractSeason(cup)}-Final-M1`,
    round: currentRound.roundNumber + 1,
    roundName: 'Final',
    homeTeamId: winners[0],
    awayTeamId: winners[1],
    isNeutralVenue: true,
  };
  rounds.push({
    roundNumber: currentRound.roundNumber + 1,
    roundName: 'Final',
    fixtures: [finalFixture],
    completed: false,
  });

  return {
    ...cup,
    rounds,
    currentRound: currentRound.roundNumber + 1,
  };
}

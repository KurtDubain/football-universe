import type { SeasonRecord, TeamBase } from '../../types/team';

const WINDOW_SEASONS = 5;
const RECENCY_WEIGHTS = [1, 0.85, 0.7, 0.55, 0.4] as const;

export interface ClubCoefficientSeason {
  seasonNumber: number;
  rawPoints: number;
  weight: number;
  points: number;
}

export interface ClubCoefficientEntry {
  rank: number;
  teamId: string;
  points: number;
  seasons: ClubCoefficientSeason[];
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function cupPoints(result: string | undefined, values: Record<string, number>): number {
  if (!result) return 0;
  return values[result] ?? 0;
}

export function scoreClubSeason(record: SeasonRecord): number {
  const leaguePoints = record.leagueLevel === 1
    ? Math.max(3, 18 - (record.leaguePosition - 1))
    : record.leagueLevel === 2
      ? Math.max(1, 7 - (record.leaguePosition - 1) * 0.75)
      : Math.max(0.5, 3 - (record.leaguePosition - 1) * 0.35);

  const domesticCup = cupPoints(record.cupResult, {
    '冠军': 6, '亚军': 4, '四强': 2.5, '八强': 1.5, '16强': 0.5,
  });
  const superCup = cupPoints(record.superCupResult, {
    '冠军': 8, '亚军': 5, '四强': 3, '八强': 1.5, '小组赛淘汰': 0.5,
  });
  const continentalCup = cupPoints(record.continentalCupResult, {
    '冠军': 18, '亚军': 12, '四强': 7, '八强': 4, '16强': 2,
  });
  const worldCup = cupPoints(record.worldCupResult, {
    '冠军': 25, '亚军': 17, '四强': 10, '八强': 6, '16强': 3, '小组赛淘汰': 1,
  });

  return roundOne(leaguePoints + domesticCup + superCup + continentalCup + worldCup);
}

export function calculateClubCoefficient(records: SeasonRecord[]): {
  points: number;
  seasons: ClubCoefficientSeason[];
} {
  const recent = [...records]
    .sort((a, b) => b.seasonNumber - a.seasonNumber)
    .slice(0, WINDOW_SEASONS);
  const seasons = recent.map((record, index) => {
    const rawPoints = scoreClubSeason(record);
    const weight = RECENCY_WEIGHTS[index];
    return {
      seasonNumber: record.seasonNumber,
      rawPoints,
      weight,
      points: roundOne(rawPoints * weight),
    };
  });
  return {
    points: roundOne(seasons.reduce((sum, season) => sum + season.points, 0)),
    seasons,
  };
}

export function rankClubCoefficients(
  teamBases: Record<string, TeamBase>,
  teamSeasonRecords: Record<string, SeasonRecord[]>,
): ClubCoefficientEntry[] {
  const ranked = Object.values(teamBases).map(team => ({
    teamId: team.id,
    reputation: team.reputation,
    overall: team.overall,
    ...calculateClubCoefficient(teamSeasonRecords[team.id] ?? []),
  }));

  ranked.sort((a, b) =>
    b.points - a.points
    || b.reputation - a.reputation
    || b.overall - a.overall
    || a.teamId.localeCompare(b.teamId),
  );

  return ranked.map((entry, index) => ({
    rank: index + 1,
    teamId: entry.teamId,
    points: entry.points,
    seasons: entry.seasons,
  }));
}

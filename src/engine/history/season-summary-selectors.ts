import type { HonorRecord } from '../../types/honor';
import type { SeasonRecord, Trophy } from '../../types/team';
import type { MatchHistoryEntry } from '../season/season-manager';

export interface SeasonStatTotals {
  matches: number;
  goals: number;
  goalsPerMatch: number;
}

export interface SeasonCompetitionStats {
  seasonNumber: number;
  scope: 'all_competitions' | 'league_only';
  primary: SeasonStatTotals;
  allCompetitions: SeasonStatTotals | null;
  league: SeasonStatTotals;
  source: 'match_history' | 'team_season_records';
}

interface SeasonStatsWorld {
  matchHistory?: MatchHistoryEntry[];
  teamSeasonRecords: Record<string, SeasonRecord[]>;
}

const CONTINENTAL_TITLE_TYPES = new Set<Trophy['type']>([
  'mainland_cup',
  'southern_cup',
  'eastern_cup',
]);

function totals(matches: number, goals: number): SeasonStatTotals {
  return {
    matches,
    goals,
    goalsPerMatch: matches > 0 ? goals / matches : 0,
  };
}

function isLeagueCompetition(name: string): boolean {
  return /^(顶级|甲级|乙级|\d+级)联赛$/.test(name.trim());
}

function leagueTotalsFromTeamRecords(
  teamSeasonRecords: Record<string, SeasonRecord[]>,
  seasonNumber: number,
): SeasonStatTotals {
  const records = Object.values(teamSeasonRecords)
    .flatMap(recordsForTeam => recordsForTeam)
    .filter(record => record.seasonNumber === seasonNumber);
  const matches = Math.round(records.reduce((sum, record) => sum + record.leaguePlayed, 0) / 2);
  const goals = records.reduce((sum, record) => sum + record.leagueGF, 0);
  return totals(matches, goals);
}

function totalsFromMatches(matches: readonly MatchHistoryEntry[]): SeasonStatTotals {
  return totals(
    matches.length,
    matches.reduce((sum, match) => sum + match.homeGoals + match.awayGoals, 0),
  );
}

export function selectSeasonCompetitionStats(
  world: SeasonStatsWorld,
  seasonNumber: number,
): SeasonCompetitionStats {
  const seasonMatches = (world.matchHistory ?? [])
    .filter(match => match.season === seasonNumber);
  const archivedLeague = totalsFromMatches(
    seasonMatches.filter(match => isLeagueCompetition(match.comp)),
  );
  const recordedLeague = leagueTotalsFromTeamRecords(world.teamSeasonRecords, seasonNumber);
  const hasRecordedLeague = recordedLeague.matches > 0;
  const archiveHasCompleteLeague = seasonMatches.length > 0 && (
    !hasRecordedLeague
    || (
      archivedLeague.matches === recordedLeague.matches
      && archivedLeague.goals === recordedLeague.goals
    )
  );

  if (archiveHasCompleteLeague) {
    const allCompetitions = totalsFromMatches(seasonMatches);
    return {
      seasonNumber,
      scope: 'all_competitions',
      primary: allCompetitions,
      allCompetitions,
      league: archivedLeague,
      source: 'match_history',
    };
  }

  const league = hasRecordedLeague ? recordedLeague : archivedLeague;
  return {
    seasonNumber,
    scope: 'league_only',
    primary: league,
    allCompetitions: null,
    league,
    source: 'team_season_records',
  };
}

export function formatSeasonCompetitionStats(stats: SeasonCompetitionStats): string {
  const scopeLabel = stats.scope === 'all_competitions' ? '全赛事' : '联赛统计';
  return `${scopeLabel} ${stats.primary.matches}场 · ${stats.primary.goals}粒进球 · 场均${stats.primary.goalsPerMatch.toFixed(2)}球`;
}

export function countTopFlightChampionTitles(
  honor: HonorRecord,
  championTrophies: readonly Trophy[] = [],
): number {
  const championId = honor.league1Champion;
  const domesticAndWorldWinners = [
    honor.leagueCupWinner,
    honor.superCupWinner,
    honor.worldCupWinner,
  ];
  const continentalTitles = championTrophies.filter(trophy => (
    trophy.seasonNumber === honor.seasonNumber
    && CONTINENTAL_TITLE_TYPES.has(trophy.type)
  )).length;
  return 1
    + domesticAndWorldWinners.filter(winnerId => winnerId === championId).length
    + continentalTitles;
}

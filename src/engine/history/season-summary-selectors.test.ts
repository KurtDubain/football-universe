import { describe, expect, it } from 'vitest';
import type { HonorRecord } from '../../types/honor';
import type { SeasonRecord, Trophy } from '../../types/team';
import type { MatchHistoryEntry } from '../season/season-manager';
import {
  countTopFlightChampionTitles,
  formatSeasonCompetitionStats,
  selectSeasonCompetitionStats,
} from './season-summary-selectors';

function honor(overrides: Partial<HonorRecord> = {}): HonorRecord {
  return {
    seasonNumber: 1,
    league1Champion: 'champion',
    league2Champion: 'l2',
    league3Champion: 'l3',
    leagueCupWinner: 'other-a',
    superCupWinner: 'other-b',
    promoted: [],
    relegated: [],
    coachChanges: [],
    ...overrides,
  };
}

function record(teamId: string, goals: number): [string, SeasonRecord[]] {
  return [teamId, [{
    seasonNumber: 1,
    leagueLevel: 1,
    leaguePosition: teamId === 'a' ? 1 : 2,
    leaguePlayed: 2,
    leagueWon: 1,
    leagueDrawn: 0,
    leagueLost: 1,
    leagueGF: goals,
    leagueGA: goals,
    leaguePoints: 3,
    coachId: `coach-${teamId}`,
    promoted: false,
    relegated: false,
  }]];
}

function match(
  comp: string,
  homeGoals: number,
  awayGoals: number,
  overrides: Partial<MatchHistoryEntry> = {},
): MatchHistoryEntry {
  return {
    season: 1,
    homeId: 'a',
    awayId: 'b',
    homeGoals,
    awayGoals,
    comp,
    ...overrides,
  };
}

describe('countTopFlightChampionTitles', () => {
  it('keeps a league-only champion at one title', () => {
    expect(countTopFlightChampionTitles(honor())).toBe(1);
  });

  it('counts a matching league-cup winner as a second title', () => {
    expect(countTopFlightChampionTitles(honor({ leagueCupWinner: 'champion' }))).toBe(2);
  });

  it('counts matching league-cup and super-cup winners as three titles', () => {
    expect(countTopFlightChampionTitles(honor({
      leagueCupWinner: 'champion',
      superCupWinner: 'champion',
    }))).toBe(3);
  });

  it('does not attribute trophies won by different clubs to the league champion', () => {
    expect(countTopFlightChampionTitles(honor({
      leagueCupWinner: 'cup-club',
      superCupWinner: 'super-club',
      worldCupWinner: 'world-club',
    }))).toBe(1);
  });

  it('counts the World Cup and archived continental trophies only for the champion', () => {
    const trophies: Trophy[] = [
      { type: 'mainland_cup', seasonNumber: 1 },
      { type: 'southern_cup', seasonNumber: 2 },
    ];
    expect(countTopFlightChampionTitles(honor({ worldCupWinner: 'champion' }), trophies)).toBe(3);
    expect(countTopFlightChampionTitles(honor({ worldCupWinner: 'another-team' }), trophies)).toBe(2);
  });
});

describe('selectSeasonCompetitionStats', () => {
  const teamSeasonRecords = Object.fromEntries([
    record('a', 3),
    record('b', 2),
  ]);

  it('uses one archived result per match across league and cups', () => {
    const stats = selectSeasonCompetitionStats({
      teamSeasonRecords,
      matchHistory: [
        match('顶级联赛', 2, 1),
        match('顶级联赛', 0, 2, { homeId: 'b', awayId: 'a' }),
        match('联赛杯', 1, 1, { pen: '5-4' }),
      ],
    }, 1);

    expect(stats.scope).toBe('all_competitions');
    expect(stats.primary).toEqual({ matches: 3, goals: 7, goalsPerMatch: 7 / 3 });
    expect(stats.league).toEqual({ matches: 2, goals: 5, goalsPerMatch: 2.5 });
    expect(formatSeasonCompetitionStats(stats)).toBe('全赛事 3场 · 7粒进球 · 场均2.33球');
  });

  it('does not include shootout goals stored separately from the score', () => {
    const stats = selectSeasonCompetitionStats({
      teamSeasonRecords,
      matchHistory: [
        match('顶级联赛', 2, 1),
        match('顶级联赛', 0, 2, { homeId: 'b', awayId: 'a' }),
        match('联赛杯', 0, 0, { pen: '12-11' }),
      ],
    }, 1);
    expect(stats.primary.goals).toBe(5);
  });

  it('falls back to explicitly labelled league totals for an incomplete old archive', () => {
    const stats = selectSeasonCompetitionStats({
      teamSeasonRecords,
      matchHistory: [match('顶级联赛', 2, 1)],
    }, 1);
    expect(stats).toMatchObject({
      scope: 'league_only',
      source: 'team_season_records',
      primary: { matches: 2, goals: 5 },
      allCompetitions: null,
    });
    expect(formatSeasonCompetitionStats(stats)).toBe('联赛统计 2场 · 5粒进球 · 场均2.50球');
  });

  it('falls back when old saves have no match history at all', () => {
    expect(selectSeasonCompetitionStats({ teamSeasonRecords }, 1)).toMatchObject({
      scope: 'league_only',
      primary: { matches: 2, goals: 5 },
    });
  });
});

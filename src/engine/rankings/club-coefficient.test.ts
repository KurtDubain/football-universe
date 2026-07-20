import { describe, expect, it } from 'vitest';
import type { SeasonRecord, TeamBase } from '../../types/team';
import { calculateClubCoefficient, rankClubCoefficients, scoreClubSeason } from './club-coefficient';

function record(seasonNumber: number, overrides: Partial<SeasonRecord> = {}): SeasonRecord {
  return {
    seasonNumber,
    leagueLevel: 1,
    leaguePosition: 8,
    leaguePlayed: 30,
    leagueWon: 10,
    leagueDrawn: 10,
    leagueLost: 10,
    leagueGF: 40,
    leagueGA: 40,
    leaguePoints: 40,
    coachId: 'coach',
    promoted: false,
    relegated: false,
    ...overrides,
  };
}

function team(id: string, reputation: number, overall = reputation): TeamBase {
  return {
    id, name: id, shortName: id, color: '#fff', tier: 'mid',
    overall, attack: overall, midfield: overall, defense: overall,
    stability: 70, depth: 70, reputation, initialLeagueLevel: 1, expectation: 3,
    region: '大陆+测试',
  };
}

describe('club coefficient', () => {
  it('rewards major international results above ordinary league finishes', () => {
    const ordinary = scoreClubSeason(record(1));
    const champion = scoreClubSeason(record(1, { continentalCupResult: '冠军' }));
    const worldChampion = scoreClubSeason(record(1, { worldCupResult: '冠军' }));
    expect(champion).toBeGreaterThan(ordinary);
    expect(worldChampion).toBeGreaterThan(champion);
  });

  it('uses only five seasons and weights recent results more heavily', () => {
    const recentTitle = calculateClubCoefficient([
      record(1), record(2), record(3), record(4), record(5), record(6, { worldCupResult: '冠军' }),
    ]);
    const oldTitle = calculateClubCoefficient([
      record(1, { worldCupResult: '冠军' }), record(2), record(3), record(4), record(5), record(6),
    ]);
    expect(recentTitle.seasons).toHaveLength(5);
    expect(recentTitle.points).toBeGreaterThan(oldTitle.points);
    expect(recentTitle.seasons.some(season => season.seasonNumber === 1)).toBe(false);
  });

  it('uses reputation and overall only as zero-history tie-breakers', () => {
    const teams = { a: team('a', 70), b: team('b', 90), c: team('c', 80) };
    const initial = rankClubCoefficients(teams, {});
    expect(initial.map(entry => entry.teamId)).toEqual(['b', 'c', 'a']);
    expect(initial.every(entry => entry.points === 0)).toBe(true);

    const historical = rankClubCoefficients(teams, {
      a: [record(1, { leaguePosition: 1, continentalCupResult: '冠军' })],
    });
    expect(historical[0].teamId).toBe('a');
  });
});

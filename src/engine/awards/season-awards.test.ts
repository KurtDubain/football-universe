import { describe, it, expect } from 'vitest';
import { computeSeasonAwards } from './season-awards';
import { Player, PlayerSeasonStats, PlayerPosition } from '../../types/player';
import { TeamBase } from '../../types/team';
import { StandingEntry } from '../../types/league';

function makeTeam(id: string, overall: number): TeamBase {
  return {
    id,
    name: id,
    shortName: id.slice(0, 3),
    color: '#000000',
    tier: 'mid',
    overall,
    attack: overall,
    midfield: overall,
    defense: overall,
    stability: overall,
    depth: overall,
    reputation: overall,
    initialLeagueLevel: 1,
    expectation: 3,
    region: '大陆+测试',
  };
}

/**
 * In tests we still derive the uuid from `${teamId}-${number}` so each
 * fixture line stays as a single source of truth. Real saves use
 * `p-<counter>` from the generator, but the function under test only cares
 * about uuid uniqueness, not its shape.
 */
function makePlayer(
  teamId: string,
  number: number,
  position: PlayerPosition,
  rating = 80,
): Player {
  return {
    uuid: `${teamId}-${number}`,
    teamId,
    name: `${teamId}-${number}`,
    number,
    position,
    rating,
    // Test fixtures: peakRating == rating, peakAge == 27 (median). These
    // satisfy the v10 contract without forcing every test to think about
    // the development curve.
    peakRating: rating,
    peakAge: 27,
    goalScoring: 50,
    marketValue: 10,
    age: 26,
  };
}

function makeStat(
  uuid: string,
  teamId: string,
  goals: number,
  assists = 0,
  apps = 30,
): PlayerSeasonStats {
  return {
    playerId: uuid,
    teamId,
    goals,
    assists,
    yellowCards: 0,
    redCards: 0,
    appearances: apps,
  };
}

function makeStanding(teamId: string, played = 30, ga = 30): StandingEntry {
  return {
    teamId,
    played,
    won: 15,
    drawn: 5,
    lost: 10,
    goalsFor: 40,
    goalsAgainst: ga,
    goalDifference: 40 - ga,
    points: 50,
    form: [],
  };
}

describe('computeSeasonAwards', () => {
  it('returns up to 4 awards (mvp / golden_boot / best_defender / young_player)', () => {
    const teamA = makeTeam('teamA', 85); // top team
    const teamB = makeTeam('teamB', 80);
    const youngTeam = makeTeam('youngTeam', 65); // overall < 70 → young player eligible

    const squads: Record<string, Player[]> = {
      teamA: [makePlayer('teamA', 9, 'FW'), makePlayer('teamA', 4, 'DF', 85)],
      teamB: [makePlayer('teamB', 9, 'FW'), makePlayer('teamB', 4, 'DF', 78)],
      youngTeam: [makePlayer('youngTeam', 9, 'FW')],
    };
    const stats: Record<string, PlayerSeasonStats> = {
      'teamA-9': makeStat('teamA-9', 'teamA', 25, 12),
      'teamA-4': makeStat('teamA-4', 'teamA', 2, 0, 30), // best defender candidate
      'teamB-9': makeStat('teamB-9', 'teamB', 14, 8),
      'teamB-4': makeStat('teamB-4', 'teamB', 1, 0, 30),
      'youngTeam-9': makeStat('youngTeam-9', 'youngTeam', 8, 1),
    };
    const standings = [
      makeStanding('teamA', 30, 18), // best defence
      makeStanding('teamB', 30, 25),
      makeStanding('youngTeam', 30, 50),
    ];

    const awards = computeSeasonAwards(2, stats, squads, { teamA, teamB, youngTeam }, standings);
    const types = awards.map((a) => a.type);

    expect(types).toContain('mvp');
    expect(types).toContain('golden_boot');
    expect(types).toContain('best_defender');
    expect(types).toContain('young_player');
    expect(awards.length).toBeLessThanOrEqual(4);
  });

  it('Golden Boot is the player with the most goals', () => {
    const teamA = makeTeam('teamA', 85);
    const squads = { teamA: [makePlayer('teamA', 9, 'FW'), makePlayer('teamA', 10, 'FW')] };
    const stats = {
      'teamA-9': makeStat('teamA-9', 'teamA', 30, 5),
      'teamA-10': makeStat('teamA-10', 'teamA', 28, 6),
    };
    const standings = [makeStanding('teamA', 30, 20)];
    const awards = computeSeasonAwards(1, stats, squads, { teamA }, standings);
    const gb = awards.find((a) => a.type === 'golden_boot');
    expect(gb?.playerId).toBe('teamA-9');
    expect(gb?.statValue).toBe(30);
  });

  it('MVP weighting (goals×3 + assists×2 + rank bonus) picks the right player', () => {
    const teamA = makeTeam('teamA', 85);
    const squads = { teamA: [makePlayer('teamA', 9, 'FW'), makePlayer('teamA', 10, 'MF')] };
    // Player A: 20*3 + 5*2 = 70 (+ rank bonus)
    // Player B: 10*3 + 30*2 = 90 (+ rank bonus)
    const stats = {
      'teamA-9': makeStat('teamA-9', 'teamA', 20, 5),
      'teamA-10': makeStat('teamA-10', 'teamA', 10, 30),
    };
    const standings = [makeStanding('teamA', 30, 20)];
    const awards = computeSeasonAwards(1, stats, squads, { teamA }, standings);
    const mvp = awards.find((a) => a.type === 'mvp');
    expect(mvp?.playerId).toBe('teamA-10');
  });

  it('Best defender is from the team with the fewest goals against', () => {
    const teamA = makeTeam('teamA', 80);
    const teamB = makeTeam('teamB', 80);
    const squads = {
      teamA: [makePlayer('teamA', 4, 'DF', 80)],
      teamB: [makePlayer('teamB', 4, 'DF', 85)], // higher rating, but worse defence team
    };
    const stats = {
      'teamA-4': makeStat('teamA-4', 'teamA', 0, 0, 30),
      'teamB-4': makeStat('teamB-4', 'teamB', 0, 0, 30),
    };
    const standings = [
      makeStanding('teamA', 30, 10), // fewer GA → best defender comes from here
      makeStanding('teamB', 30, 40),
    ];
    const awards = computeSeasonAwards(1, stats, squads, { teamA, teamB }, standings);
    const bd = awards.find((a) => a.type === 'best_defender');
    expect(bd?.teamId).toBe('teamA');
    expect(bd?.statValue).toBe(10);
  });

  it('Young Player only fires for a team with overall < 70 AND a player with 5+ goals', () => {
    const youngTeam = makeTeam('young', 65);
    const elite = makeTeam('elite', 88);
    const squads = {
      young: [makePlayer('young', 9, 'FW')],
      elite: [makePlayer('elite', 9, 'FW')],
    };
    // Young player has only 4 goals (< 5) → no young_player award
    const lowGoalStats = {
      'young-9': makeStat('young-9', 'young', 4, 0),
      'elite-9': makeStat('elite-9', 'elite', 25, 5),
    };
    const standings = [makeStanding('elite', 30, 20)];

    const lowAwards = computeSeasonAwards(1, lowGoalStats, squads, { young: youngTeam, elite }, standings);
    expect(lowAwards.find((a) => a.type === 'young_player')).toBeUndefined();

    // With 6 goals it should fire
    const okStats = {
      ...lowGoalStats,
      'young-9': makeStat('young-9', 'young', 6, 0),
    };
    const okAwards = computeSeasonAwards(1, okStats, squads, { young: youngTeam, elite }, standings);
    expect(okAwards.find((a) => a.type === 'young_player')?.teamId).toBe('young');

    // If young team's overall >= 70, no young_player award even with 10 goals
    const notYoung = makeTeam('young', 70);
    const noAwards = computeSeasonAwards(
      1,
      { ...okStats, 'young-9': makeStat('young-9', 'young', 10) },
      squads,
      { young: notYoung, elite },
      standings,
    );
    expect(noAwards.find((a) => a.type === 'young_player')).toBeUndefined();
  });

  it('returns an empty list when there is no playerStats data', () => {
    expect(computeSeasonAwards(1, {}, {}, {}, [])).toEqual([]);
  });
});

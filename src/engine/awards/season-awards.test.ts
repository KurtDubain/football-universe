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
  age = 26,
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
    age,
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
    cleanSheets: 0,
    saves: 0,
    keyBlocks: 0,
    bigChances: goals,
    keyPasses: assists,
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
  it('returns the supported awards when eligible players exist', () => {
    const teamA = makeTeam('teamA', 85); // top team
    const teamB = makeTeam('teamB', 80);
    const youngTeam = makeTeam('youngTeam', 65); // overall < 70 → young player eligible

    const squads: Record<string, Player[]> = {
      teamA: [makePlayer('teamA', 9, 'FW'), makePlayer('teamA', 4, 'DF', 85)],
      teamB: [makePlayer('teamB', 9, 'FW'), makePlayer('teamB', 4, 'DF', 78)],
      youngTeam: [makePlayer('youngTeam', 9, 'FW', 80, 21)],
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
    expect(awards.length).toBeLessThanOrEqual(5);
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

  it('MVP uses the cross-position season score instead of an attacker-only total', () => {
    const teamA = makeTeam('teamA', 85);
    const squads = { teamA: [makePlayer('teamA', 9, 'FW'), makePlayer('teamA', 10, 'MF')] };
    const stats = {
      'teamA-9': makeStat('teamA-9', 'teamA', 20, 5),
      'teamA-10': { ...makeStat('teamA-10', 'teamA', 10, 30), keyPasses: 45, bigChances: 15 },
    };
    const standings = [makeStanding('teamA', 30, 20)];
    const awards = computeSeasonAwards(1, stats, squads, { teamA }, standings);
    const mvp = awards.find((a) => a.type === 'mvp');
    expect(mvp?.playerId).toBe('teamA-10');
  });

  it('Best defender follows individual defensive performance instead of team goals against', () => {
    const teamA = makeTeam('teamA', 80);
    const teamB = makeTeam('teamB', 80);
    const squads = {
      teamA: [makePlayer('teamA', 4, 'DF', 80)],
      teamB: [makePlayer('teamB', 4, 'DF', 85)], // higher rating, but worse defence team
    };
    const stats = {
      'teamA-4': { ...makeStat('teamA-4', 'teamA', 0, 0, 30), minutesPlayed: 2700, interceptions: 50, clearances: 70, goalsConcededWhileOnPitch: 10, cleanSheetMinutes: 900 },
      'teamB-4': { ...makeStat('teamB-4', 'teamB', 0, 0, 30), minutesPlayed: 2700, interceptions: 110, clearances: 150, keyBlocks: 4, goalsConcededWhileOnPitch: 22, cleanSheetMinutes: 720 },
    };
    const standings = [
      makeStanding('teamA', 30, 10),
      makeStanding('teamB', 30, 40),
    ];
    const awards = computeSeasonAwards(1, stats, squads, { teamA, teamB }, standings);
    const bd = awards.find((a) => a.type === 'best_defender');
    expect(bd?.teamId).toBe('teamB');
    expect(bd?.statLabel).toContain('赛季综合评分');
  });

  it('Young Player uses true under-23 eligibility rather than team strength or a goal threshold', () => {
    const youngTeam = makeTeam('young', 65);
    const elite = makeTeam('elite', 88);
    const squads = {
      young: [makePlayer('young', 9, 'FW', 80, 22)],
      elite: [makePlayer('elite', 9, 'FW')],
    };
    const lowGoalStats = {
      'young-9': makeStat('young-9', 'young', 4, 0),
      'elite-9': makeStat('elite-9', 'elite', 25, 5),
    };
    const standings = [makeStanding('elite', 30, 20)];

    const lowAwards = computeSeasonAwards(1, lowGoalStats, squads, { young: youngTeam, elite }, standings);
    expect(lowAwards.find((a) => a.type === 'young_player')?.playerId).toBe('young-9');
    expect(lowAwards.find((a) => a.type === 'young_player')?.statLabel).toContain('22岁');

    // Team strength is irrelevant, but turning 23 closes eligibility.
    squads.young[0] = { ...squads.young[0], age: 23 };
    const noAwards = computeSeasonAwards(
      1,
      { ...lowGoalStats, 'young-9': makeStat('young-9', 'young', 10) },
      squads,
      { young: makeTeam('young', 92), elite },
      standings,
    );
    expect(noAwards.find((a) => a.type === 'young_player')).toBeUndefined();
  });

  it('returns an empty list when there is no playerStats data', () => {
    expect(computeSeasonAwards(1, {}, {}, {}, [])).toEqual([]);
  });
});

describe('computeSeasonAwards — tie-breaking and mid-season transfers', () => {
  it('breaks an MVP score tie by minutes played, not by input order', () => {
    const teamA = makeTeam('teamA', 85);
    const squads = {
      teamA: [makePlayer('teamA', 9, 'FW'), makePlayer('teamA', 10, 'FW')],
    };
    // Identical output, different minutes. Both clear the appearance gate.
    const stats = {
      'teamA-9': { ...makeStat('teamA-9', 'teamA', 20, 5), minutesPlayed: 1800 },
      'teamA-10': { ...makeStat('teamA-10', 'teamA', 20, 5), minutesPlayed: 2700 },
    };
    const standings = [makeStanding('teamA', 30, 20)];

    const forward = computeSeasonAwards(1, stats, squads, { teamA }, standings);
    const reversed = computeSeasonAwards(
      1,
      { 'teamA-10': stats['teamA-10'], 'teamA-9': stats['teamA-9'] },
      squads,
      { teamA },
      standings,
    );

    expect(forward.find(a => a.type === 'mvp')?.playerId).toBe('teamA-10');
    // Key order must not change the winner.
    expect(reversed.find(a => a.type === 'mvp')?.playerId).toBe('teamA-10');
  });

  it('is deterministic when score and minutes are both equal', () => {
    const teamA = makeTeam('teamA', 85);
    const squads = {
      teamA: [makePlayer('teamA', 9, 'FW'), makePlayer('teamA', 10, 'FW')],
    };
    const stats = {
      'teamA-9': { ...makeStat('teamA-9', 'teamA', 20, 5), minutesPlayed: 2700 },
      'teamA-10': { ...makeStat('teamA-10', 'teamA', 20, 5), minutesPlayed: 2700 },
    };
    const standings = [makeStanding('teamA', 30, 20)];

    const first = computeSeasonAwards(1, stats, squads, { teamA }, standings);
    const second = computeSeasonAwards(
      1,
      { 'teamA-10': stats['teamA-10'], 'teamA-9': stats['teamA-9'] },
      squads,
      { teamA },
      standings,
    );

    // Stable uuid order decides: 'teamA-10' sorts before 'teamA-9'.
    const firstMvp = first.find(a => a.type === 'mvp')?.playerId;
    const secondMvp = second.find(a => a.type === 'mvp')?.playerId;
    expect(firstMvp).toBe(secondMvp);
    expect(firstMvp).toBe('teamA-10');
  });

  it('judges a transferred defender by the team their stats belong to', () => {
    const topTeam = makeTeam('topTeam', 85);
    const lowerTeam = makeTeam('lowerTeam', 70);

    // The mover now sits in the lower-tier squad, but their season stats were
    // recorded for the top-flight club. Only topTeam is in league1Standings.
    const mover = { ...makePlayer('mover', 4, 'DF', 85), teamId: 'lowerTeam' };
    const squads = {
      lowerTeam: [mover],
      topTeam: [makePlayer('topTeam', 4, 'DF', 70)],
    };

    const stats = {
      'mover-4': {
        ...makeStat('mover-4', 'topTeam', 0, 0, 30),
        minutesPlayed: 2700,
        interceptions: 120,
        clearances: 160,
        keyBlocks: 5,
        goalsConcededWhileOnPitch: 12,
        cleanSheetMinutes: 900,
      },
      'topTeam-4': {
        ...makeStat('topTeam-4', 'topTeam', 0, 0, 30),
        minutesPlayed: 2700,
        interceptions: 40,
        clearances: 60,
        goalsConcededWhileOnPitch: 30,
        cleanSheetMinutes: 300,
      },
    };
    const standings = [makeStanding('topTeam', 30, 20)];

    const awards = computeSeasonAwards(1, stats, squads, { topTeam, lowerTeam }, standings);
    const bd = awards.find(a => a.type === 'best_defender');

    // Eligible because stat.teamId is the top-flight club, and credited there.
    expect(bd?.playerId).toBe('mover-4');
    expect(bd?.teamId).toBe('topTeam');
  });

  it('excludes a defender whose stats belong to a club outside the top flight', () => {
    const topTeam = makeTeam('topTeam', 85);
    const lowerTeam = makeTeam('lowerTeam', 70);

    const squads = {
      topTeam: [makePlayer('topTeam', 4, 'DF', 70)],
      lowerTeam: [makePlayer('lowerTeam', 4, 'DF', 90)],
    };
    const stats = {
      'topTeam-4': {
        ...makeStat('topTeam-4', 'topTeam', 0, 0, 30),
        minutesPlayed: 2700,
        interceptions: 40,
        clearances: 60,
        goalsConcededWhileOnPitch: 30,
        cleanSheetMinutes: 300,
      },
      // Better numbers, but the season was played in the lower tier.
      'lowerTeam-4': {
        ...makeStat('lowerTeam-4', 'lowerTeam', 0, 0, 14),
        minutesPlayed: 1260,
        interceptions: 90,
        clearances: 130,
        keyBlocks: 4,
        goalsConcededWhileOnPitch: 8,
        cleanSheetMinutes: 700,
      },
    };
    const standings = [makeStanding('topTeam', 30, 20)];

    const awards = computeSeasonAwards(1, stats, squads, { topTeam, lowerTeam }, standings);
    const bd = awards.find(a => a.type === 'best_defender');
    expect(bd?.playerId).toBe('topTeam-4');
  });

  it('resolves a player whose squad entry moved by uuid, not by stated team', () => {
    const teamA = makeTeam('teamA', 85);
    // The stat row claims teamB, but the player lives in teamA's squad.
    const squads = { teamA: [makePlayer('teamA', 9, 'FW')] };
    const stats = {
      'teamA-9': makeStat('teamA-9', 'teamB', 25, 10),
    };
    const teamB = makeTeam('teamB', 80);
    const standings = [makeStanding('teamA', 30, 20), makeStanding('teamB', 30, 25)];

    const awards = computeSeasonAwards(1, stats, squads, { teamA, teamB }, standings);
    const gb = awards.find(a => a.type === 'golden_boot');
    // Award is credited to the stats' team, and the player is still found.
    expect(gb?.playerId).toBe('teamA-9');
    expect(gb?.teamId).toBe('teamB');
    expect(gb?.playerName).toBe('teamA-9');
  });
});


import { describe, it, expect } from 'vitest';
import { computeSeasonAwards } from './season-awards';
import { Player, PlayerSeasonStats, PlayerPosition } from '../../types/player';
import { TeamBase } from '../../types/team';
import { StandingEntry } from '../../types/league';
import type { WorldCupState } from '../../types/cup';
import type { PlayerAward } from '../../types/award';

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
    // Seven award types exist; this fixture has no MF or GK, so fewer are issued.
    expect(awards.length).toBeLessThanOrEqual(7);
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
    expect(bd?.statLabel).toContain('位置表现');
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

describe('computeSeasonAwards — Ballon d\'Or weighting', () => {
  /**
   * Two clubs of identical strength whose players post identical numbers, so
   * the only thing that can separate them is the Ballon d'Or weighting.
   */
  function evenFixture() {
    const teamA = makeTeam('teamA', 82);
    const teamB = makeTeam('teamB', 82);
    const squads = {
      teamA: [makePlayer('teamA', 9, 'FW')],
      teamB: [makePlayer('teamB', 9, 'FW')],
    };
    const stats = {
      'teamA-9': { ...makeStat('teamA-9', 'teamA', 20, 8), minutesPlayed: 2700 },
      'teamB-9': { ...makeStat('teamB-9', 'teamB', 20, 8), minutesPlayed: 2700 },
    };
    return { teamA, teamB, squads, stats };
  }

  const mvpOf = (awards: PlayerAward[]) => awards.find(a => a.type === 'mvp');

  it('follows the title when two seasons are otherwise identical', () => {
    const { teamA, teamB, squads, stats } = evenFixture();

    // makeStanding fixes points and goalsFor, so goal difference ranks the table.
    const aOnTop = computeSeasonAwards(1, stats, squads, { teamA, teamB }, [
      makeStanding('teamA', 30, 15),
      makeStanding('teamB', 30, 30),
    ]);
    const bOnTop = computeSeasonAwards(1, stats, squads, { teamA, teamB }, [
      makeStanding('teamB', 30, 15),
      makeStanding('teamA', 30, 30),
    ]);

    expect(mvpOf(aOnTop)?.playerId).toBe('teamA-9');
    expect(mvpOf(bOnTop)?.playerId).toBe('teamB-9');
  });

  it('never leaks the weighting into the reported score', () => {
    const { teamA, teamB, squads, stats } = evenFixture();
    const aOnTop = mvpOf(computeSeasonAwards(1, stats, squads, { teamA, teamB }, [
      makeStanding('teamA', 30, 15),
      makeStanding('teamB', 30, 30),
    ]));
    const bOnTop = mvpOf(computeSeasonAwards(1, stats, squads, { teamA, teamB }, [
      makeStanding('teamB', 30, 15),
      makeStanding('teamA', 30, 30),
    ]));

    // Different winners from identical seasons: the champion multiplier decided
    // the ranking, yet both report the same untouched season score, which is
    // what the player page, career board and news line read.
    expect(aOnTop?.playerId).not.toBe(bOnTop?.playerId);
    expect(aOnTop?.statValue).toBe(bOnTop?.statValue);
    expect(aOnTop?.statLabel).toContain('赛季综合评分');
  });

  it('lets a continental cup carry a runner-up past the champion', () => {
    const { teamA, teamB, squads, stats } = evenFixture();
    const standings = [makeStanding('teamA', 30, 15), makeStanding('teamB', 30, 30)];

    const withoutCup = computeSeasonAwards(1, stats, squads, { teamA, teamB }, standings);
    expect(mvpOf(withoutCup)?.playerId).toBe('teamA-9');

    // Runner-up 1.08 x continental 1.10 = 1.188, just past the champion's 1.18.
    const withCup = computeSeasonAwards(
      1, stats, squads, { teamA, teamB }, standings, {}, {},
      { continentalCupWinners: ['teamB'] },
    );
    expect(mvpOf(withCup)?.playerId).toBe('teamB-9');
  });

  it('credits a completed world cup but not an unfinished one', () => {
    const { teamA, teamB, squads, stats } = evenFixture();
    const standings = [makeStanding('teamA', 30, 15), makeStanding('teamB', 30, 30)];
    const base = {
      groups: [], knockoutRounds: [], groupStageCompleted: true,
      participantIds: ['teamA', 'teamB'],
    };
    const award = (worldCup: WorldCupState) => mvpOf(computeSeasonAwards(
      1, stats, squads, { teamA, teamB }, standings, {}, {}, {}, worldCup,
    ))?.playerId;

    // Runner-up 1.08 x world cup 1.15 = 1.242, past the champion's 1.18.
    const completed = { ...base, completed: true, winnerId: 'teamB' } as unknown as WorldCupState;
    expect(award(completed)).toBe('teamB-9');

    // An in-flight tournament must not hand out the multiplier, otherwise a
    // stale previous edition would decide this season's award.
    const inFlight = { ...base, completed: false, winnerId: 'teamB' } as unknown as WorldCupState;
    expect(award(inFlight)).toBe('teamA-9');
  });

  it('discounts a lower-tier season even when the raw numbers match', () => {
    const { teamA, teamB, squads, stats } = evenFixture();
    const standings = [makeStanding('teamA', 30, 15), makeStanding('teamB', 30, 30)];

    // teamB's season was played in the second tier.
    const awards = computeSeasonAwards(
      1, stats, squads, { teamA, teamB }, standings, {}, { teamB: 2 },
    );
    expect(mvpOf(awards)?.playerId).toBe('teamA-9');
  });
});


describe('computeSeasonAwards — redesigned award set', () => {
  /**
   * A 16-team table with explicit placements, matching the top flight in
   * `config/competitions.ts`. Positions 1-4 are the top four and 13-16 the
   * bottom four, so 5-12 is the only genuinely neutral band.
   */
  function tableWith(placements: Record<string, number>, size = 16): StandingEntry[] {
    const slots = Array.from({ length: size }, (_, index) => `filler-${index}`);
    for (const [teamId, position] of Object.entries(placements)) {
      slots[position - 1] = teamId;
    }
    return slots.map((teamId, index) => ({
      ...makeStanding(teamId, 30, 20 + index),
      points: 80 - index * 3,
    }));
  }

  function solidDefenderStat(teamId: string, over: Partial<PlayerSeasonStats> = {}): PlayerSeasonStats {
    return {
      ...makeStat(`${teamId}-4`, teamId, 0, 0, 30),
      minutesPlayed: 2700,
      interceptions: 60,
      clearances: 80,
      goalsConcededWhileOnPitch: 12,
      cleanSheetMinutes: 900,
      ...over,
    };
  }

  it('produces all seven awards when every position is represented', () => {
    const solo = makeTeam('solo', 85);
    const squads = {
      solo: [
        makePlayer('solo', 9, 'FW', 88, 26),
        makePlayer('solo', 10, 'MF', 86, 26),
        makePlayer('solo', 4, 'DF', 85, 26),
        makePlayer('solo', 1, 'GK', 84, 26),
        makePlayer('solo', 11, 'FW', 80, 20),
      ],
    };
    const stats: Record<string, PlayerSeasonStats> = {
      'solo-9': makeStat('solo-9', 'solo', 24, 8),
      'solo-10': { ...makeStat('solo-10', 'solo', 8, 14), keyPasses: 40, bigChances: 20 },
      'solo-4': solidDefenderStat('solo'),
      'solo-1': {
        ...makeStat('solo-1', 'solo', 0, 0, 30),
        minutesPlayed: 2700, routineSaves: 80, saves: 12,
        shotsOnTargetFaced: 110, goalsConcededWhileOnPitch: 18, cleanSheetMinutes: 900,
      },
      'solo-11': makeStat('solo-11', 'solo', 12, 4),
    };

    const awards = computeSeasonAwards(
      1, stats, squads, { solo }, [makeStanding('solo', 30, 20)],
    );
    const types = awards.map(award => award.type);

    for (const type of [
      'mvp', 'golden_boot', 'best_forward', 'best_midfielder',
      'best_defender', 'best_goalkeeper', 'young_player',
    ] as const) {
      expect(types).toContain(type);
    }
    // One winner per award: no duplicates, no silent double-issue.
    expect(new Set(types).size).toBe(types.length);
    expect(awards).toHaveLength(7);
  });

  it('ranks the Golden Boot on all-competitions goals, with no schedule adjustment', () => {
    const top = makeTeam('top', 85);
    const second = makeTeam('second', 70);
    const squads = {
      top: [makePlayer('top', 9, 'FW')],
      second: [makePlayer('second', 9, 'FW')],
    };
    const standings = [makeStanding('top', 30, 20)];

    // Tier 2's 14 rounds do NOT inflate 24 goals here — schedule normalisation
    // belongs to the league top scorer, whose numerator and denominator both
    // describe league matches. 24 x 0.75 = 18 falls short of 20.
    const topTierWins = computeSeasonAwards(1, {
      'top-9': makeStat('top-9', 'top', 20, 0),
      'second-9': makeStat('second-9', 'second', 24, 0),
    }, squads, { top, second }, standings, {}, { second: 2 });
    const topWinner = topTierWins.find(award => award.type === 'golden_boot');
    expect(topWinner?.playerId).toBe('top-9');
    // The label always says 全赛事, because the total spans every competition.
    expect(topWinner?.statLabel).toBe('全赛事 20球');

    // A lower-tier total has to be genuinely larger to overcome the
    // coefficient: 30 x 0.75 = 22.5 beats 20.
    const lowerTierWins = computeSeasonAwards(1, {
      'top-9': makeStat('top-9', 'top', 20, 0),
      'second-9': makeStat('second-9', 'second', 30, 0),
    }, squads, { top, second }, standings, {}, { second: 2 });
    const weighted = lowerTierWins.find(award => award.type === 'golden_boot');
    expect(weighted?.playerId).toBe('second-9');
    expect(weighted?.statLabel).toContain('全赛事 30球');
    expect(weighted?.statLabel).toContain('0.75');
    // The reported value is the weighted score, not the raw goal count.
    expect(weighted?.statValue).toBeCloseTo(22.5, 6);
  });

  it('breaks a Golden Boot tie on assists, not on object-key order', () => {
    const solo = makeTeam('solo', 85);
    const squads = {
      solo: [makePlayer('solo', 10, 'FW'), makePlayer('solo', 11, 'FW')],
    };
    // Key order and uuid order both favour solo-10; assists favour solo-11.
    // The pre-redesign scan took the first row to reach the maximum, which
    // disagreed with the season-review top-scorer card.
    const stats = {
      'solo-10': makeStat('solo-10', 'solo', 20, 3),
      'solo-11': makeStat('solo-11', 'solo', 20, 11),
    };
    const awards = computeSeasonAwards(
      1, stats, squads, { solo }, [makeStanding('solo', 30, 20)],
    );
    expect(awards.find(award => award.type === 'golden_boot')?.playerId).toBe('solo-11');
  });

  it('credits a domestic cup, which previously contributed nothing', () => {
    const teamA = makeTeam('a', 80);
    const teamB = makeTeam('b', 80);
    const squads = {
      a: [makePlayer('a', 9, 'FW')],
      b: [makePlayer('b', 9, 'FW')],
    };
    const stats = {
      'a-9': makeStat('a-9', 'a', 18, 6),
      'b-9': makeStat('b-9', 'b', 18, 6),
    };
    // Both mid-table, so the team factor is neutral and only cups can separate them.
    const standings = tableWith({ a: 8, b: 9 });
    const mvpOf = (awards: PlayerAward[]) => awards.find(award => award.type === 'mvp');

    const plain = computeSeasonAwards(1, stats, squads, { a: teamA, b: teamB }, standings);
    // Identical seasons: the uuid tiebreak decides.
    expect(mvpOf(plain)?.playerId).toBe('a-9');

    const withLeagueCup = computeSeasonAwards(
      1, stats, squads, { a: teamA, b: teamB }, standings, {}, {},
      { domesticCupWinners: ['b'] },
    );
    expect(mvpOf(withLeagueCup)?.playerId).toBe('b-9');
  });

  it('gives a title-winning defender an edge without letting the team decide', () => {
    const champ = makeTeam('champ', 85);
    const mid = makeTeam('mid', 85);
    const squads = {
      champ: [makePlayer('champ', 4, 'DF', 85)],
      mid: [makePlayer('mid', 4, 'DF', 85)],
    };
    const standings = tableWith({ champ: 1, mid: 8 });
    const bestDefender = (stats: Record<string, PlayerSeasonStats>) => computeSeasonAwards(
      1, stats, squads, { champ, mid }, standings,
    ).find(award => award.type === 'best_defender')?.teamId;

    // Identical output: the light champion factor breaks the tie.
    expect(bestDefender({
      'champ-4': solidDefenderStat('champ'),
      'mid-4': solidDefenderStat('mid'),
    })).toBe('champ');

    // Clearly better individual defending still wins from mid-table.
    expect(bestDefender({
      'champ-4': solidDefenderStat('champ'),
      'mid-4': solidDefenderStat('mid', {
        interceptions: 120, clearances: 170, keyBlocks: 6, cleanSheetMinutes: 1200,
      }),
    })).toBe('mid');
  });

  it('restricts every position award to the top flight', () => {
    const top = makeTeam('top', 85);
    const lower = makeTeam('lower', 85);
    const squads = {
      top: [makePlayer('top', 4, 'DF', 85)],
      lower: [makePlayer('lower', 4, 'DF', 85)],
    };
    // Only `top` appears in the standings, so `lower` is not a top-flight team.
    const awards = computeSeasonAwards(1, {
      'top-4': solidDefenderStat('top'),
      'lower-4': solidDefenderStat('lower', { interceptions: 120, clearances: 170 }),
    }, squads, { top, lower }, [makeStanding('top', 30, 20)], {}, { lower: 2 });

    const defender = awards.find(award => award.type === 'best_defender');
    expect(defender?.teamId).toBe('top');
  });
});


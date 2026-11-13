import { describe, expect, it } from 'vitest';
import { initializeGameWorld, type GameWorld } from '../season/season-manager';
import {
  getCareerPlayerStatRows,
  getCareerTopAssistRows,
  getCareerTopScorerRows,
  getCurrentPlayerClubStatRows,
  getCurrentDisciplineRows,
  getCurrentOverallRows,
  getCurrentCreatorRows,
  getCurrentDefenderRows,
  getCurrentForwardRows,
  getCurrentGoalkeeperRows,
  getCurrentPlayerStatRows,
  getCurrentTopAssistRows,
  getCurrentTopScorerRows,
  getPlayerClubStatRow,
  getPlayerClubStatRowMap,
  getPlayerRowPerformance,
  getSeasonOverallRows,
  getSeasonTopScorerRows,
  meetsTableMinutes,
  minimumTableMinutes,
  type PlayerStatRow,
} from './player-stat-selectors';
import { computePlayerPerformance } from './player-performance';
import { executeSearch } from '../search/query-engine';
import { playerTeamStatKey } from './stats';
import type {
  PlayerPosition,
  PlayerSeasonStats,
  PlayerSeasonStatsHistoryEntry,
} from '../../types/player';

/**
 * Patches player-wide totals AND the matching `(playerId, teamId)` segment:
 * `getPlayerRowPerformance` reads segments whenever they exist, so a totals-only
 * patch would leave the ranked quality computed from empty segments.
 */
function withStats(
  world: GameWorld,
  patches: Record<string, Partial<PlayerSeasonStats>>,
): GameWorld {
  const playerStats = { ...world.playerStats };
  const playerStatSegments = { ...world.playerStatSegments };
  for (const [playerId, patch] of Object.entries(patches)) {
    const next = { ...world.playerStats[playerId], ...patch };
    playerStats[playerId] = next;
    const key = playerTeamStatKey(playerId, next.teamId);
    const segment = playerStatSegments[key];
    if (segment) playerStatSegments[key] = { ...segment, ...patch };
  }
  return { ...world, playerStats, playerStatSegments };
}

describe('player stat selectors', () => {
  it('resolves current player rows with active identity and shared search stats', () => {
    const world = initializeGameWorld(2024);
    const [teamId, squad] = Object.entries(world.squads)[0];
    const player = squad.find((p) => p.position === 'FW') ?? squad[0];
    const patchedWorld = {
      ...world,
      playerStats: {
        ...world.playerStats,
        [player.uuid]: {
          ...world.playerStats[player.uuid],
          goals: 12,
          assists: 4,
          appearances: 18,
          minutesPlayed: 1500,
          teamMatchesAllCompetitions: 18,
          bigChances: 12,
          keyPasses: 4,
        },
      },
    };

    const row = getCurrentPlayerStatRows(patchedWorld).find((r) => r.playerId === player.uuid);
    expect(row?.identity.source).toBe('active');
    expect(row?.identity.playerName).toBe(player.name);
    expect(row?.identity.teamId).toBe(teamId);
    expect(row?.goals).toBe(12);

    const topScorer = getCurrentTopScorerRows(patchedWorld, 1)[0];
    expect(topScorer.playerId).toBe(player.uuid);
    expect(topScorer.identity.playerName).toBe(player.name);

    const searchRows = executeSearch(patchedWorld, {
      entity: 'player',
      player: { minGoals: 10 },
    });
    expect(searchRows).toContainEqual(expect.objectContaining({
      playerId: player.uuid,
      playerName: player.name,
      teamId,
      goals: 12,
      assists: 4,
    }));
  });

  it('uses frozen history rows for a completed season instead of current playerStats', () => {
    const world = initializeGameWorld(2024);
    const [teamId, squad] = Object.entries(world.squads)[0];
    const player = squad[0];
    const history: PlayerSeasonStatsHistoryEntry = {
      season: 1,
      teamId,
      teamName: '冻结球队',
      teamShortName: '冻',
      playerName: '冻结射手',
      playerNumber: 99,
      position: player.position,
      rating: 91,
      age: 27,
      goals: 18,
      assists: 6,
      appearances: 22,
      yellowCards: 1,
      redCards: 0,
      teamGoalsConceded: 20,
      teamMatches: 30,
      cleanSheets: 4,
      saves: 0,
      keyBlocks: 2,
      bigChances: 24,
      keyPasses: 8,
      seasonScore: 77.4,
      positionQuality: 81.2,
      availabilityScore: 74,
      leagueStrength: 100,
      scoreConfidence: 0.71,
      scoreVersion: 1,
    };
    const patchedWorld = {
      ...world,
      seasonState: { ...world.seasonState, seasonNumber: 2 },
      playerStats: {
        ...world.playerStats,
        [player.uuid]: {
          ...world.playerStats[player.uuid],
          goals: 0,
          assists: 0,
          appearances: 0,
          bigChances: 0,
          keyPasses: 0,
        },
      },
      playerStatsHistory: {
        [player.uuid]: [history],
      },
    };

    const top = getSeasonTopScorerRows(patchedWorld, 1, 1)[0];
    expect(top.playerId).toBe(player.uuid);
    expect(top.goals).toBe(18);
    expect(top.identity.playerName).toBe('冻结射手');
    expect(top.identity.playerNumber).toBe(99);
    expect(top.identity.teamName).toBe('冻结球队');
    const overall = getSeasonOverallRows(patchedWorld, 1, 1)[0];
    expect(overall.playerId).toBe(player.uuid);
    expect(getPlayerRowPerformance(patchedWorld, overall).seasonScore).toBe(77.4);
  });

  it('creates a cross-position current ranking without a 600-minute cliff', () => {
    const world = initializeGameWorld(2025);
    const players = Object.values(world.squads).flat().slice(0, 2);
    const patched = {
      ...world,
      playerStats: {
        ...world.playerStats,
        [players[0].uuid]: {
          ...world.playerStats[players[0].uuid], appearances: 2, minutesPlayed: 180,
          teamMatchesAllCompetitions: 2, goals: 2, bigChances: 3,
        },
        [players[1].uuid]: {
          ...world.playerStats[players[1].uuid], appearances: 2, minutesPlayed: 180,
          teamMatchesAllCompetitions: 2,
        },
      },
    };
    const rows = getCurrentOverallRows(patched, 10);
    expect(rows.some(row => row.playerId === players[0].uuid)).toBe(true);
    expect(rows.every(row => getPlayerRowPerformance(patched, row).seasonScore >= 0)).toBe(true);
  });

  it('builds career rows from retired and frozen historical identities', () => {
    const world = initializeGameWorld(2024);
    const [[teamId, squad], [secondTeamId]] = Object.entries(world.squads);
    const activePlayer = squad[0];
    const retiredHistory: PlayerSeasonStatsHistoryEntry = {
      season: 1,
      teamId: secondTeamId,
      teamName: '退役旧队',
      teamShortName: '退',
      playerName: '退役射手',
      playerNumber: 9,
      position: 'FW',
      rating: 91,
      age: 35,
      goals: 999,
      assists: 7,
      appearances: 34,
      yellowCards: 1,
      redCards: 0,
      teamGoalsConceded: 28,
      teamMatches: 30,
      bigChances: 1003,
      keyPasses: 9,
    };
    const historyOnly: PlayerSeasonStatsHistoryEntry = {
      season: 1,
      teamId: secondTeamId,
      teamName: '历史旧队',
      teamShortName: '历',
      playerName: '历史组织者',
      playerNumber: 10,
      position: 'MF',
      rating: 88,
      age: 29,
      goals: 800,
      assists: 1000,
      appearances: 33,
      yellowCards: 0,
      redCards: 0,
      teamGoalsConceded: 30,
      teamMatches: 30,
      bigChances: 805,
      keyPasses: 1005,
    };
    const activeHistoricalIdentity: PlayerSeasonStatsHistoryEntry = {
      season: 1,
      teamId: secondTeamId,
      teamName: '上一季旧队',
      teamShortName: '旧',
      playerName: '上一季旧名',
      playerNumber: 77,
      position: activePlayer.position,
      rating: activePlayer.rating,
      age: activePlayer.age - 1,
      goals: 3,
      assists: 2,
      appearances: 11,
      yellowCards: 0,
      redCards: 0,
      teamGoalsConceded: 30,
      teamMatches: 30,
      bigChances: 4,
      keyPasses: 3,
    };
    const patchedWorld = {
      ...world,
      playerStats: {
        ...world.playerStats,
        [activePlayer.uuid]: {
          ...world.playerStats[activePlayer.uuid],
          goals: 5,
          assists: 1,
          appearances: 12,
          bigChances: 5,
          keyPasses: 1,
        },
      },
      playerStatsHistory: {
        ...world.playerStatsHistory,
        [activePlayer.uuid]: [activeHistoricalIdentity],
        'retired-career-player': [retiredHistory],
        'history-only-career-player': [historyOnly],
      },
      retirementHistory: [
        ...(world.retirementHistory ?? []),
        {
          uuid: 'retired-career-player',
          name: '退役档案名',
          teamId: secondTeamId,
          teamName: '退役档案队',
          position: 'FW' as const,
          peakRating: 90,
          age: 36,
          seasonRetired: 2,
          careerGoals: 999,
        },
      ],
    };

    const activeCareerRow = getCareerPlayerStatRows(patchedWorld)
      .find((row) => row.playerId === activePlayer.uuid);
    expect(activeCareerRow?.identity.source).toBe('active');
    expect(activeCareerRow?.identity.playerName).toBe(activePlayer.name);
    expect(activeCareerRow?.identity.teamId).toBe(teamId);
    expect(activeCareerRow?.identity.teamName).toBe(world.teamBases[teamId].name);

    const scorerRows = getCareerTopScorerRows(patchedWorld, 2);
    expect(scorerRows[0].playerId).toBe('retired-career-player');
    expect(scorerRows[0].goals).toBe(999);
    expect(scorerRows[0].identity.source).toBe('retired');
    expect(scorerRows[0].identity.playerName).toBe('退役射手');
    expect(scorerRows[0].identity.teamName).toBe('退役旧队');

    const assistRows = getCareerTopAssistRows(patchedWorld, 1);
    expect(assistRows[0].playerId).toBe('history-only-career-player');
    expect(assistRows[0].assists).toBe(1000);
    expect(assistRows[0].identity.source).toBe('history');
    expect(assistRows[0].identity.playerName).toBe('历史组织者');
  });

  it('ranks defenders, goalkeepers, and creators by position-specific metrics', () => {
    const world = initializeGameWorld(2024);
    const defender = Object.values(world.squads).flatMap((squad) => squad).find((p) => p.position === 'DF')!;
    const keeper = Object.values(world.squads).flatMap((squad) => squad).find((p) => p.position === 'GK')!;
    const creator = Object.values(world.squads).flatMap((squad) => squad).find((p) => p.position === 'MF')!;
    const patchedWorld = {
      ...world,
      playerStats: {
        ...world.playerStats,
        [defender.uuid]: {
          ...world.playerStats[defender.uuid],
          appearances: 12,
          minutesPlayed: 900,
          cleanSheets: 7,
          keyBlocks: 4,
          cleanSheetMinutes: 540,
          goalsConcededWhileOnPitch: 8,
          interceptions: 35,
          clearances: 48,
        },
        [keeper.uuid]: {
          ...world.playerStats[keeper.uuid],
          appearances: 12,
          minutesPlayed: 1080,
          cleanSheets: 8,
          saves: 9,
          routineSaves: 38,
          shotsOnTargetFaced: 55,
          cleanSheetMinutes: 720,
          goalsConcededWhileOnPitch: 8,
        },
        [creator.uuid]: {
          ...world.playerStats[creator.uuid],
          appearances: 12,
          minutesPlayed: 1080,
          teamMatchesAllCompetitions: 12,
          assists: 5,
          keyPasses: 14,
        },
      },
    };

    expect(getCurrentDefenderRows(patchedWorld, 1)[0].playerId).toBe(defender.uuid);
    expect(getCurrentGoalkeeperRows(patchedWorld, 1)[0].playerId).toBe(keeper.uuid);
    expect(getCurrentCreatorRows(patchedWorld, 1)[0].playerId).toBe(creator.uuid);
  });

  it('resolves club-specific current-season rows separately from player season totals', () => {
    const world = initializeGameWorld(2024);
    const [oldTeamId, oldSquad] = Object.entries(world.squads)[0];
    const [newTeamId, newSquad] = Object.entries(world.squads)[1];
    const player = oldSquad.find((p) => p.position === 'FW') ?? oldSquad[0];
    const movedPlayer = { ...player, teamId: newTeamId, number: 77 };
    const patchedWorld = {
      ...world,
      squads: {
        ...world.squads,
        [oldTeamId]: oldSquad.filter((p) => p.uuid !== player.uuid),
        [newTeamId]: [movedPlayer, ...newSquad],
      },
      playerStats: {
        ...world.playerStats,
        [player.uuid]: {
          ...world.playerStats[player.uuid],
          teamId: newTeamId,
          goals: 9,
          assists: 4,
          appearances: 14,
          bigChances: 11,
          keyPasses: 5,
        },
      },
      playerStatSegments: {
        ...world.playerStatSegments,
        [playerTeamStatKey(player.uuid, oldTeamId)]: {
          ...world.playerStats[player.uuid],
          playerId: player.uuid,
          teamId: oldTeamId,
          goals: 8,
          assists: 3,
          appearances: 12,
          bigChances: 9,
          keyPasses: 4,
        },
        [playerTeamStatKey(player.uuid, newTeamId)]: {
          ...world.playerStats[player.uuid],
          playerId: player.uuid,
          teamId: newTeamId,
          goals: 1,
          assists: 1,
          appearances: 2,
          bigChances: 2,
          keyPasses: 1,
        },
      },
    };

    const oldClubRow = getPlayerClubStatRow(patchedWorld, player.uuid, oldTeamId);
    expect(oldClubRow.goals).toBe(8);
    expect(oldClubRow.identity.teamId).toBe(oldTeamId);
    expect(oldClubRow.identity.playerName).toBe(player.name);

    const newClubRows = getPlayerClubStatRowMap(patchedWorld, newTeamId);
    expect(newClubRows.get(player.uuid)?.goals).toBe(1);
    expect(newClubRows.get(player.uuid)?.identity.teamId).toBe(newTeamId);

    const oldTeamSegments = getCurrentPlayerClubStatRows(patchedWorld, oldTeamId);
    expect(oldTeamSegments.find((row) => row.playerId === player.uuid)?.goals).toBe(8);
  });

  it('does not fall back to player-wide totals when a club segment is intentionally missing', () => {
    const world = initializeGameWorld(2024);
    const [oldTeamId, oldSquad] = Object.entries(world.squads)[0];
    const [newTeamId, newSquad] = Object.entries(world.squads)[1];
    const player = oldSquad.find((p) => p.position === 'FW') ?? oldSquad[0];
    const movedPlayer = { ...player, teamId: newTeamId, number: 77 };
    const patchedWorld = {
      ...world,
      squads: {
        ...world.squads,
        [oldTeamId]: oldSquad.filter((p) => p.uuid !== player.uuid),
        [newTeamId]: [movedPlayer, ...newSquad],
      },
      playerStats: {
        ...world.playerStats,
        [player.uuid]: {
          ...world.playerStats[player.uuid],
          teamId: newTeamId,
          goals: 9,
          assists: 4,
          appearances: 14,
          bigChances: 11,
          keyPasses: 5,
        },
      },
      playerStatSegments: {
        [playerTeamStatKey(player.uuid, oldTeamId)]: {
          ...world.playerStats[player.uuid],
          playerId: player.uuid,
          teamId: oldTeamId,
          goals: 9,
          assists: 4,
          appearances: 14,
          bigChances: 11,
          keyPasses: 5,
        },
      },
    };

    const newClubRow = getPlayerClubStatRow(patchedWorld, player.uuid, newTeamId);
    expect(newClubRow.goals).toBe(0);
    expect(newClubRow.assists).toBe(0);
    expect(newClubRow.appearances).toBe(0);
  });

  it('ranks a forward-only board by the FW position quality', () => {
    const world = initializeGameWorld(2024);
    const squad = Object.values(world.squads).flat();
    const [topForward, quietForward] = squad.filter((player) => player.position === 'FW');
    const midfielder = squad.find((player) => player.position === 'MF')!;
    const base = {
      appearances: 20,
      starts: 20,
      minutesPlayed: 1700,
      teamMatchesAllCompetitions: 20,
    };
    // Moderate rates on purpose: a saturating line clamps both the FW and MF
    // branches to 100 and would make the two indistinguishable.
    const patched = withStats(world, {
      [topForward.uuid]: { ...base, goals: 6, assists: 2, bigChances: 9, keyPasses: 6 },
      [quietForward.uuid]: { ...base, goals: 2, assists: 0, bigChances: 3, keyPasses: 1 },
      // Better raw numbers than either forward, and still not on this board.
      [midfielder.uuid]: { ...base, goals: 30, assists: 20, bigChances: 44, keyPasses: 40 },
    });

    const rows = getCurrentForwardRows(patched, 20);
    expect(rows.every((row) => row.identity.position === 'FW')).toBe(true);
    expect(rows.map((row) => row.playerId)).not.toContain(midfielder.uuid);
    expect(rows[0].playerId).toBe(topForward.uuid);

    const qualities = rows.map((row) => getPlayerRowPerformance(patched, row).positionQuality);
    expect(qualities).toEqual([...qualities].sort((a, b) => b - a));
    // The board reads the FW branch of computePositionQuality, not the MF one.
    expect(qualities[0]).toBe(computePlayerPerformance('FW', rows[0]).positionQuality);
    expect(qualities[0]).not.toBe(computePlayerPerformance('MF', rows[0]).positionQuality);
  });

  it('keeps players below the display minutes floor out of every current board', () => {
    const world = initializeGameWorld(2024);
    const squad = Object.values(world.squads).flat();
    const pairOf = (position: PlayerPosition) =>
      squad.filter((player) => player.position === position).slice(0, 2);
    const [lowFw, highFw] = pairOf('FW');
    const [lowMf, highMf] = pairOf('MF');
    const [lowDf, highDf] = pairOf('DF');
    const [lowGk, highGk] = pairOf('GK');

    // 40 team matches => floor is a quarter of 3600 available minutes = 900.
    const statLine = {
      appearances: 40,
      starts: 40,
      teamMatchesAllCompetitions: 40,
      goals: 30,
      assists: 25,
      yellowCards: 12,
      redCards: 2,
      bigChances: 44,
      keyPasses: 40,
      interceptions: 90,
      clearances: 90,
      keyBlocks: 18,
      saves: 90,
      routineSaves: 90,
      shotsOnTargetFaced: 130,
      cleanSheets: 20,
      cleanSheetMinutes: 1600,
      goalsConcededWhileOnPitch: 6,
    };
    const below = { ...statLine, minutesPlayed: 800 };
    const above = { ...statLine, minutesPlayed: 1800 };

    const patched = withStats(world, {
      [lowFw.uuid]: below,
      [highFw.uuid]: above,
      [lowMf.uuid]: below,
      [highMf.uuid]: above,
      [lowDf.uuid]: below,
      [highDf.uuid]: above,
      [lowGk.uuid]: below,
      [highGk.uuid]: above,
    });

    const lowRow = getCurrentPlayerStatRows(patched).find((row) => row.playerId === lowFw.uuid)!;
    expect(minimumTableMinutes(lowRow)).toBe(900);
    expect(meetsTableMinutes(lowRow)).toBe(false);

    const belowIds = [lowFw, lowMf, lowDf, lowGk].map((player) => player.uuid);
    const boards: PlayerStatRow[][] = [
      getCurrentOverallRows(patched, 50),
      getCurrentTopScorerRows(patched, 50),
      getCurrentTopAssistRows(patched, 50),
      getCurrentDisciplineRows(patched, 50),
      getCurrentCreatorRows(patched, 50),
      getCurrentForwardRows(patched, 50),
      getCurrentDefenderRows(patched, 50),
      getCurrentGoalkeeperRows(patched, 50),
    ];

    for (const board of boards) {
      expect(board.length).toBeGreaterThan(0);
      for (const row of board) {
        expect(meetsTableMinutes(row)).toBe(true);
        expect(belowIds).not.toContain(row.playerId);
      }
    }

    // Qualified peers still reach the board their position belongs to.
    const idsOf = (board: PlayerStatRow[]) => board.map((row) => row.playerId);
    expect(idsOf(getCurrentForwardRows(patched, 50))).toContain(highFw.uuid);
    expect(idsOf(getCurrentDefenderRows(patched, 50))).toContain(highDf.uuid);
    expect(idsOf(getCurrentGoalkeeperRows(patched, 50))).toContain(highGk.uuid);
    expect(idsOf(getCurrentCreatorRows(patched, 50)))
      .toEqual(expect.arrayContaining([highMf.uuid, highFw.uuid]));
  });

  it('falls back to a 45-minute floor when teamMatchesAllCompetitions is missing', () => {
    const world = initializeGameWorld(2024);
    const [justUnder, exactlyAt] = Object.values(world.squads).flat()
      .filter((player) => player.position === 'FW');
    const patched = withStats(world, {
      [justUnder.uuid]: {
        appearances: 1,
        minutesPlayed: 44,
        teamMatchesAllCompetitions: undefined,
        goals: 9,
        bigChances: 9,
        keyPasses: 4,
      },
      [exactlyAt.uuid]: {
        appearances: 1,
        minutesPlayed: 45,
        teamMatchesAllCompetitions: undefined,
        goals: 8,
        bigChances: 8,
        keyPasses: 4,
      },
    });

    const rows = getCurrentPlayerStatRows(patched);
    const underRow = rows.find((row) => row.playerId === justUnder.uuid)!;
    const atRow = rows.find((row) => row.playerId === exactlyAt.uuid)!;
    expect(underRow.teamMatchesAllCompetitions).toBeUndefined();
    expect(minimumTableMinutes(underRow)).toBe(45);
    expect(meetsTableMinutes(underRow)).toBe(false);
    expect(meetsTableMinutes(atRow)).toBe(true);

    const scorers = getCurrentTopScorerRows(patched, 50).map((row) => row.playerId);
    expect(scorers).not.toContain(justUnder.uuid);
    expect(scorers).toContain(exactlyAt.uuid);
  });

  it('narrows mixed boards to a single position', () => {
    const world = initializeGameWorld(2024);
    const squad = Object.values(world.squads).flat();
    const keeper = squad.find((player) => player.position === 'GK')!;
    const forward = squad.find((player) => player.position === 'FW')!;
    const midfielder = squad.find((player) => player.position === 'MF')!;
    const statLine = {
      appearances: 20,
      starts: 20,
      minutesPlayed: 1800,
      teamMatchesAllCompetitions: 20,
      goals: 25,
      assists: 18,
      yellowCards: 9,
      redCards: 1,
      bigChances: 30,
      keyPasses: 25,
    };
    const patched = withStats(world, {
      [keeper.uuid]: statLine,
      [forward.uuid]: statLine,
      [midfielder.uuid]: statLine,
    });

    const positionsOf = (board: PlayerStatRow[]) => board.map((row) => row.identity.position);
    expect(positionsOf(getCurrentOverallRows(patched, 30, { position: 'GK' }))).toEqual(['GK']);
    expect(positionsOf(getCurrentTopScorerRows(patched, 30, { position: 'GK' }))).toEqual(['GK']);
    expect(positionsOf(getCurrentTopAssistRows(patched, 30, { position: 'GK' }))).toEqual(['GK']);
    expect(positionsOf(getCurrentDisciplineRows(patched, 30, { position: 'GK' }))).toEqual(['GK']);

    // The creator candidate set is MF/FW, so the filter intersects it.
    expect(positionsOf(getCurrentCreatorRows(patched, 30, { position: 'FW' }))).toEqual(['FW']);
    expect(positionsOf(getCurrentCreatorRows(patched, 30, { position: 'MF' }))).toEqual(['MF']);
    expect(getCurrentCreatorRows(patched, 30, { position: 'GK' })).toHaveLength(0);

    // Unfiltered stays mixed.
    expect(positionsOf(getCurrentOverallRows(patched, 30)).sort()).toEqual(['FW', 'GK', 'MF']);
  });
});

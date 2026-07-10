import { describe, expect, it } from 'vitest';
import { initializeGameWorld } from '../season/season-manager';
import {
  getCareerPlayerStatRows,
  getCareerTopAssistRows,
  getCareerTopScorerRows,
  getCurrentPlayerClubStatRows,
  getCurrentCreatorRows,
  getCurrentDefenderRows,
  getCurrentGoalkeeperRows,
  getCurrentPlayerStatRows,
  getCurrentTopScorerRows,
  getPlayerClubStatRow,
  getPlayerClubStatRowMap,
  getSeasonTopScorerRows,
} from './player-stat-selectors';
import { executeSearch } from '../search/query-engine';
import { playerTeamStatKey } from './stats';
import type { PlayerSeasonStatsHistoryEntry } from '../../types/player';

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
          cleanSheets: 7,
          keyBlocks: 4,
        },
        [keeper.uuid]: {
          ...world.playerStats[keeper.uuid],
          appearances: 12,
          cleanSheets: 8,
          saves: 9,
        },
        [creator.uuid]: {
          ...world.playerStats[creator.uuid],
          appearances: 12,
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
});

import type { GameWorld } from '../season/season-manager';
import type {
  Player,
  PlayerPosition,
  PlayerRetirement,
  PlayerSeasonStats,
  PlayerSeasonStatsHistoryEntry,
} from '../../types/player';
import { emptyPlayerStat, playerTeamStatKey } from './stats';
import { computePlayerCareerTotals } from './career-totals';

export type PlayerIdentitySource = 'active' | 'retired' | 'history' | 'stat';

export interface PlayerStatIdentity {
  playerId: string;
  playerName: string;
  playerNumber?: number;
  position?: PlayerPosition;
  rating?: number;
  age?: number;
  marketValue?: number;
  teamId: string;
  teamName: string;
  teamShortName?: string;
  teamColor?: string;
  source: PlayerIdentitySource;
}

export type PlayerStatRow = PlayerSeasonStats & {
  identity: PlayerStatIdentity;
  player?: Player;
  season?: number;
};

function indexActivePlayers(
  squads: GameWorld['squads'],
): Map<string, { player: Player; teamId: string }> {
  const index = new Map<string, { player: Player; teamId: string }>();
  for (const [teamId, squad] of Object.entries(squads ?? {})) {
    for (const player of squad ?? []) {
      if (!index.has(player.uuid)) index.set(player.uuid, { player, teamId });
    }
  }
  return index;
}

function indexRetiredPlayers(
  retirements: PlayerRetirement[] | undefined,
): Map<string, PlayerRetirement> {
  const index = new Map<string, PlayerRetirement>();
  for (const retired of retirements ?? []) {
    index.set(retired.uuid, retired);
  }
  return index;
}

function teamIdentity(world: GameWorld, teamId: string, history?: PlayerSeasonStatsHistoryEntry) {
  const team = world.teamBases[teamId];
  return {
    teamName: history?.teamName ?? team?.name ?? teamId,
    teamShortName: history?.teamShortName ?? team?.shortName,
    teamColor: team?.color,
  };
}

function resolveIdentity(
  world: GameWorld,
  stat: PlayerSeasonStats,
  activePlayers: Map<string, { player: Player; teamId: string }>,
  retiredPlayers: Map<string, PlayerRetirement>,
  history?: PlayerSeasonStatsHistoryEntry,
): { identity: PlayerStatIdentity; player?: Player } {
  const active = activePlayers.get(stat.playerId);
  const retired = retiredPlayers.get(stat.playerId);
  const team = teamIdentity(world, stat.teamId, history);

  if (active) {
    const player = active.player;
    return {
      player,
      identity: {
        playerId: stat.playerId,
        playerName: history?.playerName ?? player.name ?? `${player.number}号`,
        playerNumber: history?.playerNumber ?? player.number,
        position: history?.position ?? player.position,
        rating: history?.rating ?? player.rating,
        age: history?.age ?? player.age,
        marketValue: player.marketValue,
        teamId: stat.teamId,
        ...team,
        source: 'active',
      },
    };
  }

  if (retired) {
    return {
      identity: {
        playerId: stat.playerId,
        playerName: history?.playerName ?? retired.name,
        playerNumber: history?.playerNumber,
        position: history?.position ?? retired.position,
        rating: history?.rating ?? retired.peakRating,
        age: history?.age ?? retired.age,
        teamId: stat.teamId,
        teamName: history?.teamName ?? retired.teamName,
        teamShortName: history?.teamShortName ?? team.teamShortName,
        teamColor: team.teamColor,
        source: 'retired',
      },
    };
  }

  if (history?.playerName) {
    return {
      identity: {
        playerId: stat.playerId,
        playerName: history.playerName,
        playerNumber: history.playerNumber,
        position: history.position,
        rating: history.rating,
        age: history.age,
        teamId: stat.teamId,
        ...team,
        source: 'history',
      },
    };
  }

  return {
    identity: {
      playerId: stat.playerId,
      playerName: stat.playerId,
      position: history?.position,
      teamId: stat.teamId,
      ...team,
      source: 'stat',
    },
  };
}

function rowFromStat(
  world: GameWorld,
  stat: PlayerSeasonStats,
  activePlayers: Map<string, { player: Player; teamId: string }>,
  retiredPlayers: Map<string, PlayerRetirement>,
  history?: PlayerSeasonStatsHistoryEntry,
): PlayerStatRow {
  const resolved = resolveIdentity(world, stat, activePlayers, retiredPlayers, history);
  return {
    ...stat,
    identity: resolved.identity,
    player: resolved.player,
    season: history?.season,
  };
}

function statFromHistory(playerId: string, history: PlayerSeasonStatsHistoryEntry): PlayerSeasonStats {
  return {
    playerId,
    teamId: history.teamId,
    goals: history.goals,
    assists: history.assists,
    yellowCards: history.yellowCards,
    redCards: history.redCards,
    appearances: history.appearances,
    cleanSheets: history.cleanSheets ?? 0,
    saves: history.saves ?? 0,
    keyBlocks: history.keyBlocks ?? 0,
    bigChances: history.bigChances ?? history.goals,
    keyPasses: history.keyPasses ?? history.assists,
  };
}

export function getCurrentPlayerStatRows(world: GameWorld): PlayerStatRow[] {
  const activePlayers = indexActivePlayers(world.squads);
  const retiredPlayers = indexRetiredPlayers(world.retirementHistory);
  return Object.values(world.playerStats ?? {}).map((stat) =>
    rowFromStat(world, stat, activePlayers, retiredPlayers),
  );
}

export function getCurrentPlayerStatRowMap(world: GameWorld): Map<string, PlayerStatRow> {
  const rows = getCurrentPlayerStatRows(world);
  return new Map(rows.map((row) => [row.playerId, row]));
}

export function getCurrentPlayerStatRow(world: GameWorld, playerId: string): PlayerStatRow | undefined {
  return getCurrentPlayerStatRowMap(world).get(playerId);
}

export function getPlayerClubStatRow(
  world: GameWorld,
  playerId: string,
  teamId: string,
): PlayerStatRow {
  const activePlayers = indexActivePlayers(world.squads);
  const retiredPlayers = indexRetiredPlayers(world.retirementHistory);
  const hasSegments = Object.keys(world.playerStatSegments ?? {}).length > 0;
  const stat = hasSegments
    ? world.playerStatSegments?.[playerTeamStatKey(playerId, teamId)] ?? emptyPlayerStat(playerId, teamId)
    : (world.playerStats?.[playerId]?.teamId === teamId ? world.playerStats[playerId] : undefined)
      ?? emptyPlayerStat(playerId, teamId);
  return rowFromStat(world, stat, activePlayers, retiredPlayers);
}

export function getPlayerClubStatRowMap(world: GameWorld, teamId: string): Map<string, PlayerStatRow> {
  const rows = new Map<string, PlayerStatRow>();
  for (const player of world.squads[teamId] ?? []) {
    rows.set(player.uuid, getPlayerClubStatRow(world, player.uuid, teamId));
  }
  return rows;
}

export function getCurrentPlayerClubStatRows(world: GameWorld, teamId?: string): PlayerStatRow[] {
  const activePlayers = indexActivePlayers(world.squads);
  const retiredPlayers = indexRetiredPlayers(world.retirementHistory);
  const hasSegments = Object.keys(world.playerStatSegments ?? {}).length > 0;
  const stats = hasSegments
    ? Object.values(world.playerStatSegments ?? {})
    : Object.values(world.playerStats ?? {});
  return stats
    .filter((stat) => !teamId || stat.teamId === teamId)
    .map((stat) => rowFromStat(world, stat, activePlayers, retiredPlayers));
}

export function getSeasonPlayerStatRows(world: GameWorld, seasonNumber: number): PlayerStatRow[] {
  const activePlayers = indexActivePlayers(world.squads);
  const retiredPlayers = indexRetiredPlayers(world.retirementHistory);
  const rows: PlayerStatRow[] = [];

  for (const [playerId, historyEntries] of Object.entries(world.playerStatsHistory ?? {})) {
    for (const history of historyEntries ?? []) {
      if (history.season !== seasonNumber) continue;
      rows.push(rowFromStat(
        world,
        statFromHistory(playerId, history),
        activePlayers,
        retiredPlayers,
        history,
      ));
    }
  }

  if (rows.length > 0) return rows;
  if (seasonNumber === world.seasonState.seasonNumber) return getCurrentPlayerStatRows(world);
  return [];
}

function latestHistoryEntry(
  entries: PlayerSeasonStatsHistoryEntry[] | undefined,
): PlayerSeasonStatsHistoryEntry | undefined {
  return [...(entries ?? [])].sort((a, b) => b.season - a.season)[0];
}

export function getCareerPlayerStatRows(world: GameWorld): PlayerStatRow[] {
  const activePlayers = indexActivePlayers(world.squads);
  const retiredPlayers = indexRetiredPlayers(world.retirementHistory);
  const playerIds = new Set<string>();

  for (const playerId of Object.keys(world.playerStats ?? {})) playerIds.add(playerId);
  for (const playerId of Object.keys(world.playerStatsHistory ?? {})) playerIds.add(playerId);
  for (const retired of world.retirementHistory ?? []) playerIds.add(retired.uuid);
  for (const { player } of activePlayers.values()) playerIds.add(player.uuid);

  const rows: PlayerStatRow[] = [];
  for (const playerId of playerIds) {
    const totals = computePlayerCareerTotals(world, playerId);
    if (
      totals.appearances === 0
      && totals.goals === 0
      && totals.assists === 0
      && totals.cleanSheets === 0
      && totals.saves === 0
      && totals.keyBlocks === 0
    ) {
      continue;
    }
    const history = latestHistoryEntry(world.playerStatsHistory?.[playerId]);
    const active = activePlayers.get(playerId);
    const historyForIdentity = active ? undefined : history;
    const teamId = world.playerStats?.[playerId]?.teamId
      ?? active?.teamId
      ?? history?.teamId
      ?? retiredPlayers.get(playerId)?.teamId
      ?? activePlayers.get(playerId)?.teamId
      ?? 'unknown';
    const stat: PlayerSeasonStats = {
      playerId,
      teamId,
      goals: totals.goals,
      assists: totals.assists,
      yellowCards: totals.yellowCards,
      redCards: totals.redCards,
      appearances: totals.appearances,
      cleanSheets: totals.cleanSheets,
      saves: totals.saves,
      keyBlocks: totals.keyBlocks,
      bigChances: totals.bigChances,
      keyPasses: totals.keyPasses,
    };
    rows.push(rowFromStat(world, stat, activePlayers, retiredPlayers, historyForIdentity));
  }

  return rows;
}

export function sortRowsByGoals(rows: PlayerStatRow[]): PlayerStatRow[] {
  return [...rows].sort((a, b) => b.goals - a.goals || b.assists - a.assists || b.appearances - a.appearances);
}

export function sortRowsByAssists(rows: PlayerStatRow[]): PlayerStatRow[] {
  return [...rows].sort((a, b) => b.assists - a.assists || b.goals - a.goals || b.appearances - a.appearances);
}

export function sortRowsByDiscipline(rows: PlayerStatRow[]): PlayerStatRow[] {
  return [...rows].sort(
    (a, b) =>
      b.yellowCards + b.redCards - (a.yellowCards + a.redCards) ||
      b.redCards - a.redCards ||
      b.appearances - a.appearances,
  );
}

export function sortRowsByDefense(rows: PlayerStatRow[]): PlayerStatRow[] {
  return [...rows].sort(
    (a, b) =>
      b.cleanSheets - a.cleanSheets ||
      b.keyBlocks - a.keyBlocks ||
      b.appearances - a.appearances ||
      (b.identity.rating ?? 0) - (a.identity.rating ?? 0),
  );
}

export function sortRowsByGoalkeeping(rows: PlayerStatRow[]): PlayerStatRow[] {
  return [...rows].sort(
    (a, b) =>
      b.cleanSheets - a.cleanSheets ||
      b.saves - a.saves ||
      b.appearances - a.appearances ||
      (b.identity.rating ?? 0) - (a.identity.rating ?? 0),
  );
}

export function sortRowsByCreation(rows: PlayerStatRow[]): PlayerStatRow[] {
  return [...rows].sort(
    (a, b) =>
      b.keyPasses - a.keyPasses ||
      b.assists - a.assists ||
      b.goals - a.goals ||
      b.appearances - a.appearances,
  );
}

export function getCurrentTopScorerRows(world: GameWorld, limit = 20): PlayerStatRow[] {
  return sortRowsByGoals(getCurrentPlayerStatRows(world).filter((row) => row.goals > 0)).slice(0, limit);
}

export function getCurrentTopAssistRows(world: GameWorld, limit = 20): PlayerStatRow[] {
  return sortRowsByAssists(getCurrentPlayerStatRows(world).filter((row) => row.assists > 0)).slice(0, limit);
}

export function getCurrentDisciplineRows(world: GameWorld, limit = 20): PlayerStatRow[] {
  return sortRowsByDiscipline(
    getCurrentPlayerStatRows(world).filter((row) => row.yellowCards + row.redCards > 0),
  ).slice(0, limit);
}

export function getCurrentDefenderRows(world: GameWorld, limit = 20): PlayerStatRow[] {
  return sortRowsByDefense(
    getCurrentPlayerStatRows(world).filter((row) =>
      row.identity.position === 'DF'
      && (row.cleanSheets > 0 || row.keyBlocks > 0 || row.appearances > 0)
    ),
  ).slice(0, limit);
}

export function getCurrentGoalkeeperRows(world: GameWorld, limit = 20): PlayerStatRow[] {
  return sortRowsByGoalkeeping(
    getCurrentPlayerStatRows(world).filter((row) =>
      row.identity.position === 'GK'
      && (row.cleanSheets > 0 || row.saves > 0 || row.appearances > 0)
    ),
  ).slice(0, limit);
}

export function getCurrentCreatorRows(world: GameWorld, limit = 20): PlayerStatRow[] {
  return sortRowsByCreation(
    getCurrentPlayerStatRows(world).filter((row) =>
      (row.identity.position === 'MF' || row.identity.position === 'FW')
      && (row.keyPasses > 0 || row.assists > 0)
    ),
  ).slice(0, limit);
}

export function getSeasonTopScorerRows(world: GameWorld, seasonNumber: number, limit = 20): PlayerStatRow[] {
  return sortRowsByGoals(getSeasonPlayerStatRows(world, seasonNumber).filter((row) => row.goals > 0)).slice(0, limit);
}

export function getSeasonTopAssistRows(world: GameWorld, seasonNumber: number, limit = 20): PlayerStatRow[] {
  return sortRowsByAssists(getSeasonPlayerStatRows(world, seasonNumber).filter((row) => row.assists > 0)).slice(0, limit);
}

export function getCareerTopScorerRows(world: GameWorld, limit = 20): PlayerStatRow[] {
  return sortRowsByGoals(getCareerPlayerStatRows(world).filter((row) => row.goals > 0)).slice(0, limit);
}

export function getCareerTopAssistRows(world: GameWorld, limit = 20): PlayerStatRow[] {
  return sortRowsByAssists(getCareerPlayerStatRows(world).filter((row) => row.assists > 0)).slice(0, limit);
}

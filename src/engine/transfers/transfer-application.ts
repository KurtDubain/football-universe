import type { Player, PlayerSeasonStats } from '../../types/player';
import type { TransferRecord, TransferType } from '../../types/transfer';
import { syncPlayerStatsTeamIds } from '../players/stats';

export const FREE_MARKET_TEAM_ID = '__free_market__';
export const FREE_AGENT_SIGNING_FEE = 5;

export function pickFreeSquadNumber(used: Set<number>, preferred: number): number {
  if (!used.has(preferred)) return preferred;
  for (let number = 2; number <= 99; number++) {
    if (!used.has(number)) return number;
  }
  return preferred;
}

export function pickTransferReleaseCandidate(
  buyerSquad: Player[],
  incoming: Player,
  allowAnyPosition = true,
): Player | undefined {
  const samePosition = buyerSquad
    .filter((player) => player.position === incoming.position)
    .sort((a, b) => a.rating - b.rating);
  if (samePosition.length > 0) return samePosition[0];
  if (!allowAnyPosition) return undefined;
  return [...buyerSquad].sort((a, b) => a.rating - b.rating)[0];
}

export interface TransferMoveResult {
  squads: Record<string, Player[]>;
  playerStats: Record<string, PlayerSeasonStats>;
  movedPlayer: Player;
  displacedPlayer?: Player;
}

/**
 * Canonical squad-level transfer application used by automatic and manual
 * windows. It owns roster mutation, shirt-number allocation, player team ids,
 * and current-season stat ownership. Finance/history/news remain orchestration
 * concerns because season-end and interactive windows book them differently.
 */
export function applyTransferMove(params: {
  squads: Record<string, Player[]>;
  playerStats: Record<string, PlayerSeasonStats>;
  player: Player;
  fromTeamId: string;
  toTeamId: string;
  displacedPlayerId?: string;
  displacedToTeamId?: string;
}): TransferMoveResult | null {
  const {
    squads: currentSquads,
    playerStats,
    player,
    fromTeamId,
    toTeamId,
    displacedPlayerId,
    displacedToTeamId,
  } = params;
  const sourceIsMarket = fromTeamId === FREE_MARKET_TEAM_ID;
  const destinationIsMarket = toTeamId === FREE_MARKET_TEAM_ID;
  const sourceSquad = currentSquads[fromTeamId] ?? [];

  if (fromTeamId === toTeamId) return null;
  if (!destinationIsMarket && !currentSquads[toTeamId]) return null;
  if (displacedToTeamId && displacedToTeamId !== FREE_MARKET_TEAM_ID && !currentSquads[displacedToTeamId]) {
    return null;
  }
  if (!sourceIsMarket && !sourceSquad.some((candidate) => candidate.uuid === player.uuid)) {
    return null;
  }

  const squads = { ...currentSquads };
  if (!sourceIsMarket) {
    squads[fromTeamId] = sourceSquad.filter((candidate) => candidate.uuid !== player.uuid);
  }

  let displacedPlayer: Player | undefined;
  let movedPlayer = player;
  if (!destinationIsMarket) {
    const destinationSquad = [...(squads[toTeamId] ?? [])];
    displacedPlayer = displacedPlayerId
      ? destinationSquad.find((candidate) => candidate.uuid === displacedPlayerId)
      : undefined;
    if (displacedPlayerId && !displacedPlayer) return null;
    const displacedUuid = displacedPlayer?.uuid;
    const destinationWithoutDisplaced = displacedUuid
      ? destinationSquad.filter((candidate) => candidate.uuid !== displacedUuid)
      : destinationSquad;
    const number = pickFreeSquadNumber(
      new Set(destinationWithoutDisplaced.map((candidate) => candidate.number)),
      player.number,
    );
    movedPlayer = { ...player, teamId: toTeamId, number };
    squads[toTeamId] = [...destinationWithoutDisplaced, movedPlayer];
  }

  if (displacedPlayer && displacedToTeamId && displacedToTeamId !== FREE_MARKET_TEAM_ID) {
    const replacementSquad = [...(squads[displacedToTeamId] ?? [])];
    const number = pickFreeSquadNumber(
      new Set(replacementSquad.map((candidate) => candidate.number)),
      displacedPlayer.number,
    );
    displacedPlayer = { ...displacedPlayer, teamId: displacedToTeamId, number };
    squads[displacedToTeamId] = [...replacementSquad, displacedPlayer];
  }

  return {
    squads,
    playerStats: syncPlayerStatsTeamIds(playerStats, squads),
    movedPlayer,
    displacedPlayer,
  };
}

export function createTransferRecord(params: {
  season: number;
  windowIndex: number;
  player: Player;
  fromTeamId: string;
  fromTeamName: string;
  toTeamId: string;
  toTeamName: string;
  type: TransferType;
  fee?: number;
  reason: string;
}): TransferRecord {
  const { player } = params;
  return {
    season: params.season,
    windowIndex: params.windowIndex,
    playerId: player.uuid,
    playerName: player.name ?? `${player.number}号`,
    playerNumber: player.number,
    position: player.position,
    fromTeamId: params.fromTeamId,
    fromTeamName: params.fromTeamName,
    toTeamId: params.toTeamId,
    toTeamName: params.toTeamName,
    type: params.type,
    fee: params.fee,
    reason: params.reason,
  };
}

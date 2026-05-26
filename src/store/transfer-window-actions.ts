/**
 * Phase 2 — store-side helpers for the transfer window.
 *
 * Each function takes a GameWorld and returns a NEW world with the
 * action applied. Pure (no side effects). Caller wraps in zustand set.
 */
import type { GameWorld } from '../engine/season/season-manager';
import type { PlayerSeasonStats } from '../types/player';
import type { IncomingOffer, OutgoingTarget, TransferRecord } from '../types/transfer';

/**
 * v23.1 — keep `world.playerStats[uuid].teamId` in lock-step with the
 * player's current squad after a manual transfer. The auto-transfer
 * path in `engine/transfers/transfer-window.ts` already does this at
 * the END of processing, but manual offer/bid/free-agent actions used
 * to skip it — causing UIs that group player stats by `teamId` (top
 * scorer per team, season-end awards, team-contribution %, etc.) to
 * misattribute transferred players to their old team for the rest of
 * the season.
 *
 * Safe to call when there's no stat row for the uuid (free-agent
 * signing of a player who never played this season): we leave the
 * stats untouched in that case.
 */
function syncStatTeamId(
  stats: Record<string, PlayerSeasonStats>,
  uuid: string,
  newTeamId: string,
): Record<string, PlayerSeasonStats> {
  const existing = stats[uuid];
  if (!existing || existing.teamId === newTeamId) return stats;
  return { ...stats, [uuid]: { ...existing, teamId: newTeamId } };
}

/** Move player from owner team to buyer team + book cash. Used by both
 *  acceptIncomingOffer and counterIncomingOffer paths. */
export function applyOfferTransfer(
  world: GameWorld,
  offer: IncomingOffer,
  fee: number,
): GameWorld {
  const squads = { ...world.squads };
  const ownerSquad = (squads[offer.ownerTeamId] ?? []).filter(p => p.uuid !== offer.playerId);
  const player = (world.squads[offer.ownerTeamId] ?? []).find(p => p.uuid === offer.playerId);
  if (!player) return world;
  squads[offer.ownerTeamId] = ownerSquad;
  const buyerSquad = [...(squads[offer.buyerId] ?? [])];
  const buyerNumbers = new Set(buyerSquad.map(p => p.number));
  let newNum = player.number;
  if (buyerNumbers.has(newNum)) {
    for (let n = 2; n <= 99; n++) if (!buyerNumbers.has(n)) { newNum = n; break; }
  }
  buyerSquad.push({ ...player, teamId: offer.buyerId, number: newNum });
  squads[offer.buyerId] = buyerSquad;

  // Cash flow: buyer pays, owner receives
  const teamFinances = { ...world.teamFinances };
  const owner = teamFinances[offer.ownerTeamId];
  const buyer = teamFinances[offer.buyerId];
  if (owner) teamFinances[offer.ownerTeamId] = { ...owner, cash: owner.cash + fee, totalIncome: owner.totalIncome + fee };
  if (buyer) teamFinances[offer.buyerId] = { ...buyer, cash: buyer.cash - fee, totalExpense: buyer.totalExpense + fee };

  const transferRecord: TransferRecord = {
    season: world.seasonState.seasonNumber,
    windowIndex: world.seasonState.currentWindowIndex,
    playerId: player.uuid,
    playerName: player.name ?? `${player.number}号`,
    playerNumber: newNum,
    position: player.position,
    fromTeamId: offer.ownerTeamId,
    fromTeamName: offer.ownerTeamName,
    toTeamId: offer.buyerId,
    toTeamName: offer.buyerName,
    type: 'transfer',
    fee,
    reason: '玩家接受报价',
  };

  return {
    ...world,
    squads,
    teamFinances,
    playerStats: syncStatTeamId(world.playerStats, player.uuid, offer.buyerId),
    transferHistory: [...(world.transferHistory ?? []), transferRecord],
  };
}

/** Buyer (favorite team) pays fee, gets player from seller team. */
export function applyOutgoingBid(
  world: GameWorld,
  target: OutgoingTarget,
  fee: number,
): GameWorld {
  const squads = { ...world.squads };
  const sellerSquad = (squads[target.fromTeamId] ?? []).filter(p => p.uuid !== target.playerId);
  const player = (world.squads[target.fromTeamId] ?? []).find(p => p.uuid === target.playerId);
  if (!player) return world;
  squads[target.fromTeamId] = sellerSquad;
  const buyerSquad = [...(squads[target.toTeamId] ?? [])];
  const buyerNumbers = new Set(buyerSquad.map(p => p.number));
  let newNum = player.number;
  if (buyerNumbers.has(newNum)) {
    for (let n = 2; n <= 99; n++) if (!buyerNumbers.has(n)) { newNum = n; break; }
  }
  buyerSquad.push({ ...player, teamId: target.toTeamId, number: newNum });
  squads[target.toTeamId] = buyerSquad;

  const teamFinances = { ...world.teamFinances };
  const seller = teamFinances[target.fromTeamId];
  const buyer = teamFinances[target.toTeamId];
  if (seller) teamFinances[target.fromTeamId] = { ...seller, cash: seller.cash + fee, totalIncome: seller.totalIncome + fee };
  if (buyer) teamFinances[target.toTeamId] = { ...buyer, cash: buyer.cash - fee, totalExpense: buyer.totalExpense + fee };

  const transferRecord: TransferRecord = {
    season: world.seasonState.seasonNumber,
    windowIndex: world.seasonState.currentWindowIndex,
    playerId: player.uuid,
    playerName: player.name ?? `${player.number}号`,
    playerNumber: newNum,
    position: player.position,
    fromTeamId: target.fromTeamId,
    fromTeamName: target.fromTeamName,
    toTeamId: target.toTeamId,
    toTeamName: world.teamBases[target.toTeamId]?.name ?? target.toTeamId,
    type: 'transfer',
    fee,
    reason: '玩家主动报价',
  };

  return {
    ...world,
    squads,
    teamFinances,
    playerStats: syncStatTeamId(world.playerStats, player.uuid, target.toTeamId),
    transferHistory: [...(world.transferHistory ?? []), transferRecord],
  };
}

const FREE_AGENT_SIGNING_FEE = 5;

/** Sign a free agent from the pool to the target team (typically favorite #1). */
export function signFreeAgent(
  world: GameWorld,
  playerUuid: string,
  toTeamId: string,
): GameWorld | null {
  const pool = world.freeAgentPool ?? [];
  const player = pool.find(p => p.uuid === playerUuid);
  if (!player) return null;
  // Cash check
  const finance = world.teamFinances[toTeamId];
  if (!finance || finance.cash < FREE_AGENT_SIGNING_FEE) return null;

  const newPool = pool.filter(p => p.uuid !== playerUuid);
  const squads = { ...world.squads };
  const toSquad = [...(squads[toTeamId] ?? [])];
  const used = new Set(toSquad.map(p => p.number));
  let num = player.number;
  if (used.has(num)) for (let n = 2; n <= 99; n++) if (!used.has(n)) { num = n; break; }
  toSquad.push({ ...player, teamId: toTeamId, number: num });
  squads[toTeamId] = toSquad;

  const teamFinances = { ...world.teamFinances };
  teamFinances[toTeamId] = { ...finance, cash: finance.cash - FREE_AGENT_SIGNING_FEE, totalExpense: finance.totalExpense + FREE_AGENT_SIGNING_FEE };

  const transferRecord: TransferRecord = {
    season: world.seasonState.seasonNumber,
    windowIndex: world.seasonState.currentWindowIndex,
    playerId: player.uuid,
    playerName: player.name ?? `${player.number}号`,
    playerNumber: num,
    position: player.position,
    fromTeamId: '__free_market__',
    fromTeamName: '自由市场',
    toTeamId,
    toTeamName: world.teamBases[toTeamId]?.name ?? toTeamId,
    type: 'free_agent',
    fee: FREE_AGENT_SIGNING_FEE,
    reason: '玩家从自由市场签下',
  };

  return {
    ...world,
    squads,
    teamFinances,
    freeAgentPool: newPool,
    // Sync stat row in case the free agent had a partial-season stat
    // entry from a prior team in the same season (rare — mostly the
    // free-agent pool comes from contract expiries / retirements, not
    // mid-season releases — but covers the edge case).
    playerStats: syncStatTeamId(world.playerStats, player.uuid, toTeamId),
    transferHistory: [...(world.transferHistory ?? []), transferRecord],
  };
}

/** Auto-handle any items the user didn't decide on:
 *   - incoming offer: reject (keep player)
 *   - outgoing target: skip
 *  Free agents stay in pool. Returns new world. */
export function autoResolveRemaining(world: GameWorld): GameWorld {
  const tw = world.transferWindow;
  if (!tw) return world;
  const updatedOffers = tw.incomingOffers.map(o => o.resolution === 'pending'
    ? { ...o, resolution: 'rejected' as const }
    : o);
  const updatedTargets = tw.outgoingTargets.map(t => t.resolution === 'pending'
    ? { ...t, resolution: 'skipped' as const }
    : t);
  return {
    ...world,
    transferWindow: {
      ...tw,
      incomingOffers: updatedOffers,
      outgoingTargets: updatedTargets,
    },
  };
}

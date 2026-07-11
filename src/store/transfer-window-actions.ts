/**
 * Phase 2 — store-side helpers for the transfer window.
 *
 * Each function takes a GameWorld and returns a NEW world with the
 * action applied. Pure (no side effects). Caller wraps in zustand set.
 */
import type { GameWorld } from '../engine/season/season-manager';
import { syncPlayerStatsTeamIds } from '../engine/players/stats';
import type { NewsItem } from '../engine/season/season-manager';
import type { Player, PlayerSeasonStats } from '../types/player';
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

const FREE_AGENT_SIGNING_FEE = 5;

function transferSeason(world: GameWorld): number {
  return world.transferWindow?.season ?? world.seasonState.seasonNumber;
}

function transferWindowIndex(world: GameWorld): number {
  return world.seasonState.currentWindowIndex;
}

function transferNewsId(record: TransferRecord, suffix = record.toTeamId): string {
  return `manual-transfer:S${record.season}:W${record.windowIndex}:${record.playerId}:${suffix}`;
}

function newsFromTransferRecord(record: TransferRecord, titlePrefix = '转会'): NewsItem {
  const feeText = record.fee ? `，费用约€${record.fee}M` : '';
  return {
    id: transferNewsId(record),
    seasonNumber: record.season,
    windowIndex: record.windowIndex,
    type: 'trophy',
    title: `${titlePrefix}: ${record.playerName} 加盟 ${record.toTeamName}`,
    description: `${record.playerName} 从 ${record.fromTeamName} 前往 ${record.toTeamName}${feeText}。${record.reason}。`,
  };
}

function pickFreeNumber(used: Set<number>, preferred: number): number {
  if (!used.has(preferred)) return preferred;
  for (let n = 2; n <= 99; n++) {
    if (!used.has(n)) return n;
  }
  return preferred;
}

function pickReleaseCandidate(buyerSquad: Player[], incoming: Player): Player | undefined {
  const samePosition = buyerSquad
    .filter((p) => p.position === incoming.position)
    .sort((a, b) => a.rating - b.rating);
  if (samePosition.length > 0) return samePosition[0];
  return [...buyerSquad].sort((a, b) => a.rating - b.rating)[0];
}

function withTransferIncome(
  fin: NonNullable<GameWorld['teamFinances'][string]>,
  amount: number,
  season: number,
  currentSeason: number,
): NonNullable<GameWorld['teamFinances'][string]> {
  const historyIndex = fin.history.findIndex((entry) => entry.season === season);
  if (historyIndex >= 0) {
    const history = [...fin.history];
    const record = history[historyIndex];
    history[historyIndex] = {
      ...record,
      endCash: record.endCash + amount,
      transferIncome: record.transferIncome + amount,
    };
    return { ...fin, cash: fin.cash + amount, history };
  }
  return {
    ...fin,
    cash: fin.cash + amount,
    totalIncome: season === currentSeason ? fin.totalIncome + amount : fin.totalIncome,
  };
}

function withTransferExpense(
  fin: NonNullable<GameWorld['teamFinances'][string]>,
  amount: number,
  season: number,
  currentSeason: number,
): NonNullable<GameWorld['teamFinances'][string]> {
  const historyIndex = fin.history.findIndex((entry) => entry.season === season);
  if (historyIndex >= 0) {
    const history = [...fin.history];
    const record = history[historyIndex];
    history[historyIndex] = {
      ...record,
      endCash: record.endCash - amount,
      transferExpense: record.transferExpense + amount,
    };
    return { ...fin, cash: fin.cash - amount, history };
  }
  return {
    ...fin,
    cash: fin.cash - amount,
    totalExpense: season === currentSeason ? fin.totalExpense + amount : fin.totalExpense,
  };
}

function creditFinance(
  finances: GameWorld['teamFinances'],
  teamId: string,
  amount: number,
  season: number,
  currentSeason: number,
): GameWorld['teamFinances'] {
  const fin = finances[teamId];
  if (!fin || amount <= 0) return finances;
  return {
    ...finances,
    [teamId]: withTransferIncome(fin, amount, season, currentSeason),
  };
}

function debitFinance(
  finances: GameWorld['teamFinances'],
  teamId: string,
  amount: number,
  season: number,
  currentSeason: number,
): GameWorld['teamFinances'] {
  const fin = finances[teamId];
  if (!fin || amount <= 0) return finances;
  return {
    ...finances,
    [teamId]: withTransferExpense(fin, amount, season, currentSeason),
  };
}

function applyBalancedTransfer(params: {
  world: GameWorld;
  playerId: string;
  fromTeamId: string;
  fromTeamName: string;
  toTeamId: string;
  toTeamName: string;
  fee: number;
  reason: string;
}): GameWorld {
  const { world, playerId, fromTeamId, fromTeamName, toTeamId, toTeamName, fee, reason } = params;
  const squads = { ...world.squads };
  const fromSquad = [...(squads[fromTeamId] ?? [])];
  const toSquad = [...(squads[toTeamId] ?? [])];
  const player = fromSquad.find((p) => p.uuid === playerId);
  if (!player) return world;

  const released = pickReleaseCandidate(toSquad, player);
  const buyerSquadWithoutReleased = released
    ? toSquad.filter((p) => p.uuid !== released.uuid)
    : toSquad;
  const incomingNumber = pickFreeNumber(new Set(buyerSquadWithoutReleased.map((p) => p.number)), player.number);
  const sellerSquadWithoutPlayer = fromSquad.filter((p) => p.uuid !== player.uuid);
  const replacementNumber = released
    ? pickFreeNumber(new Set(sellerSquadWithoutPlayer.map((p) => p.number)), released.number)
    : undefined;

  squads[toTeamId] = [
    ...buyerSquadWithoutReleased,
    { ...player, teamId: toTeamId, number: incomingNumber },
  ];
  squads[fromTeamId] = released
    ? [
        ...sellerSquadWithoutPlayer,
        { ...released, teamId: fromTeamId, number: replacementNumber! },
      ]
    : sellerSquadWithoutPlayer;

  const season = transferSeason(world);
  const currentSeason = world.seasonState.seasonNumber;
  let teamFinances = { ...world.teamFinances };
  teamFinances = creditFinance(teamFinances, fromTeamId, fee, season, currentSeason);
  teamFinances = debitFinance(teamFinances, toTeamId, fee, season, currentSeason);
  if (released) {
    teamFinances = debitFinance(teamFinances, fromTeamId, FREE_AGENT_SIGNING_FEE, season, currentSeason);
    teamFinances = creditFinance(teamFinances, toTeamId, FREE_AGENT_SIGNING_FEE, season, currentSeason);
  }

  const windowIndex = transferWindowIndex(world);
  const transferRecord: TransferRecord = {
    season,
    windowIndex,
    playerId: player.uuid,
    playerName: player.name ?? `${player.number}号`,
    playerNumber: incomingNumber,
    position: player.position,
    fromTeamId,
    fromTeamName,
    toTeamId,
    toTeamName,
    type: 'transfer',
    fee,
    reason,
  };
  const replacementRecord: TransferRecord | null = released ? {
    season,
    windowIndex,
    playerId: released.uuid,
    playerName: released.name ?? `${released.number}号`,
    playerNumber: replacementNumber!,
    position: released.position,
    fromTeamId: toTeamId,
    fromTeamName: toTeamName,
    toTeamId: fromTeamId,
    toTeamName: fromTeamName,
    type: 'free_agent',
    fee: FREE_AGENT_SIGNING_FEE,
    reason: '买家阵容腾位，卖家补入替代球员',
  } : null;
  const transferRecords = replacementRecord
    ? [transferRecord, replacementRecord]
    : [transferRecord];

  return {
    ...world,
    squads,
    teamFinances,
    playerStats: syncPlayerStatsTeamIds(
      syncStatTeamId(syncStatTeamId(world.playerStats, player.uuid, toTeamId), released?.uuid ?? '', fromTeamId),
      squads,
    ),
    transferHistory: [...(world.transferHistory ?? []), ...transferRecords],
    newsLog: [
      ...(world.newsLog ?? []),
      newsFromTransferRecord(transferRecord, reason === '玩家主动报价' ? '主动引援' : '接受报价'),
      ...(replacementRecord ? [newsFromTransferRecord(replacementRecord, '阵容补位')] : []),
    ],
  };
}

/** Move player from owner team to buyer team + book cash. Used by both
 *  acceptIncomingOffer and counterIncomingOffer paths. */
export function applyOfferTransfer(
  world: GameWorld,
  offer: IncomingOffer,
  fee: number,
): GameWorld {
  return applyBalancedTransfer({
    world,
    playerId: offer.playerId,
    fromTeamId: offer.ownerTeamId,
    fromTeamName: offer.ownerTeamName,
    toTeamId: offer.buyerId,
    toTeamName: offer.buyerName,
    fee,
    reason: '玩家接受报价',
  });
}

/** Buyer (favorite team) pays fee, gets player from seller team. */
export function applyOutgoingBid(
  world: GameWorld,
  target: OutgoingTarget,
  fee: number,
): GameWorld {
  return applyBalancedTransfer({
    world,
    playerId: target.playerId,
    fromTeamId: target.fromTeamId,
    fromTeamName: target.fromTeamName,
    toTeamId: target.toTeamId,
    toTeamName: world.teamBases[target.toTeamId]?.name ?? target.toTeamId,
    fee,
    reason: '玩家主动报价',
  });
}

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

  const season = transferSeason(world);
  const teamFinances = {
    ...world.teamFinances,
    [toTeamId]: withTransferExpense(
      finance,
      FREE_AGENT_SIGNING_FEE,
      season,
      world.seasonState.seasonNumber,
    ),
  };

  const transferRecord: TransferRecord = {
    season,
    windowIndex: transferWindowIndex(world),
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
    newsLog: [...(world.newsLog ?? []), newsFromTransferRecord(transferRecord, '自由签约')],
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

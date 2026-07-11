/**
 * Phase 2 — store-side helpers for the transfer window.
 *
 * Each function takes a GameWorld and returns a NEW world with the
 * action applied. Pure (no side effects). Caller wraps in zustand set.
 */
import type { GameWorld } from '../engine/season/season-manager';
import type { NewsItem } from '../engine/season/season-manager';
import {
  applyTransferMove,
  createTransferRecord,
  FREE_AGENT_SIGNING_FEE,
  FREE_MARKET_TEAM_ID,
  pickTransferReleaseCandidate,
} from '../engine/transfers/transfer-application';
import type { IncomingOffer, OutgoingTarget, TransferRecord } from '../types/transfer';

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
  const fromSquad = world.squads[fromTeamId] ?? [];
  const toSquad = world.squads[toTeamId] ?? [];
  const player = fromSquad.find((p) => p.uuid === playerId);
  if (!player) return world;

  const releaseCandidate = pickTransferReleaseCandidate(toSquad, player);
  const applied = applyTransferMove({
    squads: world.squads,
    playerStats: world.playerStats,
    player,
    fromTeamId,
    toTeamId,
    displacedPlayerId: releaseCandidate?.uuid,
    displacedToTeamId: releaseCandidate ? fromTeamId : undefined,
  });
  if (!applied) return world;
  const { squads, playerStats, movedPlayer, displacedPlayer: released } = applied;

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
  const transferRecord = createTransferRecord({
    season,
    windowIndex,
    player: movedPlayer,
    fromTeamId,
    fromTeamName,
    toTeamId,
    toTeamName,
    type: 'transfer',
    fee,
    reason,
  });
  const replacementRecord: TransferRecord | null = released ? createTransferRecord({
    season,
    windowIndex,
    player: released,
    fromTeamId: toTeamId,
    fromTeamName: toTeamName,
    toTeamId: fromTeamId,
    toTeamName: fromTeamName,
    type: 'free_agent',
    fee: FREE_AGENT_SIGNING_FEE,
    reason: '买家阵容腾位，卖家补入替代球员',
  }) : null;
  const transferRecords = replacementRecord
    ? [transferRecord, replacementRecord]
    : [transferRecord];

  return {
    ...world,
    squads,
    teamFinances,
    playerStats,
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

  const applied = applyTransferMove({
    squads: world.squads,
    playerStats: world.playerStats,
    player,
    fromTeamId: FREE_MARKET_TEAM_ID,
    toTeamId,
  });
  if (!applied) return null;
  const newPool = pool.filter(p => p.uuid !== playerUuid);

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

  const transferRecord = createTransferRecord({
    season,
    windowIndex: transferWindowIndex(world),
    player: applied.movedPlayer,
    fromTeamId: FREE_MARKET_TEAM_ID,
    fromTeamName: '自由市场',
    toTeamId,
    toTeamName: world.teamBases[toTeamId]?.name ?? toTeamId,
    type: 'free_agent',
    fee: FREE_AGENT_SIGNING_FEE,
    reason: '玩家从自由市场签下',
  });

  return {
    ...world,
    squads: applied.squads,
    teamFinances,
    freeAgentPool: newPool,
    // Sync stat row in case the free agent had a partial-season stat
    // entry from a prior team in the same season (rare — mostly the
    // free-agent pool comes from contract expiries / retirements, not
    // mid-season releases — but covers the edge case).
    playerStats: applied.playerStats,
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

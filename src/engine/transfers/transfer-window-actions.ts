/**
 * Pure world transformations for user-facing transfer-window decisions.
 *
 * Each function takes a GameWorld and returns a NEW world with the
 * action applied. Pure (no side effects). Caller wraps in zustand set.
 */
import type { GameWorld, NewsItem } from '../season/season-manager';
import {
  applyTransferMove,
  createTransferRecord,
  FREE_MARKET_TEAM_ID,
  pickTransferReleaseCandidate,
} from './transfer-application';
import type {
  IncomingOffer,
  ObserverTransferImpact,
  OutgoingTarget,
  TransferRecord,
} from '../../types/transfer';
import type { Player, PlayerPosition } from '../../types/player';
import { estimateFreeAgentSigningCost } from './transfer-decision';

function transferSeason(world: GameWorld): number {
  return world.transferWindow?.season ?? world.seasonState.seasonNumber;
}

function transferWindowIndex(world: GameWorld): number {
  return world.seasonState.currentWindowIndex;
}

function transferNewsId(record: TransferRecord, suffix = record.toTeamId): string {
  return `manual-transfer:S${record.season}:W${record.windowIndex}:${record.playerId}:${suffix}`;
}

function roundRating(value: number): number {
  return Math.round(value * 10) / 10;
}

function averageSquadRating(squad: readonly Player[]): number {
  if (squad.length === 0) return 0;
  return roundRating(squad.reduce((sum, player) => sum + player.rating, 0) / squad.length);
}

function playerDepthRank(squad: readonly Player[], playerId: string, position: PlayerPosition): number | undefined {
  const index = [...squad]
    .filter(player => player.position === position)
    .sort((left, right) => right.rating - left.rating || left.uuid.localeCompare(right.uuid))
    .findIndex(player => player.uuid === playerId);
  return index >= 0 ? index + 1 : undefined;
}

function buildObserverTransferImpact(params: {
  world: GameWorld;
  focusTeamId: string;
  player: Player;
  beforeSquad: readonly Player[];
  afterSquad: readonly Player[];
  cashBefore: number;
  cashAfter: number;
  displacedPlayer?: Player;
}): ObserverTransferImpact {
  const { world, focusTeamId, player, beforeSquad, afterSquad, displacedPlayer } = params;
  return {
    focusTeamId,
    focusTeamName: world.teamBases[focusTeamId]?.name ?? focusTeamId,
    teamBaseOverall: world.teamBases[focusTeamId]?.overall ?? 0,
    squadAverageBefore: averageSquadRating(beforeSquad),
    squadAverageAfter: averageSquadRating(afterSquad),
    positionCountBefore: beforeSquad.filter(candidate => candidate.position === player.position).length,
    positionCountAfter: afterSquad.filter(candidate => candidate.position === player.position).length,
    playerDepthRankBefore: playerDepthRank(beforeSquad, player.uuid, player.position),
    playerDepthRankAfter: playerDepthRank(afterSquad, player.uuid, player.position),
    cashBefore: roundRating(params.cashBefore),
    cashAfter: roundRating(params.cashAfter),
    ...(displacedPlayer ? {
      displacedPlayer: {
        playerId: displacedPlayer.uuid,
        playerName: displacedPlayer.name,
        rating: displacedPlayer.rating,
        position: displacedPlayer.position,
      },
    } : {}),
  };
}

function newsFromTransferRecord(record: TransferRecord, titlePrefix = '转会'): NewsItem {
  const feeText = record.fee ? `，费用约€${record.fee}M` : '';
  if (record.toTeamId === FREE_MARKET_TEAM_ID) {
    return {
      id: transferNewsId(record),
      seasonNumber: record.season,
      windowIndex: record.windowIndex,
      type: 'trophy',
      importance: 'minor',
      title: `${titlePrefix}: ${record.playerName} 离开 ${record.fromTeamName}`,
      description: `${record.playerName}离开${record.fromTeamName}进入自由市场。${record.reason}。`,
    };
  }
  return {
    id: transferNewsId(record),
    seasonNumber: record.season,
    windowIndex: record.windowIndex,
    type: 'trophy',
    importance: 'minor',
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
  observerFocusTeamId: string;
}): GameWorld {
  const {
    world,
    playerId,
    fromTeamId,
    fromTeamName,
    toTeamId,
    toTeamName,
    fee,
    reason,
    observerFocusTeamId,
  } = params;
  const fromSquad = world.squads[fromTeamId] ?? [];
  const toSquad = world.squads[toTeamId] ?? [];
  const observerSquadBefore = world.squads[observerFocusTeamId] ?? [];
  const observerCashBefore = world.teamFinances[observerFocusTeamId]?.cash ?? 0;
  const player = fromSquad.find((p) => p.uuid === playerId);
  if (!player) return world;
  if (fromSquad.length >= 11 && fromSquad.length <= 18) return world;
  const buyerFinance = world.teamFinances[toTeamId];
  if (buyerFinance && buyerFinance.cash < fee) return world;

  const releaseCandidate = pickTransferReleaseCandidate(toSquad, player);
  const applied = applyTransferMove({
    squads: world.squads,
    playerStats: world.playerStats,
    player,
    fromTeamId,
    toTeamId,
    displacedPlayerId: releaseCandidate?.uuid,
    displacedToTeamId: releaseCandidate ? FREE_MARKET_TEAM_ID : undefined,
  });
  if (!applied) return world;
  const { squads, playerStats, movedPlayer, displacedPlayer: released } = applied;

  const season = transferSeason(world);
  const currentSeason = world.seasonState.seasonNumber;
  let teamFinances = { ...world.teamFinances };
  teamFinances = creditFinance(teamFinances, fromTeamId, fee, season, currentSeason);
  teamFinances = debitFinance(teamFinances, toTeamId, fee, season, currentSeason);

  const windowIndex = transferWindowIndex(world);
  const transferRecord: TransferRecord = {
    ...createTransferRecord({
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
    }),
    observerInitiated: true,
    observerImpact: buildObserverTransferImpact({
      world,
      focusTeamId: observerFocusTeamId,
      player: movedPlayer,
      beforeSquad: observerSquadBefore,
      afterSquad: squads[observerFocusTeamId] ?? [],
      cashBefore: observerCashBefore,
      cashAfter: teamFinances[observerFocusTeamId]?.cash ?? 0,
      displacedPlayer: observerFocusTeamId === toTeamId ? released : undefined,
    }),
  };
  const replacementRecord: TransferRecord | null = released ? createTransferRecord({
    season,
    windowIndex,
    player: released,
    fromTeamId: toTeamId,
    fromTeamName: toTeamName,
    toTeamId: FREE_MARKET_TEAM_ID,
    toTeamName: '自由市场',
    type: 'free',
    reason: '新援到队后调整阵容，自由身离队',
  }) : null;
  const transferRecords = replacementRecord
    ? [transferRecord, replacementRecord]
    : [transferRecord];

  return {
    ...world,
    squads,
    teamFinances,
    playerStats,
    freeAgentPool: released
      ? [...(world.freeAgentPool ?? []).filter(candidate => candidate.uuid !== released.uuid), released]
      : world.freeAgentPool,
    transferHistory: [...(world.transferHistory ?? []), ...transferRecords],
    newsLog: [
      ...(world.newsLog ?? []),
      newsFromTransferRecord(transferRecord, reason === '玩家主动报价' ? '主动引援' : '接受报价'),
      ...(replacementRecord ? [newsFromTransferRecord(replacementRecord, '阵容清理')] : []),
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
    observerFocusTeamId: offer.ownerTeamId,
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
    observerFocusTeamId: target.toTeamId,
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
  const signingCost = estimateFreeAgentSigningCost(player);
  const finance = world.teamFinances[toTeamId];
  if (!finance || finance.cash < signingCost) return null;

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
      signingCost,
      season,
      world.seasonState.seasonNumber,
    ),
  };

  const transferRecord: TransferRecord = {
    ...createTransferRecord({
      season,
      windowIndex: transferWindowIndex(world),
      player: applied.movedPlayer,
      fromTeamId: FREE_MARKET_TEAM_ID,
      fromTeamName: '自由市场',
      toTeamId,
      toTeamName: world.teamBases[toTeamId]?.name ?? toTeamId,
      type: 'free_agent',
      fee: signingCost,
      reason: '玩家从自由市场签下',
    }),
    observerInitiated: true,
    observerImpact: buildObserverTransferImpact({
      world,
      focusTeamId: toTeamId,
      player: applied.movedPlayer,
      beforeSquad: world.squads[toTeamId] ?? [],
      afterSquad: applied.squads[toTeamId] ?? [],
      cashBefore: finance.cash,
      cashAfter: teamFinances[toTeamId]?.cash ?? 0,
    }),
  };

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

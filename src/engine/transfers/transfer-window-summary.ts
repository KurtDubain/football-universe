import type { GameWorld } from '../season/season-manager';

export interface TransferCashChange {
  teamId: string;
  teamName: string;
  delta: number;
}

export interface TransferWindowHandoffSummary {
  season: number;
  mode: 'auto' | 'manual';
  autoRejectedOffers: number;
  autoSkippedTargets: number;
  acceptedOffers: number;
  rejectedOffers: number;
  completedTargets: number;
  uncompletedTargets: number;
  signedPlayerNames: string[];
  cashChanges: TransferCashChange[];
}

const ACCEPTED_OFFER_RESOLUTIONS = new Set(['accepted', 'countered_accepted']);
const REJECTED_OFFER_RESOLUTIONS = new Set(['rejected', 'countered_rejected', 'withdrawn']);

export function buildTransferWindowHandoffSummary(
  beforeWorld: GameWorld,
  resolvedWorld: GameWorld,
  favoriteTeamIds: readonly string[],
  mode: TransferWindowHandoffSummary['mode'],
): TransferWindowHandoffSummary | null {
  const before = beforeWorld.transferWindow;
  const resolved = resolvedWorld.transferWindow;
  if (!before || !resolved) return null;
  const favoriteSet = new Set(favoriteTeamIds);
  const records = (resolvedWorld.transferHistory ?? []).filter(record => (
    record.season === resolved.season
    && record.observerInitiated
    && record.observerImpact
    && favoriteSet.has(record.observerImpact.focusTeamId)
  ));
  const signedPlayerNames = [...new Set(records
    .filter(record => favoriteSet.has(record.toTeamId))
    .map(record => record.playerName))];
  const cashByTeam = new Map<string, number>();
  for (const record of records) {
    const impact = record.observerImpact!;
    cashByTeam.set(
      impact.focusTeamId,
      (cashByTeam.get(impact.focusTeamId) ?? 0) + impact.cashAfter - impact.cashBefore,
    );
  }

  return {
    season: resolved.season,
    mode,
    autoRejectedOffers: mode === 'auto'
      ? before.incomingOffers.filter(offer => offer.resolution === 'pending').length
      : 0,
    autoSkippedTargets: mode === 'auto'
      ? before.outgoingTargets.filter(target => target.resolution === 'pending').length
      : 0,
    acceptedOffers: resolved.incomingOffers.filter(offer => ACCEPTED_OFFER_RESOLUTIONS.has(offer.resolution)).length,
    rejectedOffers: resolved.incomingOffers.filter(offer => REJECTED_OFFER_RESOLUTIONS.has(offer.resolution)).length,
    completedTargets: resolved.outgoingTargets.filter(target => target.resolution === 'bid_accepted').length,
    uncompletedTargets: resolved.outgoingTargets.filter(target => (
      target.resolution === 'bid_rejected' || target.resolution === 'skipped'
    )).length,
    signedPlayerNames,
    cashChanges: favoriteTeamIds.map(teamId => ({
      teamId,
      teamName: resolvedWorld.teamBases[teamId]?.name ?? teamId,
      delta: Math.round((cashByTeam.get(teamId) ?? 0) * 10) / 10,
    })),
  };
}

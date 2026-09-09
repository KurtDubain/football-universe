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

export interface TransferWindowHandoffPresentation {
  conclusion: string;
  details: string[];
  cashChanged: boolean;
}

const ACCEPTED_OFFER_RESOLUTIONS = new Set(['accepted', 'countered_accepted']);
const REJECTED_OFFER_RESOLUTIONS = new Set(['rejected', 'countered_rejected', 'withdrawn']);

export function describeTransferWindowHandoff(
  summary: TransferWindowHandoffSummary,
): TransferWindowHandoffPresentation {
  const arrivals = summary.signedPlayerNames.length;
  const departures = summary.acceptedOffers;
  let conclusion: string;
  if (arrivals > 0 || departures > 0) {
    const changes = [
      arrivals > 0 ? `签下${summary.signedPlayerNames.join('、')}` : null,
      departures > 0 ? `同意${departures}份离队报价` : null,
    ].filter((item): item is string => Boolean(item));
    conclusion = `球队${changes.join('，')}。`;
  } else if (summary.mode === 'auto' && summary.autoSkippedTargets > 0) {
    conclusion = `球队跳过${summary.autoSkippedTargets}个引援目标，本窗口无人加盟或离队。`;
  } else {
    conclusion = '本窗口无人加盟或离队。';
  }

  const details = [
    summary.rejectedOffers > 0 ? `拒绝${summary.rejectedOffers}份报价` : null,
    summary.completedTargets > 0 ? `完成${summary.completedTargets}个引援目标` : null,
    summary.uncompletedTargets > 0 ? `未完成${summary.uncompletedTargets}个引援目标` : null,
  ].filter((item): item is string => Boolean(item));

  return {
    conclusion,
    details,
    cashChanged: summary.cashChanges.some(change => change.delta !== 0),
  };
}

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

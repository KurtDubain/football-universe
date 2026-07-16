import type { CoachStyle } from '../../types/coach';
import type { Player, PlayerPosition, PlayerSeasonStats } from '../../types/player';
import type { TeamBase } from '../../types/team';
import { computeInitialMarketValue } from '../economy/market-value';
import type { SeededRNG } from '../match/rng';

const POSITION_TARGETS: Record<PlayerPosition, number> = { GK: 3, DF: 7, MF: 7, FW: 5 };
const STARTER_TARGETS: Record<PlayerPosition, number> = { GK: 1, DF: 4, MF: 3, FW: 3 };

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[], fallback = 0): number {
  if (values.length === 0) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export interface PositionNeed {
  position: PlayerPosition;
  count: number;
  targetCount: number;
  starterQuality: number;
  depthQuality: number;
  needScore: number;
}

export type SquadNeeds = Record<PlayerPosition, PositionNeed>;
export type RecruitmentProfile = 'youth' | 'star' | 'value' | 'balanced';

export function deriveRecruitmentProfile(teamId: string): RecruitmentProfile {
  let hash = 2166136261;
  for (let index = 0; index < teamId.length; index++) {
    hash ^= teamId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (['youth', 'star', 'value', 'balanced'] as const)[(hash >>> 0) % 4];
}

/**
 * Build a compact squad profile once per transfer window. Need is relative to
 * the rest of the same squad, so both elite and lower-league clubs can identify
 * their own weak unit without relying on a universal rating threshold.
 */
export function assessSquadNeeds(squad: Player[]): SquadNeeds {
  const positions: PlayerPosition[] = ['GK', 'DF', 'MF', 'FW'];
  const squadQuality = average(squad.map((player) => player.rating), 60);
  const result = {} as SquadNeeds;

  for (const position of positions) {
    const players = squad
      .filter((player) => player.position === position)
      .sort((a, b) => b.rating - a.rating);
    const starterCount = STARTER_TARGETS[position];
    const starterQuality = average(players.slice(0, starterCount).map((player) => player.rating), squadQuality - 12);
    const depthQuality = average(players.slice(starterCount).map((player) => player.rating), starterQuality - 8);
    const shortage = clamp((POSITION_TARGETS[position] - players.length) / Math.max(1, POSITION_TARGETS[position]));
    const starterWeakness = clamp((squadQuality - starterQuality + 3) / 18);
    const depthWeakness = clamp((starterQuality - depthQuality - 4) / 18);
    const needScore = clamp(0.08 + shortage * 0.52 + starterWeakness * 0.28 + depthWeakness * 0.12);

    result[position] = {
      position,
      count: players.length,
      targetCount: POSITION_TARGETS[position],
      starterQuality,
      depthQuality,
      needScore,
    };
  }

  return result;
}

function tacticalFit(style: CoachStyle | undefined, position: PlayerPosition): number {
  if (!style || style === 'balanced') return 0.55;
  if (style === 'attacking') return position === 'FW' ? 1 : position === 'MF' ? 0.78 : 0.35;
  if (style === 'defensive') return position === 'GK' || position === 'DF' ? 1 : position === 'MF' ? 0.65 : 0.3;
  if (style === 'possession') return position === 'MF' ? 1 : position === 'DF' ? 0.7 : 0.5;
  return position === 'FW' || position === 'DF' ? 0.9 : 0.55;
}

function currentSeasonPerformance(player: Player, stats: PlayerSeasonStats | undefined): number {
  if (!stats || stats.appearances <= 0) return 0;
  const perAppearance = player.position === 'FW'
    ? (stats.goals + stats.assists * 0.45) / stats.appearances
    : player.position === 'MF'
      ? (stats.goals * 0.7 + stats.assists + stats.keyPasses * 0.08) / stats.appearances
      : player.position === 'DF'
        ? (stats.cleanSheets * 0.45 + stats.keyBlocks * 0.25) / stats.appearances
        : (stats.cleanSheets * 0.45 + stats.saves * 0.08) / stats.appearances;
  return clamp(perAppearance / (player.position === 'FW' ? 0.65 : 0.5));
}

export function isKeySquadPlayer(squad: Player[], player: Player): boolean {
  const positionPlayers = squad
    .filter((candidate) => candidate.position === player.position)
    .sort((a, b) => b.rating - a.rating);
  return positionPlayers.slice(0, STARTER_TARGETS[player.position]).some((candidate) => candidate.uuid === player.uuid);
}

export interface TransferFit {
  weight: number;
  needScore: number;
  upgradeScore: number;
  tacticalScore: number;
  reason: string;
}

export function scoreTransferFit(params: {
  player: Player;
  buyerSquad: Player[];
  buyer: TeamBase;
  seller?: TeamBase;
  coachStyle?: CoachStyle;
  availableCash?: number;
  expectedFee?: number;
  needs?: SquadNeeds;
  requireUpgrade?: boolean;
}): TransferFit {
  const { player, buyerSquad, buyer, seller, coachStyle } = params;
  const needs = params.needs ?? assessSquadNeeds(buyerSquad);
  const positionNeed = needs[player.position];
  const samePosition = buyerSquad
    .filter((candidate) => candidate.position === player.position)
    .sort((a, b) => a.rating - b.rating);
  const weakest = samePosition[0];
  const upgrade = weakest ? player.rating - weakest.rating : 15;
  const upgradeScore = clamp(upgrade / 15);
  const tacticalScore = tacticalFit(coachStyle, player.position);
  const ageScore = player.age <= 22
    ? 1
    : player.age <= 27
      ? 0.75
      : player.age <= 31
        ? 0.45
        : 0.18;
  const potentialScore = clamp(((player.peakRating ?? player.rating) - player.rating + 3) / 12);
  const reputationReach = seller
    ? clamp((buyer.reputation - seller.reputation + 20) / 40)
    : 0.6;
  const profile = deriveRecruitmentProfile(buyer.id);
  const valueBenchmark = Math.max(5, (player.rating - 55) * 1.5);
  const profileScore = profile === 'youth'
    ? clamp(ageScore * 0.55 + potentialScore * 0.45)
    : profile === 'star'
      ? clamp((player.rating - 72) / 18)
      : profile === 'value'
        ? clamp(valueBenchmark / Math.max(1, player.marketValue) - 0.25)
        : 0.55;

  let affordability = 1;
  if (Number.isFinite(params.availableCash) && (params.expectedFee ?? 0) > 0) {
    const availableCash = Math.max(0, params.availableCash ?? 0);
    const fee = params.expectedFee ?? 0;
    if (availableCash < fee) affordability = 0;
    else affordability = clamp(availableCash / Math.max(1, fee * 1.8), 0.35, 1);
  }

  const requiresUpgrade = params.requireUpgrade ?? true;
  const weight = affordability === 0 || (requiresUpgrade && upgrade <= 0)
    ? 0
    : Math.max(0.01,
      positionNeed.needScore * 3.1
      + upgradeScore * 3.4
      + tacticalScore * 0.8
      + ageScore * 0.45
      + potentialScore * 0.45
      + reputationReach * 0.35
      + profileScore * 0.65,
    ) * affordability;

  const profileReason = profile === 'youth' && profileScore >= 0.75
    ? '青训投资'
    : profile === 'star' && profileScore >= 0.75
      ? '追逐明星'
      : profile === 'value' && profileScore >= 0.75
        ? '性价比引援'
        : null;
  const reason = positionNeed.count < positionNeed.targetCount
    ? `${player.position}阵容缺口`
    : upgradeScore >= 0.65
      ? `${player.position}显著升级`
      : profileReason
        ? profileReason
        : tacticalScore >= 0.85
          ? '符合教练体系'
          : '增强阵容深度';

  return { weight, needScore: positionNeed.needScore, upgradeScore, tacticalScore, reason };
}

export function estimateTransferValue(params: {
  player: Player;
  sellerSquad: Player[];
  sellerCash?: number;
  stats?: PlayerSeasonStats;
}): number {
  const { player, sellerSquad, stats } = params;
  const baseValue = player.marketValue > 0 ? player.marketValue : computeInitialMarketValue(player);
  const keyPlayer = isKeySquadPlayer(sellerSquad, player);
  const samePositionCount = sellerSquad.filter((candidate) => candidate.position === player.position).length;
  const scarce = samePositionCount <= POSITION_TARGETS[player.position];
  const performance = currentSeasonPerformance(player, stats);
  const importanceMultiplier = 1 + (keyPlayer ? 0.16 : 0) + (scarce ? 0.08 : 0);
  const performanceMultiplier = 1 + performance * 0.16;
  const sellerCash = params.sellerCash;
  const financeMultiplier = sellerCash === undefined
    ? 1
    : sellerCash < 0
      ? 0.82
      : sellerCash < 20
        ? 0.92
        : sellerCash > 150
          ? 1.06
          : 1;
  const value = baseValue * importanceMultiplier * performanceMultiplier * financeMultiplier;
  return Math.max(1, Math.round(value * 10) / 10);
}

export function estimateBuyerValuation(params: {
  askingValue: number;
  fit: TransferFit;
  player: Player;
}): number {
  const youthPremium = params.player.age <= 22 ? 0.08 : params.player.age >= 32 ? -0.08 : 0;
  const multiplier = 0.88
    + params.fit.needScore * 0.18
    + params.fit.upgradeScore * 0.18
    + params.fit.tacticalScore * 0.07
    + youthPremium;
  return Math.max(1, Math.round(params.askingValue * clamp(multiplier, 0.78, 1.34) * 10) / 10);
}

export function estimateFreeAgentSigningCost(player: Player): number {
  const marketValue = player.marketValue > 0 ? player.marketValue : computeInitialMarketValue(player);
  const ageMultiplier = player.age <= 22 ? 1.12 : player.age >= 33 ? 0.82 : 1;
  const cost = (3 + marketValue * 0.2) * ageMultiplier;
  return Math.max(2, Math.min(25, Math.round(cost * 10) / 10));
}

export function createOpeningOffer(params: {
  askingValue: number;
  buyerValuation: number;
  availableCash?: number;
  rng: SeededRNG;
}): number {
  const randomMultiplier = params.rng.nextFloat(0.86, 1.02);
  const raw = Math.min(params.askingValue, params.buyerValuation) * randomMultiplier;
  const cashCap = Number.isFinite(params.availableCash)
    ? Math.max(0, params.availableCash ?? 0)
    : Number.POSITIVE_INFINITY;
  return Math.max(1, Math.round(Math.min(raw, cashCap) * 10) / 10);
}

export function weightedPick<T>(
  items: T[],
  getWeight: (item: T) => number,
  rng: SeededRNG,
): T | undefined {
  const weighted = items.map((item) => ({ item, weight: Math.max(0, getWeight(item)) }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return undefined;
  let roll = rng.next() * total;
  for (const entry of weighted) {
    roll -= entry.weight;
    if (roll <= 0) return entry.item;
  }
  return weighted.at(-1)?.item;
}

function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

export function sellerAcceptanceProbability(params: {
  bid: number;
  askingValue: number;
  sellerCash?: number;
  keyPlayer?: boolean;
}): number {
  if (params.bid <= 0 || params.askingValue <= 0) return 0;
  const ratio = params.bid / params.askingValue;
  if (ratio < 0.5) return 0;
  const urgency = params.sellerCash === undefined
    ? 0
    : params.sellerCash < 0
      ? 0.16
      : params.sellerCash < 20
        ? 0.08
        : params.sellerCash > 150
          ? -0.04
          : 0;
  const keyPenalty = params.keyPlayer ? 0.1 : 0;
  return clamp(logistic((ratio - 0.94) * 8) + urgency - keyPenalty, 0.01, 0.98);
}

export function counterAcceptanceProbability(params: {
  counterFee: number;
  buyerValuation: number;
  buyerCash?: number;
  needScore?: number;
}): number {
  if (params.counterFee <= 0 || params.buyerValuation <= 0) return 0;
  if (params.buyerCash !== undefined && params.buyerCash < params.counterFee) return 0;
  const ratio = params.counterFee / params.buyerValuation;
  if (ratio > 1.4) return 0;
  const needBonus = (params.needScore ?? 0.5) * 0.12;
  return clamp(logistic((1.03 - ratio) * 8) + needBonus, 0.01, 0.98);
}

export function suggestCounterFee(offer: {
  fee: number;
  marketValue?: number;
  buyerValuation?: number;
}): number {
  const marketAnchor = (offer.marketValue ?? offer.fee) * 1.05;
  const desired = Math.max(offer.fee * 1.18, marketAnchor);
  const softCap = offer.buyerValuation ? offer.buyerValuation * 1.16 : desired;
  return Math.max(1, Math.round(Math.min(desired, softCap) * 10) / 10);
}

import type { FeaturedPlayerReason, FeaturedPlayerSnapshot, MatchResult } from '../../types/match';
import type { CoachFormation } from '../../types/coach';
import type { Player, PlayerSeasonStats, PlayerTeamSeasonStats } from '../../types/player';
import { computePlayerPerformance, computeSegmentedPlayerPerformance } from './player-performance';
import { computeMatchPlayerImpacts } from './match-player-impact';
import { computePlayerMarginalImpacts, type PlayerMarginalImpact } from './player-marginal-impact';
import type { MatchdaySelection } from './injuries';
import { selectStartingEleven } from '../match/participation';

export const FAVORITE_PLAYER_LIMIT = 8;
export const LIVE_FEATURED_PLAYER_LIMIT = 5;
export const RISING_STAR_MAX_AGE = 22;

export const FEATURED_PLAYER_REASON_LABELS: Record<FeaturedPlayerReason, string> = {
  ability: '核心能力',
  form: '近期状态',
  defensive_anchor: '防线支柱',
  creator: '组织核心',
  finisher: '进攻终结点',
};

export const PLAYER_IMPACT_UNIT_LABELS: Record<FeaturedPlayerSnapshot['impactUnit'], string> = {
  attack: '锋线质量',
  midfield: '中场质量',
  defense: '防线质量',
};

export interface RecentPlayerForm {
  appearances: number;
  averageImpact: number;
  decisiveMatches: number;
  summaries: string[];
}

export interface StarObservationEntry {
  player: Player;
  seasonScore: number | null;
  confidence: number;
  recentForm: RecentPlayerForm | null;
  reason: FeaturedPlayerReason;
  /** Internal ordering only. UI must not render this as a public star score. */
  priority: number;
}

export interface StarObservationResult {
  worldFocus: StarObservationEntry[];
  risingStars: StarObservationEntry[];
}

interface PerformanceContext {
  playerStats: Record<string, PlayerSeasonStats>;
  playerStatSegments?: Record<string, PlayerTeamSeasonStats>;
  seasonStartLevels?: Record<string, 1 | 2 | 3>;
}

function performanceFor(
  player: Player,
  context: PerformanceContext,
  segmentsByPlayer?: Map<string, PlayerTeamSeasonStats[]>,
) {
  const stat = context.playerStats[player.uuid];
  const segments = segmentsByPlayer?.get(player.uuid) ?? [];
  return segments.length > 0
    ? computeSegmentedPlayerPerformance(
        player.position,
        segments,
        context.seasonStartLevels ?? {},
        stat,
      )
    : computePlayerPerformance(player.position, stat, context.seasonStartLevels?.[player.teamId]);
}

function reasonFor(player: Player, seasonStats?: PlayerSeasonStats): FeaturedPlayerReason {
  if (player.position === 'GK' || player.position === 'DF') return 'defensive_anchor';
  if (player.position === 'MF' && (seasonStats?.assists ?? 0) >= (seasonStats?.goals ?? 0)) return 'creator';
  if (player.position === 'FW' || (seasonStats?.goals ?? 0) > (seasonStats?.assists ?? 0)) return 'finisher';
  return seasonStats && (seasonStats.minutesPlayed ?? 0) >= 450 ? 'form' : 'ability';
}

function recentPriority(recent: RecentPlayerForm | undefined): number {
  if (!recent) return 50;
  return Math.max(35, Math.min(95, 45 + recent.averageImpact * 8 + recent.decisiveMatches * 3));
}

function qualifiesForWorldFocus(rating: number, seasonScore: number, confidence: number): boolean {
  return rating >= 86
    || (rating >= 82 && confidence >= 0.35 && seasonScore >= 74)
    || (confidence >= 0.5 && seasonScore >= 82);
}

function qualifiesAsRisingStar(player: Player, seasonScore: number, confidence: number): boolean {
  return player.age <= RISING_STAR_MAX_AGE
    && (player.rating >= 74 || (confidence >= 0.25 && seasonScore >= 70));
}

function buildSegmentsByPlayer(
  segments: Record<string, PlayerTeamSeasonStats> | undefined,
): Map<string, PlayerTeamSeasonStats[]> {
  const out = new Map<string, PlayerTeamSeasonStats[]>();
  for (const segment of Object.values(segments ?? {})) {
    const list = out.get(segment.playerId) ?? [];
    list.push(segment);
    out.set(segment.playerId, list);
  }
  return out;
}

export function buildRecentPlayerForm(
  results: MatchResult[],
  players: Map<string, Player>,
): Map<string, RecentPlayerForm> {
  const samples = new Map<string, Array<{ score: number; band: string; summary: string }>>();
  for (const result of results) {
    const totalHome = result.homeGoals + (result.etHomeGoals ?? 0);
    const totalAway = result.awayGoals + (result.etAwayGoals ?? 0);
    const winnerTeamId = totalHome > totalAway
      ? result.homeTeamId
      : totalAway > totalHome
        ? result.awayTeamId
        : null;
    const impacts = computeMatchPlayerImpacts({ ...result, winnerTeamId }, players);
    for (const impact of impacts) {
      if (impact.minutesPlayed <= 0) continue;
      const list = samples.get(impact.playerId) ?? [];
      list.push({ score: impact.score, band: impact.band, summary: impact.summary });
      if (list.length > 5) list.shift();
      samples.set(impact.playerId, list);
    }
  }

  const out = new Map<string, RecentPlayerForm>();
  for (const [playerId, entries] of samples) {
    out.set(playerId, {
      appearances: entries.length,
      averageImpact: entries.reduce((sum, entry) => sum + entry.score, 0) / entries.length,
      decisiveMatches: entries.filter(entry => entry.band === 'decisive').length,
      summaries: entries.map(entry => entry.summary).reverse(),
    });
  }
  return out;
}

export function selectStarObservations(
  players: Player[],
  context: PerformanceContext,
  recentForms: Map<string, RecentPlayerForm> = new Map(),
): StarObservationResult {
  const segmentsByPlayer = buildSegmentsByPlayer(context.playerStatSegments);
  const entries = players.map(player => {
    const performance = performanceFor(player, context, segmentsByPlayer);
    const recentForm = recentForms.get(player.uuid);
    const performanceScore = performance.eligible ? performance.seasonScore : 50;
    const priority = player.rating * 0.5
      + performanceScore * 0.3
      + recentPriority(recentForm) * 0.2;
    return {
      player,
      seasonScore: performance.eligible ? performance.seasonScore : null,
      confidence: performance.confidence,
      recentForm: recentForm ?? null,
      reason: reasonFor(player, context.playerStats[player.uuid]),
      priority,
    } satisfies StarObservationEntry;
  });

  const order = (left: StarObservationEntry, right: StarObservationEntry) =>
    right.priority - left.priority
    || right.player.rating - left.player.rating
    || left.player.uuid.localeCompare(right.player.uuid);

  return {
    worldFocus: entries
      .filter(entry => qualifiesForWorldFocus(
        entry.player.rating,
        entry.seasonScore ?? 50,
        entry.confidence,
      ))
      .sort(order),
    risingStars: entries
      .filter(entry => qualifiesAsRisingStar(
        entry.player,
        entry.seasonScore ?? 50,
        entry.confidence,
      ))
      .sort(order),
  };
}

interface MatchFeaturedInput extends PerformanceContext {
  homeStarters: Player[];
  awayStarters: Player[];
  marginalImpacts: PlayerMarginalImpact[];
}

export interface MatchFeaturedLineupsInput extends PerformanceContext {
  homeSquad?: Player[];
  awaySquad?: Player[];
  homeSelection?: MatchdaySelection;
  awaySelection?: MatchdaySelection;
  homeFormation: CoachFormation;
  awayFormation: CoachFormation;
}

export interface MatchFeaturedLineups {
  homeStarters: Player[];
  awayStarters: Player[];
  marginalImpacts: PlayerMarginalImpact[];
  featuredPlayers: FeaturedPlayerSnapshot[];
}

export function selectMatchFeaturedPlayers(input: MatchFeaturedInput): FeaturedPlayerSnapshot[] {
  const players = [...input.homeStarters, ...input.awayStarters];
  const segmentsByPlayer = buildSegmentsByPlayer(input.playerStatSegments);
  const marginalById = new Map(input.marginalImpacts.map(impact => [impact.playerId, impact]));

  return players.map(player => {
    const performance = performanceFor(player, input, segmentsByPlayer);
    const marginal = marginalById.get(player.uuid) ?? {
      playerId: player.uuid,
      unit: player.position === 'FW' ? 'attack' as const
        : player.position === 'MF' ? 'midfield' as const
          : 'defense' as const,
      value: 0,
    };
    const seasonScore = performance.eligible ? performance.seasonScore : 50;
    const qualifies = player.rating >= 90
      || (player.rating >= 85 && performance.confidence >= 0.55 && seasonScore >= 86)
      || (player.rating >= 85 && marginal.value >= 2.6);
    const priority = player.rating * 0.58
      + seasonScore * 0.27
      + Math.min(100, 50 + marginal.value * 18) * 0.15;
    return { player, performance, marginal, qualifies, priority };
  })
    .filter(entry => entry.qualifies)
    .sort((left, right) => right.priority - left.priority
      || right.marginal.value - left.marginal.value
      || left.player.uuid.localeCompare(right.player.uuid))
    .slice(0, LIVE_FEATURED_PLAYER_LIMIT)
    .map(({ player, performance, marginal }) => ({
      playerId: player.uuid,
      playerName: player.name,
      teamId: player.teamId,
      position: player.position,
      ratingAtKickoff: player.rating,
      ...(performance.eligible ? { seasonScoreAtKickoff: performance.seasonScore } : {}),
      marginalUnitImpact: marginal.value,
      impactUnit: marginal.unit,
      reason: reasonFor(player, input.playerStats[player.uuid]),
    }));
}

/** Shared pre-kickoff lineup and focus pipeline used by forecast and simulation. */
export function buildMatchFeaturedLineups(input: MatchFeaturedLineupsInput): MatchFeaturedLineups {
  const homeStarters = selectStartingEleven(
    input.homeSelection?.players ?? [],
    input.homeSelection?.unavailablePlayerIds,
    input.homeFormation,
  );
  const awayStarters = selectStartingEleven(
    input.awaySelection?.players ?? [],
    input.awaySelection?.unavailablePlayerIds,
    input.awayFormation,
  );
  const marginalImpacts = [
    ...computePlayerMarginalImpacts(
      homeStarters,
      input.homeSquad,
      input.homeFormation,
      input.homeSelection?.unavailablePlayerIds,
    ),
    ...computePlayerMarginalImpacts(
      awayStarters,
      input.awaySquad,
      input.awayFormation,
      input.awaySelection?.unavailablePlayerIds,
    ),
  ];
  return {
    homeStarters,
    awayStarters,
    marginalImpacts,
    featuredPlayers: selectMatchFeaturedPlayers({
      homeStarters,
      awayStarters,
      marginalImpacts,
      playerStats: input.playerStats,
      playerStatSegments: input.playerStatSegments,
      seasonStartLevels: input.seasonStartLevels,
    }),
  };
}

export function describeFeaturedMatchup(
  featuredPlayers: FeaturedPlayerSnapshot[],
  homeTeamId: string,
  awayTeamId: string,
): string | null {
  const home = featuredPlayers.find(player => player.teamId === homeTeamId);
  const away = featuredPlayers.find(player => player.teamId === awayTeamId);
  if (!home || !away) return null;
  const positions = new Set([home.position, away.position]);
  const title = positions.has('FW') && (positions.has('DF') || positions.has('GK'))
    ? '矛盾对决'
    : home.position === 'FW' && away.position === 'FW'
      ? '王牌对攻'
      : home.position === 'MF' && away.position === 'MF'
        ? '中场主导权'
        : '核心对话';
  return `${title} · ${home.playerName} vs ${away.playerName}`;
}

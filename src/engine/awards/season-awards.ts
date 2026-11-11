import { PlayerAward } from '../../types/award';
import { PlayerSeasonStats, Player, PlayerTeamSeasonStats, PlayerPosition } from '../../types/player';
import { TeamBase } from '../../types/team';
import { StandingEntry } from '../../types/league';
import { computePlayerPerformance, computeSegmentedPlayerPerformance } from '../players/player-performance';
import { sortStandings } from '../standings/standings';
import {
  ballonDorScore,
  buildBallonDorContextResolver,
  type TeamHonourLookup,
} from './ballon-dor';
import {
  goldenBootScore,
  placementOf,
  positionAwardScore,
  sampleGateMultiplier,
  tierNeutralScore,
  TIER_LABELS,
  type TeamPlacement,
} from './award-scoring';
import {
  BALLON_DOR_MIN_APPEARANCES,
  TIER_COEFFICIENT,
  YOUNG_PLAYER_TIER_COEFFICIENT,
  type LeagueTier,
} from './award-weights';
import type { WorldCupState } from '../../types/cup';

/**
 * Compute end-of-season player awards from final stats.
 *
 * Seven awards, all deterministic. Every coefficient lives in
 * `award-weights.ts`; the rationale is in docs/award-system-redesign.md.
 *
 * The invariant this file exists to hold: **tier and team weighting are applied
 * exactly once per award.** `seasonScore` already carries a 10% league-strength
 * term, so anything that also multiplies by a tier coefficient must first pass
 * through `tierNeutralScore`.
 *
 * - MVP (金球奖): tier-neutral season score × team achievement × tier × sample.
 * - Golden Boot (金靴奖): goals × tier coefficient.
 * - Best Forward / Midfielder / Defender / Goalkeeper: position quality ×
 *   availability × tier × light team factor × sample, top flight only.
 * - Young Player (最佳新星): tier-neutral season score × a deliberately milder
 *   tier coefficient, under-23, excluding same-season winners.
 */

/** Position awards share one scorer; only the position filter differs. */
const POSITION_AWARDS: ReadonlyArray<{ type: PlayerAward['type']; position: PlayerPosition }> = [
  { type: 'best_forward', position: 'FW' },
  { type: 'best_midfielder', position: 'MF' },
  { type: 'best_defender', position: 'DF' },
  { type: 'best_goalkeeper', position: 'GK' },
];

interface Candidate {
  stat: PlayerSeasonStats;
  player: Player;
  /** Ranking value for this specific award. */
  awardScore: number;
  minutes: number;
  leagueLevel: LeagueTier;
  positionQuality: number;
  /** Player-page season score, reported to the news line and the player page. */
  displayScore: number;
}

/**
 * Total order for award candidates.
 *
 * Every award ends with the same uuid tiebreak, so a winner never depends on
 * object-key insertion order. Before the redesign the Golden Boot used a bare
 * `goals > topGoals` scan, which handed ties to whichever row the stats record
 * happened to yield first — and disagreed with the season-review top-scorer
 * card, which breaks ties on assists.
 */
function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.awardScore !== b.awardScore) return b.awardScore - a.awardScore;
  if (a.stat.goals !== b.stat.goals) return b.stat.goals - a.stat.goals;
  if (a.stat.assists !== b.stat.assists) return b.stat.assists - a.stat.assists;
  if (a.minutes !== b.minutes) return b.minutes - a.minutes;
  return a.player.uuid.localeCompare(b.player.uuid);
}

function pickBest(candidates: Candidate[]): Candidate | null {
  let best: Candidate | null = null;
  for (const candidate of candidates) {
    if (best === null || compareCandidates(candidate, best) < 0) best = candidate;
  }
  return best;
}

export function computeSeasonAwards(
  seasonNumber: number,
  playerStats: Record<string, PlayerSeasonStats>,
  squads: Record<string, Player[]>,
  teamBases: Record<string, TeamBase>,
  league1Standings: StandingEntry[],
  playerStatSegments: Record<string, PlayerTeamSeasonStats> = {},
  seasonStartLevels: Record<string, LeagueTier> = {},
  honours: TeamHonourLookup = {},
  worldCup?: WorldCupState | null,
): PlayerAward[] {
  const awards: PlayerAward[] = [];
  const allStats = Object.values(playerStats);
  if (allStats.length === 0) return awards;

  // playerId is a stable Player.uuid, not the legacy `${teamId}-${number}`
  // string. Build both indexes once instead of rescanning the whole league for
  // every stat row — the previous lookup rebuilt an ~800-element array per call,
  // and the segment filter rescanned every segment per player.
  const playerByUuid = new Map<string, Player>();
  for (const squad of Object.values(squads)) {
    for (const player of squad) {
      if (!playerByUuid.has(player.uuid)) playerByUuid.set(player.uuid, player);
    }
  }

  const segmentsByPlayer = new Map<string, PlayerTeamSeasonStats[]>();
  for (const segment of Object.values(playerStatSegments)) {
    const existing = segmentsByPlayer.get(segment.playerId);
    if (existing) existing.push(segment);
    else segmentsByPlayer.set(segment.playerId, [segment]);
  }

  const findPlayer = (playerUuid: string): Player | undefined => playerByUuid.get(playerUuid);

  const performanceFor = (player: Player, stat: PlayerSeasonStats) => {
    const segments = segmentsByPlayer.get(player.uuid);
    return segments && segments.length > 0
      ? computeSegmentedPlayerPerformance(player.position, segments, seasonStartLevels, stat)
      : computePlayerPerformance(player.position, stat, seasonStartLevels[stat.teamId]);
  };

  const minutesOf = (stat: PlayerSeasonStats) => stat.minutesPlayed ?? stat.appearances * 90;
  const levelOf = (teamId: string): LeagueTier => seasonStartLevels[teamId] ?? 1;

  // Ranked once with the engine's own tiebreakers. Array order is not a ranking.
  const rankedStandings = sortStandings(league1Standings);
  const positionByTeam = new Map(rankedStandings.map((row, index) => [row.teamId, index + 1] as const));
  const topLeagueTeamIds = new Set(positionByTeam.keys());
  const leagueSize = rankedStandings.length;

  const placementFor = (teamId: string): TeamPlacement => {
    const leaguePosition = positionByTeam.get(teamId) ?? 0;
    return placementOf(leaguePosition, leaguePosition === 0 ? 0 : leagueSize, levelOf(teamId));
  };

  const buildAward = (
    type: PlayerAward['type'],
    candidate: Candidate,
    statValue: number,
    statLabel: string,
  ): PlayerAward | null => {
    const team = teamBases[candidate.stat.teamId];
    if (!team) return null;
    return {
      season: seasonNumber,
      type,
      playerId: candidate.stat.playerId,
      playerName: candidate.player.name ?? `${candidate.player.number}号`,
      playerNumber: candidate.player.number,
      teamId: candidate.stat.teamId,
      teamName: team.name,
      statValue,
      statLabel,
    };
  };

  /**
   * Candidate rows require a resolvable player and team. Filtering here rather
   * than at `buildAward` time means an unresolvable row (a released player with
   * stale stats, say) can never silently void an award — the prize falls to the
   * next genuine candidate instead.
   */
  const candidatesFrom = (
    stats: PlayerSeasonStats[],
    score: (stat: PlayerSeasonStats, player: Player) => number,
  ): Candidate[] => stats.flatMap((stat) => {
    const player = findPlayer(stat.playerId);
    if (!player || !teamBases[stat.teamId]) return [];
    const performance = performanceFor(player, stat);
    return [{
      stat,
      player,
      awardScore: score(stat, player),
      minutes: minutesOf(stat),
      leagueLevel: levelOf(stat.teamId),
      positionQuality: performance.positionQuality,
      displayScore: performance.seasonScore,
    }];
  });

  // ── MVP (金球奖) ─────────────────────────────────────────────
  // Ranked by the Ballon d'Or weighting, not the raw season score: team
  // achievement and league tier matter, and a thin sample cannot win.
  const contextFor = buildBallonDorContextResolver(
    league1Standings,
    honours,
    seasonStartLevels,
    worldCup,
  );

  const mvpCandidates = candidatesFrom(
    allStats.filter(s => s.appearances >= BALLON_DOR_MIN_APPEARANCES),
    (stat, player) => {
      const performance = performanceFor(player, stat);
      const minutes = minutesOf(stat);
      return ballonDorScore(tierNeutralScore(performance), contextFor(stat.teamId, minutes));
    },
  );

  const mvpBest = pickBest(mvpCandidates);
  if (mvpBest) {
    const score = Math.round(mvpBest.displayScore * 10) / 10;
    const award = buildAward('mvp', mvpBest, score, `赛季综合评分 ${score.toFixed(1)}`);
    if (award) awards.push(award);
  }

  // ── Golden Boot (金靴奖) ─────────────────────────────────────
  // Goals weighted by tier, the way the European Golden Shoe weights by league
  // coefficient. Ties resolve through the shared comparator, so this can no
  // longer disagree with the season-review top-scorer card.
  const bootCandidates = candidatesFrom(
    allStats.filter(s => s.goals > 0),
    (stat) => goldenBootScore(stat.goals, levelOf(stat.teamId)),
  );
  const bootBest = pickBest(bootCandidates);
  if (bootBest) {
    const coefficient = TIER_COEFFICIENT[bootBest.leagueLevel];
    const label = bootBest.leagueLevel === 1
      ? `${bootBest.stat.goals}球`
      : `${bootBest.stat.goals}球 · ${TIER_LABELS[bootBest.leagueLevel]}×${coefficient.toFixed(2)}`;
    const award = buildAward('golden_boot', bootBest, bootBest.awardScore, label);
    if (award) awards.push(award);
  }

  // ── Position awards ──────────────────────────────────────────
  // Top flight only, exactly as the defender and goalkeeper awards have always
  // been. Forwards and midfielders previously had no position award at all.
  for (const { type, position } of POSITION_AWARDS) {
    const positionStats: PlayerSeasonStats[] = [];
    for (const squad of Object.values(squads)) {
      for (const player of squad) {
        if (player.position !== position) continue;
        const stat = playerStats[player.uuid];
        // Eligibility uses the team the stats belong to (stat.teamId), not the
        // player's current club. A mid-season mover would otherwise be judged
        // against a different league than the one their numbers came from.
        if (!stat || !topLeagueTeamIds.has(stat.teamId)) continue;
        positionStats.push(stat);
      }
    }

    const positionCandidates = candidatesFrom(positionStats, (stat, player) => {
      const performance = performanceFor(player, stat);
      if (!performance.eligible) return Number.NEGATIVE_INFINITY;
      return positionAwardScore(performance, placementFor(stat.teamId), minutesOf(stat));
    }).filter(candidate => candidate.awardScore !== Number.NEGATIVE_INFINITY);

    const best = pickBest(positionCandidates);
    if (!best) continue;
    const award = buildAward(
      type,
      best,
      Math.round(best.awardScore * 10) / 10,
      `位置表现 ${best.positionQuality.toFixed(1)}`,
    );
    if (award) awards.push(award);
  }

  // ── Young Player (最佳新星) ──────────────────────────────────
  // True age eligibility, then the same attendance-aware season score used
  // elsewhere. The tier coefficient is milder than the general one on purpose:
  // this is the designated route for a standout in a smaller league.
  //
  // No "breakthrough" weighting: an award the player cannot reconstruct from
  // the displayed numbers is an award they cannot trust. Season-over-season
  // progress is shown as context on the buzz card instead.
  const exclude = new Set(awards.map(award => award.playerId));
  const youngCandidates = candidatesFrom(
    allStats.filter(s => !exclude.has(s.playerId)),
    (stat, player) => {
      if (player.age >= 23) return Number.NEGATIVE_INFINITY;
      const performance = performanceFor(player, stat);
      if (!performance.eligible) return Number.NEGATIVE_INFINITY;
      return tierNeutralScore(performance)
        * YOUNG_PLAYER_TIER_COEFFICIENT[levelOf(stat.teamId)]
        * sampleGateMultiplier(minutesOf(stat));
    },
  ).filter(candidate => candidate.awardScore !== Number.NEGATIVE_INFINITY);

  const youngBest = pickBest(youngCandidates);
  if (youngBest) {
    const score = Math.round(youngBest.displayScore * 10) / 10;
    const award = buildAward(
      'young_player',
      youngBest,
      score,
      `${youngBest.player.age}岁 · 赛季综合评分 ${score.toFixed(1)}`,
    );
    if (award) awards.push(award);
  }

  return awards;
}

/** Localized labels and emoji for each award type. */
export const AWARD_META: Record<
  PlayerAward['type'],
  { label: string; emoji: string; color: string }
> = {
  mvp: { label: '金球奖', emoji: '🏅', color: 'text-amber-400' },
  golden_boot: { label: '金靴奖', emoji: '👟', color: 'text-yellow-400' },
  best_forward: { label: '最佳前锋', emoji: '⚽', color: 'text-red-400' },
  best_midfielder: { label: '最佳中场', emoji: '🎯', color: 'text-green-400' },
  best_defender: { label: '最佳后卫', emoji: '🛡️', color: 'text-blue-400' },
  best_goalkeeper: { label: '最佳门将', emoji: '🧤', color: 'text-cyan-300' },
  young_player: { label: '最佳新星', emoji: '🌟', color: 'text-emerald-400' },
};

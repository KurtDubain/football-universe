import { PlayerAward } from '../../types/award';
import { PlayerSeasonStats, Player, PlayerTeamSeasonStats } from '../../types/player';
import { TeamBase } from '../../types/team';
import { StandingEntry } from '../../types/league';
import { computePlayerPerformance, computeSegmentedPlayerPerformance } from '../players/player-performance';
import {
  ballonDorScore,
  buildBallonDorContextResolver,
  type TeamHonourLookup,
} from './ballon-dor';
import type { WorldCupState } from '../../types/cup';

/**
 * Compute end-of-season player awards from final stats.
 *
 * - MVP (Ballon d'Or): `seasonScore` weighted by team achievement, league tier
 *   and sample size. The league table and `seasonStartLevels` are always
 *   supplied, so the title, top-four, relegation-zone and tier multipliers
 *   always apply; `honours` and `worldCup` only add the cup multipliers.
 * - Golden Boot: most goals across all leagues
 * - Best Defender / Goalkeeper: highest individual position score among
 *   top-league players with actual minutes
 * - Young Player: best eligible under-23 season performance
 */
export function computeSeasonAwards(
  seasonNumber: number,
  playerStats: Record<string, PlayerSeasonStats>,
  squads: Record<string, Player[]>,
  teamBases: Record<string, TeamBase>,
  league1Standings: StandingEntry[],
  playerStatSegments: Record<string, PlayerTeamSeasonStats> = {},
  seasonStartLevels: Record<string, 1 | 2 | 3> = {},
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

  const buildAward = (
    type: PlayerAward['type'],
    stat: PlayerSeasonStats,
    statValue: number,
    statLabel: string,
  ): PlayerAward | null => {
    const player = findPlayer(stat.playerId);
    const team = teamBases[stat.teamId];
    if (!player || !team) return null;
    return {
      season: seasonNumber,
      type,
      playerId: stat.playerId,
      playerName: player.name ?? `${player.number}号`,
      playerNumber: player.number,
      teamId: stat.teamId,
      teamName: team.name,
      statValue,
      statLabel,
    };
  };

  // ── MVP (金球奖) ─────────────────────────────────────────────
  // Ranked by the Ballon d'Or weighting, not the raw season score: team
  // achievement and league tier matter, and a thin sample cannot win.
  // Ties fall back to minutes played, then uuid, so the winner never depends
  // on object-key insertion order.
  const contextFor = buildBallonDorContextResolver(
    league1Standings,
    honours,
    seasonStartLevels,
    worldCup,
  );

  const mvpCandidates = allStats
    .filter(s => s.appearances >= 5)
    .map(s => {
      const player = findPlayer(s.playerId);
      if (!player) return null;
      const performance = performanceFor(player, s);
      const minutes = s.minutesPlayed ?? s.appearances * 90;
      return {
        stat: s,
        player,
        // Reported to the player page and the news line.
        seasonScore: performance.seasonScore,
        // Used only to rank award candidates.
        awardScore: ballonDorScore(performance.seasonScore, contextFor(s.teamId, minutes)),
        minutes,
      };
    })
    .filter((entry): entry is {
      stat: PlayerSeasonStats;
      player: Player;
      seasonScore: number;
      awardScore: number;
      minutes: number;
    } => entry !== null);

  const mvpBest = mvpCandidates.length > 0
    ? mvpCandidates.reduce((best, entry) => {
        if (entry.awardScore > best.awardScore) return entry;
        if (entry.awardScore < best.awardScore) return best;
        // Equal award score: more minutes wins, then stable uuid order.
        if (entry.minutes > best.minutes) return entry;
        if (entry.minutes < best.minutes) return best;
        return entry.player.uuid.localeCompare(best.player.uuid) < 0 ? entry : best;
      })
    : null;

  const mvpStat: PlayerSeasonStats | null = mvpBest ? mvpBest.stat : null;
  const mvpScoreValue = mvpBest ? Math.round(mvpBest.seasonScore * 10) / 10 : 0;
  if (mvpStat) {
    const a = buildAward('mvp', mvpStat, mvpScoreValue, `赛季综合评分 ${mvpScoreValue.toFixed(1)}`);
    if (a) awards.push(a);
  }

  // ── Golden Boot (金靴奖) ─────────────────────────────────────
  let topGoals = 0;
  let topGoalStat: PlayerSeasonStats | null = null;
  for (const s of allStats) {
    if (s.goals > topGoals) {
      topGoals = s.goals;
      topGoalStat = s;
    }
  }
  if (topGoalStat && topGoals > 0) {
    const a = buildAward('golden_boot', topGoalStat, topGoals, `${topGoals}球`);
    if (a) awards.push(a);
  }

  const topLeagueTeamIds = new Set(league1Standings.map(row => row.teamId));
  // Eligibility uses the team the stats belong to (stat.teamId), not the
  // player's current club. A mid-season mover would otherwise be judged
  // against a different league than the one their numbers came from.
  const rankedDefensivePlayer = (position: 'DF' | 'GK') => Object.values(squads)
    .flat()
    .filter(player => player.position === position)
    .map(player => ({
      player,
      stat: playerStats[player.uuid],
      performance: playerStats[player.uuid]
        ? performanceFor(player, playerStats[player.uuid])
        : computePlayerPerformance(position, undefined, 1),
    }))
    .filter(entry => entry.stat
      && entry.performance.eligible
      && topLeagueTeamIds.has(entry.stat.teamId))
    .sort((a, b) => b.performance.score - a.performance.score
      || (b.stat.minutesPlayed ?? 0) - (a.stat.minutesPlayed ?? 0)
      || a.player.uuid.localeCompare(b.player.uuid))[0];

  const bestDefender = rankedDefensivePlayer('DF');
  if (bestDefender) {
    const award = buildAward(
      'best_defender',
      bestDefender.stat,
      bestDefender.performance.score,
      `赛季综合评分 ${bestDefender.performance.score.toFixed(1)}`,
    );
    if (award) awards.push(award);
  }

  const bestGoalkeeper = rankedDefensivePlayer('GK');
  if (bestGoalkeeper) {
    const award = buildAward(
      'best_goalkeeper',
      bestGoalkeeper.stat,
      bestGoalkeeper.performance.score,
      `赛季综合评分 ${bestGoalkeeper.performance.score.toFixed(1)}`,
    );
    if (award) awards.push(award);
  }

  // ── Young Player (最佳新星) ──────────────────────────────────
  // True age eligibility. Keep the existing no-duplicate presentation rule,
  // then compare the same attendance-aware season score used elsewhere.
  const exclude = new Set(awards.map((a) => a.playerId));
  let youngTopStat: PlayerSeasonStats | null = null;
  let youngTopScore = -1;
  let youngTopAge = 0;
  for (const s of allStats) {
    if (exclude.has(s.playerId)) continue;
    const player = findPlayer(s.playerId);
    if (!player || player.age >= 23) continue;
    const performance = performanceFor(player, s);
    if (!performance.eligible) continue;
    if (performance.seasonScore > youngTopScore) {
      youngTopScore = performance.seasonScore;
      youngTopStat = s;
      youngTopAge = player.age;
    }
  }
  if (youngTopStat) {
    const roundedScore = Math.round(youngTopScore * 10) / 10;
    const a = buildAward(
      'young_player',
      youngTopStat,
      roundedScore,
      `${youngTopAge}岁 · 赛季综合评分 ${roundedScore.toFixed(1)}`,
    );
    if (a) awards.push(a);
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
  best_defender: { label: '最佳后卫', emoji: '🛡️', color: 'text-blue-400' },
  best_goalkeeper: { label: '最佳门将', emoji: '🧤', color: 'text-cyan-300' },
  young_player: { label: '最佳新星', emoji: '🌟', color: 'text-emerald-400' },
};

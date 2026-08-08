import { PlayerAward } from '../../types/award';
import { PlayerSeasonStats, Player, PlayerTeamSeasonStats } from '../../types/player';
import { TeamBase } from '../../types/team';
import { StandingEntry } from '../../types/league';
import { computePlayerPerformance, computeSegmentedPlayerPerformance } from '../players/player-performance';

/**
 * Compute end-of-season player awards from final stats.
 *
 * - MVP: highest attendance-aware cross-position season score
 * - Golden Boot: most goals across all leagues
 * - Best Defender / Goalkeeper: highest individual position score among
 *   top-league players with actual minutes
 * - Young Player: top scorer from a low-OVR team (team OVR < 70)
 */
export function computeSeasonAwards(
  seasonNumber: number,
  playerStats: Record<string, PlayerSeasonStats>,
  squads: Record<string, Player[]>,
  teamBases: Record<string, TeamBase>,
  league1Standings: StandingEntry[],
  playerStatSegments: Record<string, PlayerTeamSeasonStats> = {},
  seasonStartLevels: Record<string, 1 | 2 | 3> = {},
): PlayerAward[] {
  const awards: PlayerAward[] = [];
  const allStats = Object.values(playerStats);
  if (allStats.length === 0) return awards;

  // playerId is a stable Player.uuid, not the legacy `${teamId}-${number}`
  // string. We still need the teamId to find the right squad to scan.
  const findPlayer = (playerUuid: string, teamId: string): Player | undefined =>
    squads[teamId]?.find((p) => p.uuid === playerUuid)
    ?? Object.values(squads).flat().find((p) => p.uuid === playerUuid);

  const performanceFor = (player: Player, stat: PlayerSeasonStats) => {
    const segments = Object.values(playerStatSegments).filter(segment => segment.playerId === player.uuid);
    return segments.length > 0
      ? computeSegmentedPlayerPerformance(player.position, segments, seasonStartLevels, stat)
      : computePlayerPerformance(player.position, stat, seasonStartLevels[stat.teamId]);
  };

  const buildAward = (
    type: PlayerAward['type'],
    stat: PlayerSeasonStats,
    statValue: number,
    statLabel: string,
  ): PlayerAward | null => {
    const player = findPlayer(stat.playerId, stat.teamId);
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
  let mvpScore = -1;
  let mvpStat: PlayerSeasonStats | null = null;
  let mvpScoreValue = 0;
  for (const s of allStats) {
    if (s.appearances < 5) continue;
    const player = findPlayer(s.playerId, s.teamId);
    if (!player) continue;
    const score = performanceFor(player, s).seasonScore;
    if (score > mvpScore) {
      mvpScore = score;
      mvpStat = s;
      mvpScoreValue = Math.round(score * 10) / 10;
    }
  }
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
  const rankedDefensivePlayer = (position: 'DF' | 'GK') => Object.values(squads)
    .flat()
    .filter(player => player.position === position && topLeagueTeamIds.has(player.teamId))
    .map(player => ({
      player,
      stat: playerStats[player.uuid],
      performance: playerStats[player.uuid]
        ? performanceFor(player, playerStats[player.uuid])
        : computePlayerPerformance(position, undefined, 1),
    }))
    .filter(entry => entry.stat && entry.performance.eligible)
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
  // Top scorer from a team with overall < 70 (proxy for "young/underdog")
  // Skip MVP / Golden Boot winners to avoid duplicates
  const exclude = new Set(awards.map((a) => a.playerId));
  let youngTopGoals = 0;
  let youngTopStat: PlayerSeasonStats | null = null;
  for (const s of allStats) {
    if (exclude.has(s.playerId)) continue;
    const team = teamBases[s.teamId];
    if (!team || team.overall >= 70) continue;
    if (s.goals > youngTopGoals) {
      youngTopGoals = s.goals;
      youngTopStat = s;
    }
  }
  if (youngTopStat && youngTopGoals >= 5) {
    const a = buildAward(
      'young_player',
      youngTopStat,
      youngTopGoals,
      `弱队${youngTopGoals}球`,
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

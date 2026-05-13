import { PlayerAward } from '../../types/award';
import { PlayerSeasonStats, Player } from '../../types/player';
import { TeamBase } from '../../types/team';
import { StandingEntry } from '../../types/league';

/**
 * Compute end-of-season player awards from final stats.
 *
 * - MVP: highest weighted score (goals×3 + assists×2 + team_rank_bonus)
 * - Golden Boot: most goals across all leagues
 * - Best Defender: defender from team with best goals-against (top league only),
 *   who appeared in 80%+ of league matches
 * - Young Player: top scorer from a low-OVR team (team OVR < 70)
 */
export function computeSeasonAwards(
  seasonNumber: number,
  playerStats: Record<string, PlayerSeasonStats>,
  squads: Record<string, Player[]>,
  teamBases: Record<string, TeamBase>,
  league1Standings: StandingEntry[],
): PlayerAward[] {
  const awards: PlayerAward[] = [];
  const allStats = Object.values(playerStats);
  if (allStats.length === 0) return awards;

  // playerId is a stable Player.uuid, not the legacy `${teamId}-${number}`
  // string. We still need the teamId to find the right squad to scan.
  const findPlayer = (playerUuid: string, teamId: string): Player | undefined =>
    squads[teamId]?.find((p) => p.uuid === playerUuid);

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

  // Build a quick map: teamId → league rank (only top league for now)
  const teamLeagueRank: Record<string, number> = {};
  league1Standings.forEach((s, i) => {
    teamLeagueRank[s.teamId] = i + 1;
  });

  // ── MVP (金球奖) ─────────────────────────────────────────────
  // weighted = goals*3 + assists*2 + (top-league bonus from rank)
  // Only consider players with appearances >= 5
  let mvpScore = -1;
  let mvpStat: PlayerSeasonStats | null = null;
  let mvpScoreValue = 0;
  for (const s of allStats) {
    if (s.appearances < 5) continue;
    const rank = teamLeagueRank[s.teamId];
    const rankBonus = rank ? Math.max(0, 16 - rank) * 0.5 : 0; // top of L1 = +7.5
    const score = s.goals * 3 + s.assists * 2 + rankBonus;
    if (score > mvpScore) {
      mvpScore = score;
      mvpStat = s;
      mvpScoreValue = Math.round(score);
    }
  }
  if (mvpStat) {
    const a = buildAward('mvp', mvpStat, mvpScoreValue, `综合评分 ${mvpScoreValue}`);
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

  // ── Best Defender (最佳后卫) ─────────────────────────────────
  // From team with best goal difference among DF position with 80%+ appearances
  // Filter to top-league teams
  const sortedByDefense = [...league1Standings].sort(
    (a, b) => a.goalsAgainst - b.goalsAgainst,
  );
  const bestDefenseTeam = sortedByDefense[0];
  if (bestDefenseTeam && bestDefenseTeam.played > 0) {
    const teamSquad = squads[bestDefenseTeam.teamId] ?? [];
    const defenders = teamSquad.filter((p) => p.position === 'DF');
    // Pick defender with most appearances; tiebreak: highest rating
    let best: Player | null = null;
    let bestApps = 0;
    let bestRating = 0;
    for (const d of defenders) {
      const stat = playerStats[d.uuid];
      if (!stat) continue;
      const apps = stat.appearances;
      if (apps > bestApps || (apps === bestApps && d.rating > bestRating)) {
        best = d;
        bestApps = apps;
        bestRating = d.rating;
      }
    }
    if (best && bestApps >= bestDefenseTeam.played * 0.6) {
      const stat = playerStats[best.uuid];
      const award = buildAward(
        'best_defender',
        stat,
        bestDefenseTeam.goalsAgainst,
        `球队仅失${bestDefenseTeam.goalsAgainst}球`,
      );
      if (award) awards.push(award);
    }
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
  young_player: { label: '最佳新星', emoji: '🌟', color: 'text-emerald-400' },
};

import { Player, PlayerSeasonStats } from '../../types/player';
import { MatchResult } from '../../types/match';

/**
 * Create initial empty stats for all players in all squads.
 * Stats are keyed by `Player.uuid`, which is stable across transfers.
 */
export function createInitialPlayerStats(
  squads: Record<string, Player[]>,
): Record<string, PlayerSeasonStats> {
  const stats: Record<string, PlayerSeasonStats> = {};
  for (const [teamId, players] of Object.entries(squads)) {
    for (const p of players) {
      stats[p.uuid] = {
        playerId: p.uuid,
        teamId,
        goals: 0,
        assists: 0,
        yellowCards: 0,
        redCards: 0,
        appearances: 0,
      };
    }
  }
  return stats;
}

/**
 * Update player stats from match results.
 * Scan events for goals, cards, etc. and increment the matching player stats.
 */
export function updatePlayerStatsFromResults(
  currentStats: Record<string, PlayerSeasonStats>,
  results: MatchResult[],
  squads: Record<string, Player[]>,
): Record<string, PlayerSeasonStats> {
  const stats = { ...currentStats };

  for (const result of results) {
    // Mark appearances for matchday squad (top 14 by rating = 11 starters + 3 subs)
    const homeSquad = squads[result.homeTeamId];
    const awaySquad = squads[result.awayTeamId];
    const matchdaySize = 14;

    const pickMatchday = (squad: Player[] | undefined) => {
      if (!squad) return [];
      return [...squad].sort((a, b) => b.rating - a.rating).slice(0, matchdaySize);
    };

    for (const p of pickMatchday(homeSquad)) {
      if (!stats[p.uuid]) continue;
      stats[p.uuid] = { ...stats[p.uuid], appearances: stats[p.uuid].appearances + 1 };
    }
    for (const p of pickMatchday(awaySquad)) {
      if (!stats[p.uuid]) continue;
      stats[p.uuid] = { ...stats[p.uuid], appearances: stats[p.uuid].appearances + 1 };
    }

    // Process events
    for (const event of result.events) {
      if (!event.playerId || !stats[event.playerId]) continue;

      // Penalty shootout kicks (after the 120th minute) are NEVER counted as
      // regular goals — they decide the tie but do not inflate top-scorer
      // tables, market value, or any keep-stat aggregate downstream. The
      // shootout generator (engine/match/events.ts ~498) is the only emitter
      // of `penalty_goal`; regulation/extra-time penalties go through the
      // normal `goal` type. We belt-and-suspender both conditions so an
      // accidental future emitter at minute > 120 is also excluded.
      if (event.type === 'penalty_goal' || event.minute > 120) continue;

      const s = { ...stats[event.playerId] };

      switch (event.type) {
        case 'goal':
          s.goals++;
          break;
        case 'yellow_card':
          s.yellowCards++;
          break;
        case 'red_card':
          s.redCards++;
          break;
        case 'assist':
          s.assists++;
          break;
      }

      stats[event.playerId] = s;
    }
  }

  return stats;
}

/**
 * Get top scorers across all teams.
 */
export function getTopScorers(
  stats: Record<string, PlayerSeasonStats>,
  limit: number = 20,
): PlayerSeasonStats[] {
  return Object.values(stats)
    .filter((s) => s.goals > 0)
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists)
    .slice(0, limit);
}

/**
 * Get top assist providers.
 */
export function getTopAssists(
  stats: Record<string, PlayerSeasonStats>,
  limit: number = 20,
): PlayerSeasonStats[] {
  return Object.values(stats)
    .filter((s) => s.assists > 0)
    .sort((a, b) => b.assists - a.assists || b.goals - a.goals)
    .slice(0, limit);
}

/**
 * Build a `teamId → top scorer` map from current-season stats.
 *
 * Each entry is the player on that team with the most goals (ties broken
 * arbitrarily by insertion order). Teams with no scorers are NOT present
 * in the result — the caller decides whether to render a placeholder. The
 * helper does an O(N) walk over `stats`; callers that re-render frequently
 * should memoise the call against `playerStats`.
 *
 * Currently used by:
 *   - Dashboard FixtureCard (per-side top scorer line)
 *   - League page (per-row "最佳射手" column)
 */
export function getTopScorerByTeam(
  stats: Record<string, PlayerSeasonStats>,
): Record<string, PlayerSeasonStats> {
  const out: Record<string, PlayerSeasonStats> = {};
  for (const s of Object.values(stats)) {
    if (s.goals <= 0) continue;
    const cur = out[s.teamId];
    if (!cur || s.goals > cur.goals) {
      out[s.teamId] = s;
    }
  }
  return out;
}

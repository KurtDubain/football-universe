import { Player, PlayerSeasonStats } from '../../types/player';
import { MatchResult } from '../../types/match';

/**
 * Create initial empty stats for all players in all squads.
 */
export function createInitialPlayerStats(
  squads: Record<string, Player[]>,
): Record<string, PlayerSeasonStats> {
  const stats: Record<string, PlayerSeasonStats> = {};
  for (const [teamId, players] of Object.entries(squads)) {
    for (const p of players) {
      stats[p.id] = {
        playerId: p.id,
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
    // Mark appearances for all players in both squads
    const homeSquad = squads[result.homeTeamId];
    const awaySquad = squads[result.awayTeamId];
    if (homeSquad) {
      for (const p of homeSquad) {
        if (!stats[p.id]) continue;
        stats[p.id] = {
          ...stats[p.id],
          appearances: stats[p.id].appearances + 1,
        };
      }
    }
    if (awaySquad) {
      for (const p of awaySquad) {
        if (!stats[p.id]) continue;
        stats[p.id] = {
          ...stats[p.id],
          appearances: stats[p.id].appearances + 1,
        };
      }
    }

    // Process events
    for (const event of result.events) {
      if (!event.playerId || !stats[event.playerId]) continue;
      const s = { ...stats[event.playerId] };

      switch (event.type) {
        case 'goal':
        case 'penalty_goal':
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

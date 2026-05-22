import { Player, PlayerSeasonStats } from '../../types/player';
import { MatchResult } from '../../types/match';
import { pickMatchday as pickMatchdayWithDiscipline } from './injuries';

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
        cleanSheets: 0,
        saves: 0,
        keyBlocks: 0,
        bigChances: 0,
        keyPasses: 0,
      };
    }
  }
  return stats;
}

/**
 * Update player stats from match results.
 * Scan events for goals, cards, etc. and increment the matching player stats.
 *
 * Phase G: appearances are credited via the SAME pickMatchday filter used at
 * simulation time, so injured / suspended players don't get credited
 * "appeared in a match they weren't actually in".
 */
export function updatePlayerStatsFromResults(
  currentStats: Record<string, PlayerSeasonStats>,
  results: MatchResult[],
  squads: Record<string, Player[]>,
  globalWindowIdx: number = 0,
): Record<string, PlayerSeasonStats> {
  const stats = { ...currentStats };

  for (const result of results) {
    // Mark appearances for matchday squad (top 14 by rating = 11 starters + 3 subs)
    const homeSquad = squads[result.homeTeamId];
    const awaySquad = squads[result.awayTeamId];

    const homeMatchday = pickMatchdayWithDiscipline(homeSquad, globalWindowIdx) ?? [];
    const awayMatchday = pickMatchdayWithDiscipline(awaySquad, globalWindowIdx) ?? [];

    for (const p of homeMatchday) {
      if (!stats[p.uuid]) continue;
      stats[p.uuid] = { ...stats[p.uuid], appearances: stats[p.uuid].appearances + 1 };
    }
    for (const p of awayMatchday) {
      if (!stats[p.uuid]) continue;
      stats[p.uuid] = { ...stats[p.uuid], appearances: stats[p.uuid].appearances + 1 };
    }

    // v21 — credit clean sheets to DF/GK whenever the opposing side scored
    // 0 goals in regulation + extra time. Penalty shootouts are excluded
    // (shootout outcome doesn't count against the defence). Result fields
    // already separate `homeGoals`/`awayGoals` (regulation) from
    // `etHomeGoals`/`etAwayGoals` (extra time) and `penaltyHome`/`penaltyAway`
    // (shootout), so summing the first two is the right number.
    const awayConceded = result.awayGoals + (result.etAwayGoals ?? 0);
    const homeConceded = result.homeGoals + (result.etHomeGoals ?? 0);
    if (awayConceded === 0) {
      for (const p of homeMatchday) {
        if (!stats[p.uuid]) continue;
        if (p.position === 'DF' || p.position === 'GK') {
          stats[p.uuid] = { ...stats[p.uuid], cleanSheets: stats[p.uuid].cleanSheets + 1 };
        }
      }
    }
    if (homeConceded === 0) {
      for (const p of awayMatchday) {
        if (!stats[p.uuid]) continue;
        if (p.position === 'DF' || p.position === 'GK') {
          stats[p.uuid] = { ...stats[p.uuid], cleanSheets: stats[p.uuid].cleanSheets + 1 };
        }
      }
    }

    // Process events. The single source of truth — `goals` / `assists`
    // ONLY increment on `goal` / `assist` events. The derived metrics
    // (`bigChances`, `keyPasses`, `saves`, `keyBlocks`) are populated
    // here too, but never write back to `goals` / `assists`.
    //
    // INVARIANT (load-bearing): sum of `goals` across a team's squad
    // equals `result.homeGoals` (or `awayGoals`) at all times. Tested by
    // `stats.invariant.test.ts`.
    for (const event of result.events) {
      // Penalty shootout kicks (after the 120th minute) are NEVER counted as
      // regular goals — they decide the tie but do not inflate top-scorer
      // tables, market value, or any keep-stat aggregate downstream. The
      // shootout generator (engine/match/events.ts ~498) is the only emitter
      // of `penalty_goal`; regulation/extra-time penalties go through the
      // normal `goal` type. We belt-and-suspender both conditions so an
      // accidental future emitter at minute > 120 is also excluded.
      if (event.type === 'penalty_goal' || event.minute > 120) continue;

      // ── v22 deny-pipeline credits ────────────────────────────────
      // gk_save / df_block events carry `deniedScorerId` + optional
      // `deniedAssisterId`. The save/block defender gets saves++ or
      // keyBlocks++; the would-be scorer gets bigChances++; the would-be
      // assister gets keyPasses++. None of these touch goals/assists.
      if (event.type === 'gk_save' || event.type === 'df_block') {
        // Credit the defender (event.playerId is the GK or DF).
        if (event.playerId && stats[event.playerId]) {
          const s = { ...stats[event.playerId] };
          if (event.type === 'gk_save') s.saves++;
          else s.keyBlocks++;
          stats[event.playerId] = s;
        }
        // Credit the would-be scorer.
        if (event.deniedScorerId && stats[event.deniedScorerId]) {
          stats[event.deniedScorerId] = {
            ...stats[event.deniedScorerId],
            bigChances: stats[event.deniedScorerId].bigChances + 1,
          };
        }
        // Credit the would-be assister (if the original goal had one).
        if (event.deniedAssisterId && stats[event.deniedAssisterId]) {
          stats[event.deniedAssisterId] = {
            ...stats[event.deniedAssisterId],
            keyPasses: stats[event.deniedAssisterId].keyPasses + 1,
          };
        }
        continue;
      }

      // Standard goal / assist / card processing requires a playerId.
      if (!event.playerId || !stats[event.playerId]) continue;
      const s = { ...stats[event.playerId] };

      switch (event.type) {
        case 'goal':
          s.goals++;
          // v22 — bigChances is a SUPERSET of goals (= goals + denied
          // attempts). Increment in lockstep here so an actual goal
          // counts toward both.
          s.bigChances++;
          break;
        case 'yellow_card':
          // Phase G: yellow/red counters are folded by the injuries module
          // (which also handles suspension reset). Skip them here to avoid
          // double-counting.
          break;
        case 'red_card':
          break;
        case 'assist':
          s.assists++;
          // v22 — keyPasses superset of assists. Same rationale as above.
          s.keyPasses++;
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

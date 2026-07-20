import { Player, PlayerSeasonStats, PlayerTeamSeasonStats } from '../../types/player';
import { MatchResult } from '../../types/match';
import { pickMatchday as pickMatchdayWithDiscipline } from './injuries';
import { selectStartingEleven } from '../match/participation';

/**
 * Player-stat semantics, kept close to the update engine:
 *
 * - `goal` at minute <= 120 counts as a player goal and big chance. This
 *   includes open-play goals, set pieces, regular-time penalties, and
 *   extra-time penalties; the generator emits all of those as `goal`.
 * - `assist` at minute <= 120 counts as a player assist and key pass.
 * - `own_goal` is a team scoreline event only. It never increments the
 *   named player's normal scorer table totals.
 * - `penalty_goal` / `penalty_miss` are reserved for penalty shootouts.
 *   They decide cup ties but never inflate season goals, highlights, MotM,
 *   market value, or club contribution segments.
 * - `gk_save` / `df_block` add defensive credit and denied chance credit,
 *   but never mutate `goals` or `assists`.
 */

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
        starts: 0,
        substituteAppearances: 0,
        minutesPlayed: 0,
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

export function playerTeamStatKey(playerId: string, teamId: string): string {
  return `${playerId}@@${teamId}`;
}

export function emptyPlayerStat(playerId: string, teamId: string): PlayerSeasonStats {
  return {
    playerId,
    teamId,
    goals: 0,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
    appearances: 0,
    starts: 0,
    substituteAppearances: 0,
    minutesPlayed: 0,
    cleanSheets: 0,
    saves: 0,
    keyBlocks: 0,
    bigChances: 0,
    keyPasses: 0,
  };
}

export function createInitialPlayerStatSegments(
  squads: Record<string, Player[]>,
): Record<string, PlayerTeamSeasonStats> {
  const segments: Record<string, PlayerTeamSeasonStats> = {};
  for (const [teamId, players] of Object.entries(squads)) {
    for (const p of players) {
      segments[playerTeamStatKey(p.uuid, teamId)] = emptyPlayerStat(p.uuid, teamId);
    }
  }
  return segments;
}

/**
 * Backfill current-season `(playerId, teamId)` segments from the legacy
 * player-wide totals. Used for persisted saves created before segmented
 * stats existed. Historical pre-migration transfers are unrecoverable, so
 * those totals are attributed to the player's current team as the least
 * surprising compatibility fallback.
 */
export function createPlayerStatSegmentsFromTotals(
  playerStats: Record<string, PlayerSeasonStats> | undefined,
  squads: Record<string, Player[]> | undefined,
): Record<string, PlayerTeamSeasonStats> {
  const segments = createInitialPlayerStatSegments(squads ?? {});
  const activeTeamByPlayer = new Map<string, string>();

  for (const [teamId, players] of Object.entries(squads ?? {})) {
    for (const player of players ?? []) {
      activeTeamByPlayer.set(player.uuid, teamId);
    }
  }

  for (const stat of Object.values(playerStats ?? {})) {
    const teamId = activeTeamByPlayer.get(stat.playerId) ?? stat.teamId;
    segments[playerTeamStatKey(stat.playerId, teamId)] = {
      ...stat,
      teamId,
    };
  }

  return segments;
}

function ensureSegment(
  segments: Record<string, PlayerTeamSeasonStats>,
  playerId: string | undefined,
  teamId: string,
): PlayerTeamSeasonStats | null {
  if (!playerId) return null;
  const key = playerTeamStatKey(playerId, teamId);
  if (!segments[key]) segments[key] = emptyPlayerStat(playerId, teamId);
  return segments[key];
}

type StatMatchdayPlayer = Pick<Player, 'uuid' | 'position'> & {
  role: 'starter' | 'bench';
  minutesPlayed: number;
};

function resolveResultMatchday(
  result: MatchResult,
  side: 'home' | 'away',
  squad: Player[] | undefined,
  globalWindowIdx: number,
): StatMatchdayPlayer[] {
  const snapshot = side === 'home' ? result.homeMatchday : result.awayMatchday;
  if (snapshot) {
    return snapshot.players.filter(player => (player.minutesPlayed ?? 90) > 0).map((player) => ({
      uuid: player.playerId,
      position: player.position,
      role: player.role ?? 'starter',
      minutesPlayed: player.minutesPlayed ?? 90,
    }));
  }
  const matchday = pickMatchdayWithDiscipline(squad, globalWindowIdx) ?? [];
  const starterIds = new Set(selectStartingEleven(matchday).map(player => player.uuid));
  return matchday
    .filter(player => starterIds.has(player.uuid))
    .map(player => ({ ...player, role: 'starter' as const, minutesPlayed: 90 }));
}

function addParticipation(stat: PlayerSeasonStats, player: StatMatchdayPlayer): PlayerSeasonStats {
  return {
    ...stat,
    appearances: stat.appearances + 1,
    starts: (stat.starts ?? 0) + (player.role === 'starter' ? 1 : 0),
    substituteAppearances: (stat.substituteAppearances ?? 0) + (player.role === 'bench' ? 1 : 0),
    minutesPlayed: (stat.minutesPlayed ?? 0) + player.minutesPlayed,
  };
}

/**
 * Update `(playerId, teamId)` contribution segments from match results.
 *
 * Unlike `playerStats`, these rows are deliberately NOT re-pointed on
 * transfer. If a player scores 8 for Team A then moves to Team B, the Team A
 * segment keeps those 8 goals and the Team B segment starts from zero.
 */
export function updatePlayerStatSegmentsFromResults(
  currentSegments: Record<string, PlayerTeamSeasonStats>,
  results: MatchResult[],
  squads: Record<string, Player[]>,
  globalWindowIdx: number = 0,
): Record<string, PlayerTeamSeasonStats> {
  const segments: Record<string, PlayerTeamSeasonStats> = { ...currentSegments };

  for (const result of results) {
    const homeSquad = squads[result.homeTeamId];
    const awaySquad = squads[result.awayTeamId];
    const homeMatchday = resolveResultMatchday(result, 'home', homeSquad, globalWindowIdx);
    const awayMatchday = resolveResultMatchday(result, 'away', awaySquad, globalWindowIdx);

    for (const p of homeMatchday) {
      const s = ensureSegment(segments, p.uuid, result.homeTeamId);
      if (s) segments[playerTeamStatKey(p.uuid, result.homeTeamId)] = addParticipation(s, p);
    }
    for (const p of awayMatchday) {
      const s = ensureSegment(segments, p.uuid, result.awayTeamId);
      if (s) segments[playerTeamStatKey(p.uuid, result.awayTeamId)] = addParticipation(s, p);
    }

    const awayConceded = result.awayGoals + (result.etAwayGoals ?? 0);
    const homeConceded = result.homeGoals + (result.etHomeGoals ?? 0);
    if (awayConceded === 0) {
      for (const p of homeMatchday) {
        if (p.position !== 'DF' && p.position !== 'GK') continue;
        const s = ensureSegment(segments, p.uuid, result.homeTeamId);
        if (s) segments[playerTeamStatKey(p.uuid, result.homeTeamId)] = { ...s, cleanSheets: s.cleanSheets + 1 };
      }
    }
    if (homeConceded === 0) {
      for (const p of awayMatchday) {
        if (p.position !== 'DF' && p.position !== 'GK') continue;
        const s = ensureSegment(segments, p.uuid, result.awayTeamId);
        if (s) segments[playerTeamStatKey(p.uuid, result.awayTeamId)] = { ...s, cleanSheets: s.cleanSheets + 1 };
      }
    }

    for (const event of result.events) {
      if (event.type === 'penalty_goal' || event.minute > 120) continue;
      if (event.type === 'gk_save' || event.type === 'df_block') {
        const defender = ensureSegment(segments, event.playerId, event.teamId);
        if (defender) {
          const key = playerTeamStatKey(defender.playerId, defender.teamId);
          segments[key] = event.type === 'gk_save'
            ? { ...defender, saves: defender.saves + 1 }
            : { ...defender, keyBlocks: defender.keyBlocks + 1 };
        }
        const attackingTeamId = event.teamId === result.homeTeamId
          ? result.awayTeamId
          : result.homeTeamId;
        const scorer = ensureSegment(segments, event.deniedScorerId, attackingTeamId);
        if (scorer) {
          segments[playerTeamStatKey(scorer.playerId, scorer.teamId)] = {
            ...scorer,
            bigChances: scorer.bigChances + 1,
          };
        }
        const assister = ensureSegment(segments, event.deniedAssisterId, attackingTeamId);
        if (assister) {
          segments[playerTeamStatKey(assister.playerId, assister.teamId)] = {
            ...assister,
            keyPasses: assister.keyPasses + 1,
          };
        }
        continue;
      }

      const segment = ensureSegment(segments, event.playerId, event.teamId);
      if (!segment) continue;
      const key = playerTeamStatKey(segment.playerId, segment.teamId);
      switch (event.type) {
        case 'goal':
          segments[key] = {
            ...segment,
            goals: segment.goals + 1,
            bigChances: segment.bigChances + 1,
          };
          break;
        case 'assist':
          segments[key] = {
            ...segment,
            assists: segment.assists + 1,
            keyPasses: segment.keyPasses + 1,
          };
          break;
      }
    }
  }

  return segments;
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
    // Participation is derived from the persisted match snapshot. Unused
    // bench players have zero minutes and never reach this list.
    const homeSquad = squads[result.homeTeamId];
    const awaySquad = squads[result.awayTeamId];

    const homeMatchday = resolveResultMatchday(result, 'home', homeSquad, globalWindowIdx);
    const awayMatchday = resolveResultMatchday(result, 'away', awaySquad, globalWindowIdx);

    for (const p of homeMatchday) {
      if (!stats[p.uuid]) continue;
      stats[p.uuid] = addParticipation(stats[p.uuid], p);
    }
    for (const p of awayMatchday) {
      if (!stats[p.uuid]) continue;
      stats[p.uuid] = addParticipation(stats[p.uuid], p);
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

/**
 * Build a `teamId → top scorer` map from club-specific current-season
 * contribution segments. Falls back to the legacy player-wide totals when
 * a migrated save has not yet populated `playerStatSegments`.
 */
export function getTopScorerByTeamFromSegments(
  segments: Record<string, PlayerTeamSeasonStats> | undefined,
  fallbackStats: Record<string, PlayerSeasonStats> = {},
): Record<string, PlayerSeasonStats> {
  const source = segments && Object.keys(segments).length > 0
    ? segments
    : fallbackStats;
  return getTopScorerByTeam(source);
}

/**
 * v23.1 — Reconcile every `playerStats[uuid].teamId` with the player's
 * CURRENT location in `squads`. Idempotent and cheap (O(N) over squads).
 *
 * Why this exists: most engine paths keep `stats.teamId` in lockstep
 * (auto-transfer in transfer-window.ts and the manual paths in
 * transfer-window-actions.ts both call this after moving a player).
 * This helper is the "belt" — call it whenever you suspect drift, e.g.
 * right before computing season-end awards or before reading
 * per-team aggregates over `playerStats`. Stat rows whose uuid no
 * longer appears in any squad (player retired without an explicit
 * cleanup) are passed through untouched.
 */
export function syncPlayerStatsTeamIds(
  playerStats: Record<string, PlayerSeasonStats>,
  squads: Record<string, Player[]>,
): Record<string, PlayerSeasonStats> {
  const uuidToTeam = new Map<string, string>();
  for (const [tid, sq] of Object.entries(squads)) {
    for (const p of sq) uuidToTeam.set(p.uuid, tid);
  }
  let touched = false;
  const out: Record<string, PlayerSeasonStats> = {};
  for (const [uuid, stat] of Object.entries(playerStats)) {
    const liveTeam = uuidToTeam.get(uuid);
    if (liveTeam && liveTeam !== stat.teamId) {
      out[uuid] = { ...stat, teamId: liveTeam };
      touched = true;
    } else {
      out[uuid] = stat;
    }
  }
  // Season-end youth replacements and returning free agents can enter an
  // active squad without an existing current-season row. Create it here so
  // a following World Cup fixture cannot silently drop their contribution.
  for (const [uuid, teamId] of uuidToTeam) {
    if (out[uuid]) continue;
    out[uuid] = emptyPlayerStat(uuid, teamId);
    touched = true;
  }
  return touched ? out : playerStats;
}

export function syncPlayerStatSegments(
  playerStatSegments: Record<string, PlayerTeamSeasonStats>,
  squads: Record<string, Player[]>,
): Record<string, PlayerTeamSeasonStats> {
  let out = playerStatSegments;
  for (const [teamId, squad] of Object.entries(squads)) {
    for (const player of squad) {
      const key = playerTeamStatKey(player.uuid, teamId);
      if (out[key]) continue;
      if (out === playerStatSegments) out = { ...playerStatSegments };
      out[key] = emptyPlayerStat(player.uuid, teamId);
    }
  }
  return out;
}

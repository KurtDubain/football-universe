import { Player, PlayerSeasonStats, PlayerTeamSeasonStats } from '../../types/player';
import { MatchResult } from '../../types/match';
import { pickMatchday as pickMatchdayWithDiscipline } from './injuries';
import { selectStartingEleven } from '../match/participation';
import {
  createEmptyPlayerStatCounters,
  PLAYER_STAT_COUNTER_FIELDS,
  type PlayerStatCounterField,
  type PlayerStatCounterRecord,
} from './player-stat-fields';

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
        ...createEmptyPlayerStatCounters(),
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
    ...createEmptyPlayerStatCounters(),
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
  enteredMinute: number;
  exitedMinute: number;
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
      enteredMinute: player.enteredMinute ?? 0,
      exitedMinute: player.exitedMinute ?? result[side === 'home' ? 'homeMatchday' : 'awayMatchday']?.durationMinutes ?? 90,
    }));
  }
  const matchday = pickMatchdayWithDiscipline(squad, globalWindowIdx) ?? [];
  const starterIds = new Set(selectStartingEleven(matchday).map(player => player.uuid));
  return matchday
    .filter(player => starterIds.has(player.uuid))
    .map(player => ({ ...player, role: 'starter' as const, minutesPlayed: 90, enteredMinute: 0, exitedMinute: 90 }));
}

type PlayerStatDelta = PlayerStatCounterRecord & { playerId: string; teamId: string };

function emptyPlayerStatDelta(playerId: string, teamId: string): PlayerStatDelta {
  return { playerId, teamId, ...createEmptyPlayerStatCounters() };
}

function incrementDelta(
  deltas: Map<string, PlayerStatDelta>,
  playerId: string | undefined,
  teamId: string,
  updates: Partial<Record<PlayerStatCounterField, number>>,
): void {
  if (!playerId) return;
  const delta = deltas.get(playerId) ?? emptyPlayerStatDelta(playerId, teamId);
  for (const field of Object.keys(updates) as PlayerStatCounterField[]) {
    delta[field] += updates[field] ?? 0;
  }
  deltas.set(playerId, delta);
}

function onPitch(player: StatMatchdayPlayer, minute: number, duration: number): boolean {
  const normalizedMinute = Math.min(minute, duration - 1);
  return player.enteredMinute <= normalizedMinute && player.exitedMinute > normalizedMinute;
}

function buildMatchStatDeltas(
  result: MatchResult,
  squads: Record<string, Player[]>,
  globalWindowIdx: number,
): Map<string, PlayerStatDelta> {
  const deltas = new Map<string, PlayerStatDelta>();
  const homeMatchday = resolveResultMatchday(result, 'home', squads[result.homeTeamId], globalWindowIdx);
  const awayMatchday = resolveResultMatchday(result, 'away', squads[result.awayTeamId], globalWindowIdx);
  const duration = result.homeMatchday?.durationMinutes ?? result.awayMatchday?.durationMinutes ?? (result.extraTime ? 120 : 90);
  // The season manager passes the post-match counter for legacy stat
  // fallback. Availability itself was evaluated at the preceding index.
  const matchWindowIndex = Math.max(0, globalWindowIdx - 1);

  for (const [teamId, matchday, cleanSheet] of [
    [result.homeTeamId, homeMatchday, result.awayGoals + (result.etAwayGoals ?? 0) === 0],
    [result.awayTeamId, awayMatchday, result.homeGoals + (result.etHomeGoals ?? 0) === 0],
  ] as const) {
    const appearedIds = new Set(matchday.map(player => player.uuid));
    for (const player of squads[teamId] ?? []) {
      const appeared = appearedIds.has(player.uuid);
      const injuryAbsent = !appeared && (player.injuredUntilWindow ?? 0) > matchWindowIndex;
      incrementDelta(deltas, player.uuid, teamId, {
        teamMatchesAllCompetitions: 1,
        missedMatches: appeared ? 0 : 1,
        injuryAbsenceMatches: injuryAbsent ? 1 : 0,
      });
    }
    for (const player of matchday) {
      const isDefensivePosition = player.position === 'GK' || player.position === 'DF';
      incrementDelta(deltas, player.uuid, teamId, {
        appearances: 1,
        starts: player.role === 'starter' ? 1 : 0,
        substituteAppearances: player.role === 'bench' ? 1 : 0,
        minutesPlayed: player.minutesPlayed,
        cleanSheets: cleanSheet && isDefensivePosition && player.minutesPlayed >= 60 ? 1 : 0,
        cleanSheetMinutes: cleanSheet && isDefensivePosition ? player.minutesPlayed : 0,
      });
    }
  }

  const matchdayByTeam = new Map<string, StatMatchdayPlayer[]>([
    [result.homeTeamId, homeMatchday],
    [result.awayTeamId, awayMatchday],
  ]);
  const opposingTeamId = (teamId: string) => teamId === result.homeTeamId ? result.awayTeamId : result.homeTeamId;

  for (const event of result.events) {
    if (event.type === 'penalty_goal' || event.type === 'penalty_miss' || event.minute > 120) continue;
    if (event.type === 'goal' || event.type === 'own_goal') {
      if (event.type === 'goal') {
        incrementDelta(deltas, event.playerId, event.teamId, { goals: 1, bigChances: 1 });
      }
      const defendingTeamId = opposingTeamId(event.teamId);
      for (const player of matchdayByTeam.get(defendingTeamId) ?? []) {
        if ((player.position !== 'GK' && player.position !== 'DF') || !onPitch(player, event.minute, duration)) continue;
        incrementDelta(deltas, player.uuid, defendingTeamId, {
          goalsConcededWhileOnPitch: 1,
          shotsOnTargetFaced: player.position === 'GK' ? 1 : 0,
        });
      }
      continue;
    }
    if (event.type === 'assist') {
      incrementDelta(deltas, event.playerId, event.teamId, { assists: 1, keyPasses: 1 });
      continue;
    }
    if (event.type === 'save') {
      incrementDelta(deltas, event.playerId, event.teamId, { routineSaves: 1, shotsOnTargetFaced: 1 });
      continue;
    }
    if (event.type !== 'gk_save' && event.type !== 'df_block') continue;
    incrementDelta(deltas, event.playerId, event.teamId, event.type === 'gk_save'
      ? { saves: 1, shotsOnTargetFaced: 1 }
      : { keyBlocks: 1 });
    const attackingTeamId = opposingTeamId(event.teamId);
    incrementDelta(deltas, event.deniedScorerId, attackingTeamId, { bigChances: 1 });
    incrementDelta(deltas, event.deniedAssisterId, attackingTeamId, { keyPasses: 1 });
  }

  for (const contribution of Object.values(result.defensiveContributions ?? {})) {
    const participant = (matchdayByTeam.get(contribution.teamId) ?? [])
      .find(player => player.uuid === contribution.playerId && player.minutesPlayed > 0);
    if (!participant) continue;
    if (participant.position === 'DF') {
      incrementDelta(deltas, contribution.playerId, contribution.teamId, {
        interceptions: Math.max(0, Math.trunc(contribution.interceptions)),
        clearances: Math.max(0, Math.trunc(contribution.clearances)),
      });
    } else if (participant.position === 'GK') {
      const routineSaves = Math.max(0, Math.trunc(contribution.routineSaves ?? 0));
      incrementDelta(deltas, contribution.playerId, contribution.teamId, {
        routineSaves,
        shotsOnTargetFaced: routineSaves,
      });
    }
  }
  return deltas;
}

function applyStatDelta(stat: PlayerSeasonStats, delta: PlayerStatDelta): PlayerSeasonStats {
  const next = { ...stat };
  const legacyTeamMatches = stat.teamMatchesAllCompetitions ?? stat.appearances;
  for (const field of PLAYER_STAT_COUNTER_FIELDS) {
    const current = Number(
      next[field]
      ?? (field === 'teamMatchesAllCompetitions' ? legacyTeamMatches : 0),
    );
    (next[field] as number | undefined) = current + delta[field];
  }
  return next;
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
    for (const delta of buildMatchStatDeltas(result, squads, globalWindowIdx).values()) {
      const segment = ensureSegment(segments, delta.playerId, delta.teamId);
      if (!segment) continue;
      segments[playerTeamStatKey(delta.playerId, delta.teamId)] = applyStatDelta(segment, delta);
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
    for (const delta of buildMatchStatDeltas(result, squads, globalWindowIdx).values()) {
      if (!stats[delta.playerId]) continue;
      stats[delta.playerId] = applyStatDelta(stats[delta.playerId], delta);
    }
  }

  return stats;
}

/**
 * Update player-wide totals and club segments from one shared event scan.
 * The season engine always needs both views, so collecting match deltas once
 * avoids resolving lineups and defensive events twice on every advance.
 */
export function updatePlayerStatsAndSegmentsFromResults(
  currentStats: Record<string, PlayerSeasonStats>,
  currentSegments: Record<string, PlayerTeamSeasonStats>,
  results: MatchResult[],
  squads: Record<string, Player[]>,
  globalWindowIdx: number = 0,
): {
  playerStats: Record<string, PlayerSeasonStats>;
  playerStatSegments: Record<string, PlayerTeamSeasonStats>;
} {
  const playerStats = { ...currentStats };
  const playerStatSegments = { ...currentSegments };

  for (const result of results) {
    for (const delta of buildMatchStatDeltas(result, squads, globalWindowIdx).values()) {
      const stat = playerStats[delta.playerId];
      if (stat) playerStats[delta.playerId] = applyStatDelta(stat, delta);
      const segment = ensureSegment(playerStatSegments, delta.playerId, delta.teamId);
      if (segment) {
        playerStatSegments[playerTeamStatKey(delta.playerId, delta.teamId)] = applyStatDelta(
          segment,
          delta,
        );
      }
    }
  }

  return { playerStats, playerStatSegments };
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
 * transfer-window-actions.ts also calls this after moving a player).
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

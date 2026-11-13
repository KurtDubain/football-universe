import type { PlayerAward, PlayerAwardType } from '../types/award';
import type { PlayerPosition } from '../types/player';
import { PLAYER_AWARD_LABELS, PLAYER_AWARD_PRECEDENCE } from '../engine/players/player-honors';

export type AwardTypeFilter = 'all' | PlayerAwardType;
export type AwardSeasonWindow = 'all' | '10' | '25' | '50';
export type AwardView = 'records' | 'leaders';

export interface AwardFilters {
  type: AwardTypeFilter;
  seasons: AwardSeasonWindow;
  /** `'all'` or a team id present in the current world. */
  teamId: string;
}

export const DEFAULT_AWARD_FILTERS: AwardFilters = { type: 'all', seasons: 'all', teamId: 'all' };

export const AWARD_SEASON_WINDOW_OPTIONS: readonly { value: AwardSeasonWindow; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: '10', label: '最近 10 季' },
  { value: '25', label: '最近 25 季' },
  { value: '50', label: '最近 50 季' },
];

export const AWARD_TYPE_FILTER_OPTIONS: readonly { value: AwardTypeFilter; label: string }[] = [
  { value: 'all', label: '全部奖项' },
  ...PLAYER_AWARD_PRECEDENCE.map((type) => ({ value: type as AwardTypeFilter, label: PLAYER_AWARD_LABELS[type] })),
];

const AWARD_TYPE_VALUES = new Set<string>(['all', ...PLAYER_AWARD_PRECEDENCE]);
const AWARD_WINDOW_VALUES = new Set<string>(['all', '10', '25', '50']);

/**
 * Persisted filters are optional on old saves and may name a team that no
 * longer exists, so every field falls back rather than throwing.
 */
export function normalizeAwardFilters(
  value: unknown,
  validTeamIds?: ReadonlySet<string>,
): AwardFilters {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof AwardFilters, unknown>>;
  const type = typeof raw.type === 'string' && AWARD_TYPE_VALUES.has(raw.type)
    ? raw.type as AwardTypeFilter
    : 'all';
  const seasons = typeof raw.seasons === 'string' && AWARD_WINDOW_VALUES.has(raw.seasons)
    ? raw.seasons as AwardSeasonWindow
    : 'all';
  const rawTeamId = typeof raw.teamId === 'string' && raw.teamId !== '' ? raw.teamId : 'all';
  const teamId = rawTeamId !== 'all' && validTeamIds && !validTeamIds.has(rawTeamId) ? 'all' : rawTeamId;
  return { type, seasons, teamId };
}

/**
 * One award per (season, type, playerId).
 *
 * Retained career summaries and the live history array overlap after saving, so
 * the raw array can hold the same win twice.
 */
export function dedupeAwards(awards: readonly PlayerAward[]): PlayerAward[] {
  const unique = new Map<string, PlayerAward>();
  for (const award of awards ?? []) {
    if (!award) continue;
    unique.set(`${award.season}:${award.type}:${award.playerId}`, award);
  }
  return [...unique.values()];
}

export function filterAwards(
  awards: readonly PlayerAward[],
  filters: AwardFilters,
  currentSeason: number,
): PlayerAward[] {
  const windowSize = filters.seasons === 'all' ? null : Number(filters.seasons);
  const cutoff = windowSize === null ? null : currentSeason - windowSize + 1;
  return dedupeAwards(awards).filter((award) =>
    (filters.type === 'all' || award.type === filters.type)
    && (filters.teamId === 'all' || award.teamId === filters.teamId)
    && (cutoff === null || award.season >= cutoff),
  );
}

/** Season-descending detail feed for the 获奖记录 view. */
export function sortAwardRecords(awards: readonly PlayerAward[]): PlayerAward[] {
  return [...awards].sort((a, b) =>
    b.season - a.season
    || PLAYER_AWARD_PRECEDENCE.indexOf(a.type) - PLAYER_AWARD_PRECEDENCE.indexOf(b.type)
    || a.playerId.localeCompare(b.playerId),
  );
}

export interface AwardLeaderRow {
  playerId: string;
  playerName: string;
  position?: PlayerPosition;
  /** Team of the player's most recent award in the filtered set. */
  teamId: string;
  teamName: string;
  total: number;
  counts: Record<PlayerAwardType, number>;
  latestSeason: number;
}

function emptyCounts(): Record<PlayerAwardType, number> {
  return {
    mvp: 0,
    golden_boot: 0,
    best_forward: 0,
    best_midfielder: 0,
    best_defender: 0,
    best_goalkeeper: 0,
    young_player: 0,
  };
}

/**
 * Per-player award totals.
 *
 * Ranked by total wins, then Ballon d'Or, then Golden Boot, then the most
 * recent winning season; `playerId` breaks the last tie so the order never
 * depends on object key order.
 */
export function aggregateAwardLeaders(
  awards: readonly PlayerAward[],
  positions?: ReadonlyMap<string, PlayerPosition>,
): AwardLeaderRow[] {
  const byPlayer = new Map<string, AwardLeaderRow>();

  for (const award of dedupeAwards(awards)) {
    const existing = byPlayer.get(award.playerId);
    if (!existing) {
      const counts = emptyCounts();
      counts[award.type] += 1;
      byPlayer.set(award.playerId, {
        playerId: award.playerId,
        playerName: award.playerName,
        position: positions?.get(award.playerId),
        teamId: award.teamId,
        teamName: award.teamName,
        total: 1,
        counts,
        latestSeason: award.season,
      });
      continue;
    }
    existing.counts[award.type] += 1;
    existing.total += 1;
    if (award.season >= existing.latestSeason) {
      existing.latestSeason = award.season;
      existing.teamId = award.teamId;
      existing.teamName = award.teamName;
      existing.playerName = award.playerName;
    }
  }

  return [...byPlayer.values()].sort((a, b) =>
    b.total - a.total
    || b.counts.mvp - a.counts.mvp
    || b.counts.golden_boot - a.counts.golden_boot
    || b.latestSeason - a.latestSeason
    || a.playerId.localeCompare(b.playerId),
  );
}

/** e.g. `金球 ×2 · 金靴 ×1`, most prestigious first. */
export function describeAwardCounts(
  counts: Record<PlayerAwardType, number>,
  limit = 4,
): string {
  const parts = PLAYER_AWARD_PRECEDENCE
    .filter((type) => (counts[type] ?? 0) > 0)
    .map((type) => `${PLAYER_AWARD_LABELS[type]} ×${counts[type]}`);
  if (parts.length <= limit) return parts.join(' · ');
  return `${parts.slice(0, limit).join(' · ')} 等 ${parts.length} 项`;
}

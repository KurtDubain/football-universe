/**
 * Pure storage-cap helper.
 *
 * Several lists on `GameWorld` grow without bound across seasons. The biggest
 * offender is `matchHistory` (~600 entries / season). Without limits, a save
 * file blows past the 5MB localStorage quota after roughly 200 seasons.
 *
 * `enforceStorageLimits` returns a NEW world with those lists sliced. It is
 * intentionally idempotent and has no side effects — call it as the very last
 * step of `initializeNewSeason` so caps are enforced exactly once per season
 * boundary, not on every window advance.
 *
 * Caps were picked to keep ~200 seasons of play comfortable in localStorage
 * while preserving enough history to be interesting (recent H2H, transfer
 * window, awards & per-team trend graph).
 */
import type { GameWorld, MatchHistoryEntry } from './season-manager';
import type { TransferRecord } from '../../types/transfer';
import type { PlayerAward } from '../../types/award';
import type { SeasonRecord } from '../../types/team';

/** Keep matchHistory entries from the last N seasons (inclusive of current). */
export const MATCH_HISTORY_SEASONS = 5;
/** Keep transferHistory entries from the last N seasons (inclusive of current). */
export const TRANSFER_HISTORY_SEASONS = 50;
/** Keep playerAwardsHistory entries from the last N seasons (inclusive of current). */
export const PLAYER_AWARDS_SEASONS = 100;
/** Per-team season-record cap (most recent N entries kept). */
export const TEAM_SEASON_RECORDS_PER_TEAM = 80;

function currentSeasonOf(world: GameWorld): number {
  return world.seasonState?.seasonNumber ?? 0;
}

/**
 * Slice an array of `{ season }` entries to keep only those from
 * `currentSeason - windowSeasons + 1` onward (inclusive).
 *
 * - Empty/undefined input returns []
 * - Already-trimmed arrays are returned untouched (referential equality)
 *   so React/Zustand selectors don't see spurious changes
 */
function trimBySeason<T extends { season: number }>(
  arr: T[] | undefined,
  currentSeason: number,
  windowSeasons: number,
): T[] {
  if (!arr || arr.length === 0) return arr ?? [];
  const minSeason = currentSeason - windowSeasons + 1;
  // Fast path: nothing to drop
  if (arr[0].season >= minSeason) return arr;
  const filtered = arr.filter((e) => e.season >= minSeason);
  return filtered.length === arr.length ? arr : filtered;
}

function trimSeasonRecords(
  records: SeasonRecord[] | undefined,
  cap: number,
): SeasonRecord[] {
  if (!records || records.length === 0) return records ?? [];
  if (records.length <= cap) return records;
  return records.slice(-cap);
}

/**
 * Pure: returns a NEW GameWorld with bounded list fields.
 * Does not mutate the input. Safe to call repeatedly.
 */
export function enforceStorageLimits(world: GameWorld): GameWorld {
  const currentSeason = currentSeasonOf(world);

  // matchHistory: keep last N seasons by `season` field
  const matchHistory: MatchHistoryEntry[] = trimBySeason(
    world.matchHistory,
    currentSeason,
    MATCH_HISTORY_SEASONS,
  );

  // transferHistory: keep last N seasons
  const transferHistory: TransferRecord[] = trimBySeason(
    world.transferHistory,
    currentSeason,
    TRANSFER_HISTORY_SEASONS,
  );

  // playerAwardsHistory: keep last N seasons
  const playerAwardsHistory: PlayerAward[] = trimBySeason(
    world.playerAwardsHistory,
    currentSeason,
    PLAYER_AWARDS_SEASONS,
  );

  // teamSeasonRecords[teamId]: cap each team's list to N entries
  let teamRecordsChanged = false;
  const teamSeasonRecords: Record<string, SeasonRecord[]> = {};
  const sourceRecords = world.teamSeasonRecords ?? {};
  for (const [teamId, recs] of Object.entries(sourceRecords)) {
    const trimmed = trimSeasonRecords(recs, TEAM_SEASON_RECORDS_PER_TEAM);
    if (trimmed !== recs) teamRecordsChanged = true;
    teamSeasonRecords[teamId] = trimmed;
  }

  // Avoid spinning a fresh world if nothing actually changed. We treat the
  // input as "unchanged" only when the original array reference is identical
  // to what trim returned AND it was already an array (undefined → [] is a
  // normalization we DO want to surface).
  const matchUnchanged = world.matchHistory !== undefined && world.matchHistory === matchHistory;
  const transferUnchanged = world.transferHistory !== undefined && world.transferHistory === transferHistory;
  const awardsUnchanged = world.playerAwardsHistory !== undefined && world.playerAwardsHistory === playerAwardsHistory;
  if (matchUnchanged && transferUnchanged && awardsUnchanged && !teamRecordsChanged) {
    return world;
  }

  return {
    ...world,
    matchHistory,
    transferHistory,
    playerAwardsHistory,
    teamSeasonRecords,
  };
}

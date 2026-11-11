import type { SeasonRecord } from '../../types/team';

/**
 * Shared helpers for all-time record walls.
 *
 * Record walls used to be built from ad-hoc `reduce` calls at each call site.
 * That produced two classes of defect:
 *
 *   1. Ties were silently resolved by object-key insertion order, so a record
 *      holder was effectively drawn by lottery.
 *   2. Call sites that filtered first (`filter(r => r.leaguePlayed > 5)`) still
 *      passed the *unfiltered* first element as the reduce seed, so a team with
 *      too few matches could win a record it was never eligible for.
 *
 * Every record now goes through `bestRate` / `bestTotal`, which return *all*
 * tied holders in a stable order and never mix filtered and unfiltered input.
 */

/** Minimum matches before a season row may compete for a record. */
export const RECORD_MIN_PLAYED = 10;

/** A record holder with both its rate and its raw total. */
export interface RecordHolder {
  teamId: string;
  teamName: string;
  seasonNumber: number;
  leagueLevel: 1 | 2 | 3;
  /** Rate value used for comparison (per match). */
  value: number;
  /** Raw season total, for display. */
  raw: number;
  played: number;
}

/** A record plus every team that shares it. */
export interface RecordResult {
  /** All tied holders, ordered by season then teamId. */
  holders: RecordHolder[];
  /** True when more than one team shares the record. */
  tied: boolean;
}

/**
 * Stable, deterministic ordering for tied holders.
 * Season first (earlier achievement reads as the original), then teamId.
 */
function byStableOrder(a: RecordHolder, b: RecordHolder): number {
  return a.seasonNumber - b.seasonNumber || a.teamId.localeCompare(b.teamId);
}

/**
 * Find the best per-match rate across all eligible season rows.
 *
 * Rates are used instead of raw totals because the three tiers play different
 * schedules (top flight 30 rounds, tier 2/3 only 14). Raw "most wins" style
 * records were structurally monopolised by the top flight.
 *
 * @param rows   Season rows already flattened with teamId/teamName.
 * @param pick   Extracts the numerator from a row.
 * @param dir    'max' keeps the highest rate, 'min' the lowest.
 * @param minPlayed Rows below this match count are excluded entirely.
 */
export function bestRate(
  rows: SeasonRecordWithTeam[],
  pick: (r: SeasonRecordWithTeam) => number,
  dir: 'max' | 'min',
  minPlayed: number = RECORD_MIN_PLAYED,
): RecordResult | null {
  const eligible = rows.filter(r => r.leaguePlayed >= minPlayed);
  if (eligible.length === 0) return null;

  const holders: RecordHolder[] = eligible.map(r => ({
    teamId: r.teamId,
    teamName: r.teamName,
    seasonNumber: r.seasonNumber,
    leagueLevel: r.leagueLevel,
    value: pick(r) / r.leaguePlayed,
    raw: pick(r),
    played: r.leaguePlayed,
  }));

  const values = holders.map(h => h.value);
  const best = dir === 'max' ? Math.max(...values) : Math.min(...values);

  // Floating point rates need an epsilon; exact division of integers can
  // still differ in the last bit for otherwise identical ratios.
  const tied = holders.filter(h => Math.abs(h.value - best) < 1e-9);

  return { holders: tied.sort(byStableOrder), tied: tied.length > 1 };
}

/**
 * Find the best raw total across all eligible season rows.
 *
 * Only for records where the total is genuinely the point (e.g. an all-time
 * goals tally). Schedule-length fairness is not addressed here — prefer
 * `bestRate` unless the raw number itself is the story.
 */
export function bestTotal(
  rows: SeasonRecordWithTeam[],
  pick: (r: SeasonRecordWithTeam) => number,
  dir: 'max' | 'min',
  minPlayed: number = RECORD_MIN_PLAYED,
): RecordResult | null {
  const eligible = rows.filter(r => r.leaguePlayed >= minPlayed);
  if (eligible.length === 0) return null;

  const holders: RecordHolder[] = eligible.map(r => ({
    teamId: r.teamId,
    teamName: r.teamName,
    seasonNumber: r.seasonNumber,
    leagueLevel: r.leagueLevel,
    value: pick(r),
    raw: pick(r),
    played: r.leaguePlayed,
  }));

  const values = holders.map(h => h.value);
  const best = dir === 'max' ? Math.max(...values) : Math.min(...values);
  const tied = holders.filter(h => h.value === best);

  return { holders: tied.sort(byStableOrder), tied: tied.length > 1 };
}

/** A season row carrying its owning team, as flattened by record walls. */
export interface SeasonRecordWithTeam extends SeasonRecord {
  teamId: string;
  teamName: string;
}

/**
 * Flatten `world.teamSeasonRecords` into rows carrying team identity.
 * Object key order is deliberately not relied upon for any comparison.
 */
export function flattenSeasonRecords(
  teamSeasonRecords: Record<string, SeasonRecord[]>,
  teamNameOf: (teamId: string) => string,
): SeasonRecordWithTeam[] {
  return Object.entries(teamSeasonRecords).flatMap(([teamId, records]) =>
    records.map(r => ({ ...r, teamId, teamName: teamNameOf(teamId) })),
  );
}

/** Format a holder list for a one-line summary. */
export function describeHolders(result: RecordResult | null): string {
  if (!result || result.holders.length === 0) return '—';
  const first = result.holders[0];
  if (!result.tied) return first.teamName;
  return `${first.teamName} 等 ${result.holders.length} 队`;
}

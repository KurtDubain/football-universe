import type { PlayerSeasonStats } from '../../types/player';

/**
 * Runtime schema for additive player-season counters.
 *
 * Keep required and optional fields separate for save validation, while all
 * aggregation and snapshot paths consume the combined schema below.
 */
const REQUIRED_COUNTER_DEFAULTS = {
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
} as const satisfies Partial<Record<keyof PlayerSeasonStats, number>>;

const OPTIONAL_COUNTER_DEFAULTS = {
  starts: 0,
  substituteAppearances: 0,
  minutesPlayed: 0,
  routineSaves: 0,
  shotsOnTargetFaced: 0,
  cleanSheetMinutes: 0,
  goalsConcededWhileOnPitch: 0,
  interceptions: 0,
  clearances: 0,
  teamMatchesAllCompetitions: 0,
  missedMatches: 0,
  injuryAbsenceMatches: 0,
} as const satisfies Partial<Record<keyof PlayerSeasonStats, number>>;

const PLAYER_STAT_COUNTER_DEFAULTS = {
  ...REQUIRED_COUNTER_DEFAULTS,
  ...OPTIONAL_COUNTER_DEFAULTS,
};

export type PlayerStatRequiredCounterField = keyof typeof REQUIRED_COUNTER_DEFAULTS;
export type PlayerStatOptionalCounterField = keyof typeof OPTIONAL_COUNTER_DEFAULTS;
export type PlayerStatCounterField = keyof typeof PLAYER_STAT_COUNTER_DEFAULTS;
export type PlayerStatCounterRecord = Record<PlayerStatCounterField, number>;

export const PLAYER_STAT_REQUIRED_COUNTER_FIELDS = Object.freeze(
  Object.keys(REQUIRED_COUNTER_DEFAULTS) as PlayerStatRequiredCounterField[],
);

export const PLAYER_STAT_OPTIONAL_COUNTER_FIELDS = Object.freeze(
  Object.keys(OPTIONAL_COUNTER_DEFAULTS) as PlayerStatOptionalCounterField[],
);

export const PLAYER_STAT_COUNTER_FIELDS = Object.freeze(
  Object.keys(PLAYER_STAT_COUNTER_DEFAULTS) as PlayerStatCounterField[],
);

export function createEmptyPlayerStatCounters(): PlayerStatCounterRecord {
  return { ...PLAYER_STAT_COUNTER_DEFAULTS };
}

/** Normalizes optional counters before aggregation or historical capture. */
export function snapshotPlayerStatCounters(stats: PlayerSeasonStats): PlayerStatCounterRecord {
  const snapshot = createEmptyPlayerStatCounters();
  for (const field of PLAYER_STAT_COUNTER_FIELDS) snapshot[field] = Number(stats[field] ?? 0);
  snapshot.teamMatchesAllCompetitions = Number(
    stats.teamMatchesAllCompetitions ?? stats.appearances ?? 0,
  );
  return snapshot;
}

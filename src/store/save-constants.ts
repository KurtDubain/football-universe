import { editionStorageKey } from '../edition/policy';
/**
 * v26 — the world cup moved inside the season (world-cup-timing-redesign.md).
 * A world cup year's calendar now carries the tournament windows before
 * season_end, and `SeasonState.worldCupPhase` no longer exists, so saves
 * written by v25 and earlier cannot be interpreted correctly. They are
 * rejected by the version gate rather than silently mis-simulated.
 */
export const SAVE_SCHEMA_VERSION = 26;
export const SAVE_STORAGE_KEY = editionStorageKey('football-universe-save');
export const SAVE_DIAGNOSTIC_KEY = `${SAVE_STORAGE_KEY}-invalid`;

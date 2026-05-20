export type PlayerPosition = 'GK' | 'DF' | 'MF' | 'FW';

/**
 * `uuid` is the player's stable internal identifier. It is assigned at
 * generation (or backfilled by the v7→v8 migration for legacy saves) and
 * NEVER mutates — not on transfer, not on number change. All cross-references
 * (playerStats keys, PlayerAward.playerId, TransferRecord.playerId,
 * MatchEvent.playerId) hold a uuid value.
 *
 * `teamId` and `number` ARE mutable: a transfer rewrites both in place on
 * the same Player object, leaving the uuid intact and any references valid
 * automatically — no `applyTransferIdMap` rewrite pass needed.
 *
 * Naming note: foreign-key fields keep the name `playerId` for readability
 * (PlayerSeasonStats.playerId, PlayerAward.playerId, etc.) but the value
 * stored is a uuid, not the old `${teamId}-${number}` shape.
 */
export interface Player {
  uuid: string;
  teamId: string;
  name: string;        // assigned by region pool, e.g. "张伟"
  number: number;      // shirt number (mutable on transfer)
  position: PlayerPosition;
  /**
   * Cached current rating (30-99). Recomputed at season-end from the curve in
   * `engine/players/development.ts` after age++. Read-only between season-ends:
   * any code that needs the player's "current ability" reads `rating` directly,
   * never re-derives from peakRating in a hot path.
   */
  rating: number;
  goalScoring: number; // 0-100, chance weight for being picked as scorer (NOT age-affected)
  marketValue: number; // in millions, e.g. 85 for €85M
  age: number;         // simulated age, increments each season
  /**
   * Destined ceiling rating (30-99). Immutable once set — assigned at
   * generation, mirrored from `rating` for legacy v9 saves by the v9→v10
   * migration. The age curve scales `rating` from `peakRating` based on age.
   */
  peakRating: number;
  /**
   * The age at which this player hits peak performance (24-29). Immutable
   * once set; introduced in v10. Plus/minus 2 years either side counts as
   * the plateau (full peak); decline begins at peakAge + 3.
   */
  peakAge: number;
}

export interface PlayerSeasonStats {
  /** Holds a Player.uuid value. */
  playerId: string;
  teamId: string;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  appearances: number;
}

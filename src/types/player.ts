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
  // ── Phase G: 伤病 / 停赛 ──────────────────────────────────────────
  /**
   * Global window index (cumulative across seasons via
   * `world.totalElapsedWindows`) the player is unavailable due to injury.
   * Player is selectable when `currentWindowIdx >= injuredUntilWindow`. Set
   * by post-match injury rolls; cleared at season-end for short injuries
   * (duration <= 30 matches), retained for long_term ones.
   *
   * Optional — undefined / 0 means "no active injury".
   */
  injuredUntilWindow?: number;
  /**
   * Global window index the player is suspended until. Set when cumulative
   * yellow / red counters trip; cleared every season-end (offseason wipes
   * all bans).
   */
  suspendedUntilWindow?: number;
  /** Historical suspension intervals used to audit past match eligibility. */
  suspensionHistory?: Suspension[];
  /**
   * Career injury log. FIFO-capped at the last 10 entries. Used by the
   * UI (PlayerDetail) and by retirement (long-term injuries boost retire
   * chance).
   */
  injuryHistory?: Injury[];
  // ── v17: Personality tag ──────────────────────────────────────────
  /**
   * Optional personality tag affecting transfers / injuries / market value.
   * Mutually exclusive — 0 or 1 tag per player. Assigned at generation
   * based on a deterministic uuid-hash roll (~30% chance of any tag,
   * roughly: 10% loyal / 10% ambitious / 5% iron / 5% glass).
   *
   * Effects:
   *   loyal     — never poached by elites (poach probability = 0)
   *   ambitious — poach probability × 1.5
   *   iron      — injury chance ÷ 3
   *   glass     — injury chance × 2, market value × 0.7
   */
  tag?: PlayerTag;
}

/** v17+ — player personality tag (at most one per player). */
export type PlayerTag =
  | 'loyal'        // never poached
  | 'ambitious'    // 1.5× poach probability
  | 'iron'         // injury chance ÷ 3
  | 'glass'        // injury chance × 2, market value × 0.7
  // v18 additions
  | 'clutch'       // +30% goal weight in finals + derbies
  | 'late_bloomer' // peakAge 28-32 instead of 24-29
  | 'wanderer';    // 8% per season chance to self-release to free agent pool

/**
 * One entry in `Player.injuryHistory`. Severity drives both `durationMatches`
 * and the news copy.
 */
export type InjurySeverity = 'minor' | 'moderate' | 'major' | 'long_term';

export interface Injury {
  /** Severity bucket — see `InjurySeverity`. */
  type: InjurySeverity;
  /** Season in which the injury was sustained. */
  startSeason: number;
  /** Global window index at which the injury was sustained. */
  startWindow: number;
  /** Number of MATCH WINDOWS the player is sidelined for. */
  durationMatches: number;
  /** Chinese-language reason, e.g. 膝伤 / 脚踝扭伤 / 肌肉拉伤 / 头部撞击. */
  reason: string;
}

export interface Suspension {
  /** Season and global match window where the ban was imposed. */
  startSeason: number;
  startWindow: number;
  /** First global match window where the player cannot be selected. */
  unavailableFromWindow: number;
  /** Player becomes selectable again when the global window reaches this value. */
  suspendedUntilWindow: number;
  banWindows: number;
  reason: 'yellow_cards' | 'red_cards' | 'mixed_discipline';
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
  starts?: number;
  substituteAppearances?: number;
  minutesPlayed?: number;
  /**
   * Individual clean-sheet count. Incremented for each DF/GK who actually
   * appeared when their side conceded 0 goals across regulation and extra
   * time. Unused bench players and outfield attackers never receive credit.
   */
  cleanSheets: number;
  /**
   * v22 — symmetric "denied goal" credit pipeline. See `applyDenyPipeline`
   * in `engine/match/events.ts` for the source of truth on how these are
   * incremented; below are the consumer-side invariants:
   *
   *   saves       — GK only. +1 per goal the GK denies (5-18% per goal).
   *   keyBlocks   — DF only. +1 per goal the DF denies on the line.
   *   bigChances  — FW/MF. Counts goals + denied attempts they were
   *                  credited as would-be scorer. ALWAYS ≥ `goals`.
   *   keyPasses   — MF/FW. Counts assists + denied attempts they were
   *                  credited as would-be assister. ALWAYS ≥ `assists`.
   *
   * Invariant: `bigChances` and `keyPasses` are derived metrics; they do
   * NOT participate in scoreline math. `goals` and `assists` remain the
   * sole source of truth for top-scorer tables and team box scores.
   */
  saves: number;
  keyBlocks: number;
  bigChances: number;
  keyPasses: number;
}

/**
 * Current-season contribution for one player while representing one team.
 * `PlayerSeasonStats` remains the player-wide season total; this segmented
 * form is keyed by `(playerId, teamId)` so transfer-era displays can tell
 * "season total" from "for this club".
 */
export type PlayerTeamSeasonStats = PlayerSeasonStats;

/**
 * v19 — historical per-season snapshot of a player's stats, captured at
 * season-end before the current-season `playerStats` is reset. Kept FIFO
 * at most 15 entries per player (older seasons drop off).
 *
 * Adds `season` + frozen team context so UI can compute per-season
 * position-aware metrics and show the team environment as it was then,
 * not as the live team looks today.
 */
export interface PlayerSeasonStatsHistoryEntry {
  season: number;
  teamId: string;
  /** Frozen display identity at season end. Optional for legacy history rows. */
  teamName?: string;
  teamShortName?: string;
  playerName?: string;
  playerNumber?: number;
  position: PlayerPosition;
  rating?: number;
  age?: number;
  goals: number;
  assists: number;
  appearances: number;
  starts?: number;
  substituteAppearances?: number;
  minutesPlayed?: number;
  yellowCards: number;
  redCards: number;
  /** Total league goals conceded by the player's team that season. */
  teamGoalsConceded: number;
  /** Total league matches the team played that season. */
  teamMatches: number;
  /** Frozen league context for the player's team that season. */
  teamLeagueLevel?: 1 | 2 | 3;
  teamLeaguePosition?: number;
  teamGoalsFor?: number;
  teamGoalsAgainst?: number;
  teamPoints?: number;
  /** v21 — individual clean sheets. May be 0 for older seasons. */
  cleanSheets?: number;
  /** v22 — see PlayerSeasonStats. Optional for older history entries. */
  saves?: number;
  keyBlocks?: number;
  bigChances?: number;
  keyPasses?: number;
}

/**
 * A retired player. Captured at the season-end moment of retirement.
 *
 * The `uuid` is preserved so any historical reference (transferHistory,
 * playerAwardsHistory, MatchEvent.playerId) keeps resolving — only their
 * presence in `world.squads` is removed. `playerStats` are also preserved
 * so cumulative career numbers can be looked up post-retirement.
 *
 * `careerGoals` is a snapshot at retirement time, derived from finished
 * season history plus the current season that is about to be snapshotted.
 * `careerTrophies` is an optional snapshot of trophies the player's last
 * team won in seasons where they were on the squad — computed best-effort
 * by the retirement engine.
 */
export interface PlayerRetirement {
  uuid: string;
  name: string;
  teamId: string;
  teamName: string;
  position: PlayerPosition;
  peakRating: number;
  age: number;
  seasonRetired: number;
  careerGoals: number;
  careerTrophies?: import('./team').Trophy[];
}

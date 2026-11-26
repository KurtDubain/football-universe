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
  /**
   * 0-100 PEAK chance weight for being picked as scorer, rolled position-keyed
   * at generation. This is the ceiling, not the current value: read it through
   * `effectiveGoalScoring` in `engine/players/development.ts`, which scales it
   * by the same age curve `rating` uses. Reading it raw makes forwards immortal.
   */
  goalScoring: number;
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
  /**
   * The last club the player actually played for, preserved when they are
   * released to the free market.
   *
   * `teamId` becomes `FREE_MARKET_TEAM_ID` on release, so a pooled player is
   * never read as an active member of their old club. That rewrite used to be
   * skipped entirely, which left every pooled player pointing at their old club
   * and filed each "no offers, retired" record under that club's name instead of
   * the market's. The signing fee still has to reach the club that released
   * them, so the original id is kept here rather than discarded.
   *
   * Optional — absent on players who have never been released, and on saves
   * written before this field existed (readers fall back to `teamId`).
   */
  releasedFromTeamId?: string;
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
   * Personality tags affecting transfers / injuries / market value, plus the
   * v23 additions that reach the match engine through card and shot weights.
   *
   * 0-2 tags per player, rolled from independent uuid-hash slots (see
   * `rollTagsForUuid`). ~29% of players carry none, ~50% carry one, ~21% carry
   * two. Never read this field directly — go through `getPlayerTags` /
   * `hasTag` in `engine/players/tags`, which resolve the legacy single-tag
   * shape below.
   */
  tags?: PlayerTag[];
  /**
   * Playing-style tag. Exactly one of the position's styles, or absent for a
   * conventional player. Rolled from the uuid hash like the personality tags,
   * but scoped to the player's position — a style describes HOW a player
   * produces, so it is what the match engine reads when it divides goals,
   * assists, cards and defensive actions.
   *
   * A style never touches `peakRating`. It moves the SHAPE of a player's
   * output, not their ceiling.
   */
  styleTag?: StyleTag;
  /**
   * @deprecated v17-v22 single-tag shape. Present on saves written before the
   * multi-tag roll; `getPlayerTags` folds it into the array when `tags` is
   * absent. New writes go to `tags`.
   */
  tag?: PlayerTag;
}

/** v17+ — player personality tag (at most two per player). */
export type PlayerTag =
  | 'loyal'        // never poached
  | 'ambitious'    // poach probability +0.12
  | 'iron'         // injury chance ÷ 3
  | 'glass'        // injury chance × 2, market value × 0.7
  // v18 additions
  | 'clutch'       // +30% goal weight in finals + derbies
  | 'late_bloomer' // peakAge 28-32 instead of 24-29
  | 'wanderer'     // wants out 8%/season; leaves only when a club actually buys him
  // v23 additions — all five land on an existing engine hook
  | 'hothead'      // card weight × 2.5
  | 'gentleman'    // card weight × 0.3
  | 'solo'         // goal weight × 1.25, assist weight × 0.45
  | 'leader'       // poach probability × 0.6, market value × 1.10
  | 'early_peak';  // peakAge 21-24 instead of 24-29

/**
 * v23 — playing-style tag. One per player at most, drawn from the styles
 * available at that position.
 *
 * Each style is a multiplier on a weight the match engine already computes, so
 * a style can only redistribute a fixed pool of events — it cannot create
 * goals, assists or defensive actions that the fixture did not generate.
 */
export type StyleTag =
  // FW — the two dials a forward has are finishing and creation
  | 'poacher'      // goal × 1.35, assist × 0.60
  | 'creator'      // goal × 0.75, assist × 1.55
  // MF — assists, shooting and defensive work
  | 'playmaker'    // assist × 1.60, defensive work × 0.50
  | 'engine'       // assist × 0.55, goal × 0.85, defensive work × 2.00
  | 'shadow'       // goal × 2.20, defensive work × 0.60
  // DF — interception/clearance split, plus attacking contribution
  | 'marker'       // interceptions × 1.55, clearances × 0.70
  | 'sweeper'      // interceptions × 0.70, clearances × 1.55
  | 'raider_df'    // goal × 3.00, defensive work × 0.90
  // GK — one dial only: how often a denied goal is credited to the keeper
  // rather than to a defender on the line
  | 'shotstopper'  // keeper credit 0.60 → 0.72
  | 'flaky';       // keeper credit 0.45 or 0.78, redrawn per match

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
  /** All-competitions goals. The Golden Boot ranks on this. */
  goals: number;
  /**
   * League goals only, which the season top scorer ranks on.
   *
   * Absent on saves written before the split; read it through
   * `leagueGoalsOf` rather than directly.
   */
  leagueGoals?: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  appearances: number;
  starts?: number;
  substituteAppearances?: number;
  minutesPlayed?: number;
  /**
   * Individual full clean-sheet count. Incremented for each DF/GK who plays
   * at least 60 minutes when their side concedes 0 goals across regulation
   * and extra time. Short substitutes only add `cleanSheetMinutes`.
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
  /** Ordinary saves backed by the match shots-on-target total. */
  routineSaves?: number;
  /** Shots that reached this goalkeeper: goals plus routine/key saves. */
  shotsOnTargetFaced?: number;
  /** Minutes played in matches where the player's team kept a clean sheet. */
  cleanSheetMinutes?: number;
  /** Goals conceded while this GK/DF was actually on the pitch. */
  goalsConcededWhileOnPitch?: number;
  /** Match-derived defensive actions. DF only. */
  interceptions?: number;
  clearances?: number;
  /** Team fixtures played in all competitions while this stat row was active. */
  teamMatchesAllCompetitions?: number;
  /** Team fixtures in which the player recorded no playing time. */
  missedMatches?: number;
  /** Missed team fixtures where an active injury made the player unavailable. */
  injuryAbsenceMatches?: number;
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
 * at most 25 entries per player (older seasons drop off).
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
  /** All-competitions goals. */
  goals: number;
  /** League goals only; absent on rows archived before the split. */
  leagueGoals?: number;
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
  routineSaves?: number;
  shotsOnTargetFaced?: number;
  cleanSheetMinutes?: number;
  goalsConcededWhileOnPitch?: number;
  interceptions?: number;
  clearances?: number;
  teamMatchesAllCompetitions?: number;
  missedMatches?: number;
  injuryAbsenceMatches?: number;
  /** Frozen v1 cross-position season-performance result. */
  seasonScore?: number;
  positionQuality?: number;
  availabilityScore?: number;
  leagueStrength?: number;
  scoreConfidence?: number;
  scoreVersion?: number;
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
 * `careerTrophies` is a legacy snapshot of the last club's honors, not
 * verified personal trophies. New retirements do not duplicate that history.
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
  /** Frozen minute-weighted recorded performance, independent of rolling detail retention. */
  careerScore?: import('../engine/players/career-score').CareerScoreSummary;
  careerTrophies?: import('./team').Trophy[];
  /** Compact facts retained for award winners / observed people, not match replays. */
  careerSummary?: {
    followed?: boolean;
    awards: import('./award').PlayerAward[];
    totals: import('../engine/players/career-totals').PlayerCareerTotals;
    teams: { teamId: string; teamName: string; seasons: number[] }[];
  };
}

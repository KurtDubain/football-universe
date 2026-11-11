import type { PlayerAwardType } from '../../types/award';

/**
 * Every award coefficient lives here so the whole system can be audited and
 * tuned from one file. Nothing in `season-awards.ts` or `ballon-dor.ts`
 * should hard-code a number that belongs in this table.
 *
 * See docs/award-system-redesign.md for the reasoning behind each value.
 */

export type LeagueTier = 1 | 2 | 3;

/**
 * Tier weighting for awards scored from rate-like metrics.
 *
 * Safe to use as-is for anything derived from per-match output — position
 * quality, season score — because those already normalise for match count.
 *
 * NOT safe for raw counting stats. The Golden Boot keeps its own table; see
 * GOLDEN_BOOT_TIER_COEFFICIENT and GOLDEN_BOOT_SCHEDULE_EXPONENT below.
 */
export const TIER_COEFFICIENT: Record<LeagueTier, number> = {
  1: 1.0,
  2: 0.9,
  3: 0.8,
};

/**
 * The young-player award is the designated route for a standout in a small
 * league, so its tier discount is deliberately milder than the general one.
 */
export const YOUNG_PLAYER_TIER_COEFFICIENT: Record<LeagueTier, number> = {
  1: 1.0,
  2: 0.95,
  3: 0.9,
};

/**
 * Golden Boot schedule normalisation.
 *
 * The top flight plays 30 rounds; tiers 2 and 3 play 14. A raw goal count
 * therefore measures "who played more matches" before it measures finishing
 * ability, and a 90-season audit (3 seeds x 30 seasons) confirmed it: with raw
 * goals the lower tiers won the Golden Boot 0 times out of 90, even though a
 * lower-tier top scorer averages 1.26 goals per round against the top flight's
 * 1.03. The tier coefficient could not fix that, because a 10% discount does
 * not fight a 2.14x structural gap.
 *
 * `exponent = 1` converts every league to a common 30-round basis. This is a
 * structural correction, not a concession: schedule length carries no
 * information about player quality, so it should not decide the award.
 *
 * The quality judgement lives entirely in GOLDEN_BOOT_TIER_COEFFICIENT below.
 */
export const GOLDEN_BOOT_SCHEDULE_EXPONENT = 1;

/**
 * What a goal is worth, by the league it was scored in.
 *
 * Applied to a schedule-normalised rate, so this is the only knob expressing
 * "a goal against weaker opposition counts for less". Deliberately separate
 * from TIER_COEFFICIENT: position awards score `positionQuality`, which is
 * already derived from per-match metrics and carries no schedule asymmetry, so
 * they keep the original 1.00 / 0.90 / 0.80 table.
 *
 * Why below 0.90: the audit showed 0.90 / 0.80 is empirically the *tier-blind*
 * value — at that setting the lower tiers won 52% of Golden Boots, matching
 * their 16-of-32 share of clubs almost exactly. Any genuine preference for the
 * stronger league has to sit below it.
 *
 * Measured at 0.75 / 0.58 across 3 seeds x 30 seasons: top flight 71%,
 * tier 2 ~27%, tier 3 ~2%. Crucially the winner's scoring rate stays at
 * 5.2-5.6x their own league's average at every coefficient tested, so tuning
 * this changes which league the standout comes from, never whether they are
 * genuinely exceptional.
 */
export const GOLDEN_BOOT_TIER_COEFFICIENT: Record<LeagueTier, number> = {
  1: 1.0,
  2: 0.75,
  3: 0.58,
};

// ── Team achievement multipliers ────────────────────────────────────

/** Ballon d'Or: team achievement dominates, so the spread is wide. */
export const BALLON_DOR_TEAM = {
  champion: 1.18,
  topFour: 1.08,
  bottomFour: 0.94,
  midTable: 1.0,
  continentalCup: 1.1,
  worldCup: 1.15,
  /** Per domestic cup (league cup, super cup). */
  domesticCup: 1.05,
  /**
   * Cap on the combined domestic-cup multiplier so a domestic double
   * (1.05 × 1.05 = 1.1025) never outranks a continental cup (1.10).
   */
  domesticCupCap: 1.08,
} as const;

/**
 * Position awards: a light nudge, not a lever. A title-winning defender should
 * have an edge over an identical defender at a relegation club, but must never
 * win on team success alone.
 */
export const POSITION_AWARD_TEAM = {
  champion: 1.06,
  topFour: 1.03,
  bottomFour: 0.97,
  midTable: 1.0,
} as const;

/** Cut-off for the top-four bonus, in league places. */
export const TOP_FOUR_CUTOFF = 4;
/**
 * Size of the relegation zone the bottom-four penalty applies to. Derived from
 * the table size rather than hard-coded, so it survives a change to the
 * top-flight team count in `config/competitions.ts`.
 */
export const BOTTOM_PLACES = 4;

// ── Sample gates ────────────────────────────────────────────────────

export const FULL_SAMPLE_MINUTES = 1800;
export const PARTIAL_SAMPLE_MINUTES = 1200;
export const PARTIAL_SAMPLE_MULTIPLIER = 0.95;
export const THIN_SAMPLE_MULTIPLIER = 0.85;

/** Minimum appearances before a player can be considered for the Ballon d'Or. */
export const BALLON_DOR_MIN_APPEARANCES = 5;

/**
 * Position awards fold attendance in as a light factor rather than using
 * `seasonScore` (which weights it at 20% and also carries a tier component
 * that would double-count against the explicit tier coefficient).
 *
 * Full availability leaves the score untouched; a player who barely featured
 * keeps 85% of their positional output.
 */
export const POSITION_AWARD_AVAILABILITY_FLOOR = 0.85;

// ── Award buzz ──────────────────────────────────────────────────────

/** Top-flight rounds played before the buzz panel appears (of 30). */
export const BUZZ_START_ROUND = 16;

/** Candidates shown per award card, across all tiers. */
export const BUZZ_MAX_CANDIDATES = 5;

/** Buzz tiers rendered on a card. */
export const BUZZ_MAX_TIERS = 3;

/**
 * A new tier only starts when the gap to the previous candidate exceeds this.
 * Candidates inside the band are genuinely close, so presenting them as a
 * single unordered group is honest — and it removes the "rank 1 wins" read.
 */
export const BUZZ_BAND_WIDTH = 2.5;

/**
 * A single leader this far clear of the rest is flagged as a runaway. That
 * outcome is already computable by the player, so hiding it buys nothing.
 */
export const BUZZ_RUNAWAY_GAP = 6.0;

/** Buzz component weights. They intentionally do not sum to a probability. */
export const BUZZ_WEIGHTS = {
  season: 0.5,
  recentForm: 0.3,
  teamMomentum: 0.2,
} as const;

/**
 * Weighted goals that map to a full 100 on the Golden Boot buzz scale.
 *
 * The award ranks by weighted goals directly; the buzz panel needs a bounded
 * 0-100 component so it can blend goals with form and momentum on one scale.
 *
 * Raised from 30 when schedule normalisation landed: a 28-goal tier-2 season
 * now scores 45, where under raw goals it scored 25.2. The ceiling tracks the
 * post-normalisation scale, not the raw one.
 */
export const BUZZ_GOLDEN_BOOT_CEILING = 45;

/** Matches considered for a player's recent form. */
export const BUZZ_FORM_MATCHES = 5;
/** Matches considered for a team's momentum. */
export const BUZZ_MOMENTUM_MATCHES = 6;

/** Award types that get a buzz card, in display order. */
export const BUZZ_AWARDS: readonly PlayerAwardType[] = [
  'mvp',
  'golden_boot',
  'best_forward',
  'best_midfielder',
  'best_defender',
  'best_goalkeeper',
  'young_player',
] as const;

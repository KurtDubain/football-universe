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
 * Tier weighting for awards that should reward the strongest opposition.
 *
 * Note the schedule asymmetry this sits on top of: the top flight plays 30
 * rounds while tiers 2 and 3 play 14. Raw-count awards therefore already
 * favour the top flight before any coefficient applies. See
 * GOLDEN_BOOT_SCHEDULE_NOTE below.
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
 * Golden Boot weights raw goals by tier, the way the European Golden Shoe
 * weights by league coefficient.
 *
 * KNOWN ASYMMETRY: tier 2 and 3 play 14 rounds against the top flight's 30, so
 * a tier-2 top scorer (~14 goals) cannot realistically reach a top-flight top
 * scorer (~25 goals) even before the 0.90 coefficient. The coefficient is
 * therefore close to decorative today.
 *
 * If `scripts/audit-award-distribution.ts` confirms the imbalance, the fix is
 * a schedule normalisation of the form
 * `goals × (REFERENCE_ROUNDS / leagueRounds) ^ exponent × tierCoefficient`,
 * with the exponent as the single tuning knob. It is deliberately NOT applied
 * yet: the approved design is the plain tier coefficient, and the audit
 * numbers should decide whether to change it.
 */
export const GOLDEN_BOOT_SCHEDULE_NOTE =
  'Tier 2/3 play 14 rounds vs 30 in the top flight; the coefficient alone cannot close that gap.';

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

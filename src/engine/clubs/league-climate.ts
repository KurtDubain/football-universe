import { SeededRNG } from '../match/rng';

/**
 * League-wide climate: the two slow variables the engine was missing.
 *
 * Everything else that drifts is club-scoped. Doctrine says what one board
 * intends, academy level says what that intent accumulated into, reputation says
 * what a club has earned. None of them can move a LEAGUE-wide quantity, which is
 * why two things were structurally frozen:
 *
 *   - squad sizes only ever fell, because the only squad-size rule was a floor
 *     (MIN_SQUAD_AFTER_RELEASE) with nothing pulling anyone back up;
 *   - the rating distribution sat flat for 80+ seasons (mean 54.96-56.75 across
 *     S21-S100 on three seeds), because B3 deliberately pins the league academy
 *     mean at 50, so it cannot move the distribution at all.
 *
 * Both need a state that is (a) league-scoped, (b) bounded, and (c) genuinely
 * moving rather than converging on a constant. That is what this is.
 *
 * ── Why an OU process and not a plain bounded walk ──
 *
 * A bounded random walk with reflecting walls ends up uniform on the interval:
 * it spends as much time at the extremes as in the middle, and the extremes are
 * where the interesting behaviour is not. A mean-reverting walk has a bell-shaped
 * stationary distribution, so the index usually sits mid-range and visits the
 * walls only occasionally.
 *
 * The reversion term is SYMMETRIC — it always points at the centre, whichever
 * side the index is on. This is the distinction that matters. Reputation v2
 * collapsed to 27 because its decay path was one-directional (always down); this
 * is not that. Over any window the expected movement is zero in both directions,
 * which is what three previous drift attempts in this repo failed to establish.
 *
 * Wall contact is kept low on purpose. B3's calibration rejected a spread that
 * left 4.3-4.5% of club-seasons pinned on the academy floor, with the note that a
 * wall is not a distribution; the same standard applies here. With uniform noise
 * of half-width `step`, the stationary sigma is
 * `step / sqrt(3) / sqrt(2 * reversion)`, and the constants below put the walls at
 * roughly 2.2 sigma (arms race) and 2.3 sigma (talent era) — a couple of percent
 * of seasons at the boundary, not a tenth of them.
 */
export interface LeagueClimate {
  /**
   * How aggressively the league as a whole stocks its squads. Shifts every club's
   * squad-size target, so squad sizes breathe instead of ratcheting down.
   *
   * Bounded to [ARMS_RACE_MIN, ARMS_RACE_MAX]. 0 = neutral.
   */
  armsRace: number;
  /**
   * League-wide youth quality. Moves the academy peak baseline and the
   * talent-tier odds, so the rating distribution has good decades and bad ones
   * instead of one flat steady state.
   *
   * Bounded to [TALENT_ERA_MIN, TALENT_ERA_MAX]. 0 = neutral.
   */
  talentEra: number;
}

/** Squad-size target shifts by at most this many players either way. */
export const ARMS_RACE_MIN = -2;
export const ARMS_RACE_MAX = 2;
/** 0.02 → 34-season half-life. Longer than doctrine (6.6) and academy (13.5). */
export const ARMS_RACE_REVERSION = 0.02;
/** Uniform noise half-width. Stationary sigma ≈ 0.92; walls sit at ≈2.2 sigma. */
export const ARMS_RACE_STEP = 0.32;

/** Rating-baseline shift, in peak-rating points. */
export const TALENT_ERA_MIN = -5;
export const TALENT_ERA_MAX = 5;
/** 0.012 → 57-season half-life. Slower than the arms race: talent cycles run long. */
export const TALENT_ERA_REVERSION = 0.012;
/** Uniform noise half-width. Stationary sigma ≈ 2.20; walls sit at ≈2.3 sigma. */
export const TALENT_ERA_STEP = 0.59;

/** Neutral climate — what a save written before this field existed reads as. */
export const NEUTRAL_CLIMATE: LeagueClimate = { armsRace: 0, talentEra: 0 };

function driftBounded(
  prev: number,
  min: number,
  max: number,
  reversion: number,
  step: number,
  rng: SeededRNG,
): number {
  const noise = (rng.next() - 0.5) * 2 * step;
  const next = prev - prev * reversion + noise;
  return Math.max(min, Math.min(max, next));
}

/**
 * Advance the league climate by one season.
 *
 * Consumes exactly two RNG draws, one per axis. Immutable: returns a fresh
 * object and never touches `prev`.
 */
export function driftClimate(prev: LeagueClimate, rng: SeededRNG): LeagueClimate {
  return {
    armsRace: driftBounded(
      prev.armsRace, ARMS_RACE_MIN, ARMS_RACE_MAX, ARMS_RACE_REVERSION, ARMS_RACE_STEP, rng,
    ),
    talentEra: driftBounded(
      prev.talentEra, TALENT_ERA_MIN, TALENT_ERA_MAX, TALENT_ERA_REVERSION, TALENT_ERA_STEP, rng,
    ),
  };
}

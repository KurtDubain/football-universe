import { Player } from '../../types/player';
import { PlayerSeasonStats } from '../../types/player';
import { computeCurrentRating } from '../players/development';

// ── Two questions, two functions ─────────────────────────────────
//
//   computeInitialMarketValue — what a scout pays for a player he has
//     never watched. Keyed off `peakRating` (destiny), because pricing the
//     ceiling is the entire point of a first valuation. Used at generation
//     and as the fallback for legacy saves.
//
//   computePresentMarketValue — what the market thinks he is worth NOW,
//     having watched him for N seasons. Keyed off a rating that starts
//     mostly-potential for a teenager and decays to pure present ability by
//     POTENTIAL_PRICED_UNTIL_AGE.
//
// The previous `applyAnnualRevaluation` multiplied LAST YEAR's number by
// this season's modifiers, so value could only ever compound upward; the
// age step was a single ratio that a good season easily out-ran. A
// 50-season audit showed the result plainly — within every single rating
// band, market value went UP with age:
//
//     75-79 rated, age 26-29 → €23M median
//     75-79 rated, age 33-35 → €47M median
//     70-74 rated, age 26-29 → €11M median
//     70-74 rated, age 33-35 → €36M median
//
// and the fire-sale path (200% of marketValue) duly produced €300M sales
// for 67-77 rated players in their mid-thirties. Re-anchoring the value
// every season is the fix; the season modifiers survive as a BOUNDED
// multiplier on the fresh anchor instead of an unbounded one on history.

/** Age at which the market stops paying for potential. */
export const POTENTIAL_PRICED_UNTIL_AGE = 26;

/** Share of the pricing rating drawn from peakRating at age 18. */
export const MAX_POTENTIAL_WEIGHT = 0.75;

/** How far the market moves toward the freshly-computed target each season. */
export const REVALUATION_INERTIA = 2 / 3;

/** Bounds on the combined season-context multiplier. */
export const MIN_FORM_MULTIPLIER = 0.80;
export const MAX_FORM_MULTIPLIER = 1.60;

/** Value ceiling / floor, in €M. */
export const MARKET_VALUE_CAP = 150;
export const MARKET_VALUE_FLOOR = 0.2;

/**
 * Value tier table. Shared by both the initial and the present valuation so
 * the two scales can never drift apart.
 *
 *   Star (90+)     → €60-96M
 *   Top  (80-89)   → €25-60M
 *   Solid (70-79)  → €8-25M
 *   Average (60-69)→ €2-8M
 *   Lower (<60)    → €0.5-3M
 */
function tierBase(r: number): number {
  if (r >= 90) return 60 + (r - 90) * 4; // 90→60, 99→96
  if (r >= 80) return 25 + (r - 80) * 3.5;
  if (r >= 70) return 8 + (r - 70) * 1.7;
  if (r >= 60) return 2 + (r - 60) * 0.6;
  return 0.5 + Math.max(0, r - 40) * 0.13;
}

/** Position multipliers: FW 1.2x, MF 1.0x, DF 0.9x, GK 0.8x. */
function positionMultiplier(position: Player['position']): number {
  return position === 'FW' ? 1.2 : position === 'MF' ? 1.0 : position === 'DF' ? 0.9 : 0.8;
}

/**
 * The rating the market actually prices.
 *
 * Young players are still partly priced on their ceiling — that is what a
 * resale premium IS — but the potential share decays linearly and is gone
 * entirely by POTENTIAL_PRICED_UNTIL_AGE. Past that age a 73-rated player is
 * priced as a 73-rated player, no matter what he was once destined to be.
 *
 * Age carries exactly one further term — `resaleMultiplier` — and it is
 * deliberately much flatter than the old `ageMultiplier`. The cached
 * `rating` has already absorbed the development curve's ability decay, so a
 * steep age curve on top would tax veterans twice. What is left to express
 * is only resale / contract-length value: years remaining.
 */
export function pricingRating(player: Player): number {
  const current = typeof player.rating === 'number' ? player.rating : 60;
  const peak = player.peakRating;
  if (typeof peak !== 'number' || peak <= 0) return current;
  const age = player.age ?? 25;
  if (age >= POTENTIAL_PRICED_UNTIL_AGE) return current;
  const ramp = Math.max(0, Math.min(1, (age - 18) / (POTENTIAL_PRICED_UNTIL_AGE - 18)));
  const potentialWeight = MAX_POTENTIAL_WEIGHT * (1 - ramp);
  return current * (1 - potentialWeight) + peak * potentialWeight;
}

/**
 * Years-remaining term. NOT an ability curve — `rating` already carries
 * that. This is resale risk and contract length only, which is why it is
 * flat across the whole peak and gentle at both ends.
 */
export function resaleMultiplier(age: number): number {
  if (age <= 23) return 1.08; // years remaining is the asset
  if (age <= 29) return 1.00;
  if (age <= 32) return 0.92;
  if (age <= 35) return 0.80;
  return 0.65;
}

/**
 * What the player is worth on his own merits right now — the anchor every
 * revaluation converges on. Position, resale and the glass-tag haircut apply;
 * season context deliberately does NOT (that is the form multiplier's job).
 */
export function computePresentMarketValue(player: Player): number {
  const base = tierBase(pricingRating(player));
  const posMul = positionMultiplier(player.position);
  const resaleMul = resaleMultiplier(player.age ?? 25);
  // v17 — tag effect: glass-prone players take a 30% market value haircut
  // (high injury risk depresses what buyers will pay).
  const tagMul = player.tag === 'glass' ? 0.7 : 1.0;
  return Math.max(0.3, Math.round(base * posMul * resaleMul * tagMul * 10) / 10);
}

/**
 * Compute initial market value from rating + position + age.
 * Returns value in millions (€).
 *
 * The base tier is keyed off `peakRating` (the player's destined ceiling),
 * NOT the cached `rating` — `rating` is itself age-scaled by the development
 * curve, so multiplying by `ageMultiplier(age)` on top would double-count
 * the age penalty. The age multiplier here represents *market perception*
 * (resale risk, contract length expectations, etc.) which exists
 * independently of on-pitch ability.
 *
 * This is the FIRST-VALUATION function. Annual revaluation runs through
 * `computePresentMarketValue` instead — see the header note.
 *
 * Falls back to `player.rating` for the base when `peakRating` is missing —
 * keeps this function callable from migration paths or test fixtures that
 * pre-date the v9→v10 schema.
 */
export function computeInitialMarketValue(player: Player): number {
  const r = (typeof player.peakRating === 'number' && player.peakRating > 0)
    ? player.peakRating
    : player.rating;
  const base = tierBase(r);
  const posMul = positionMultiplier(player.position);
  const ageMul = ageMultiplier(player.age ?? 25);
  const tagMul = player.tag === 'glass' ? 0.7 : 1.0;
  return Math.max(0.3, Math.round(base * posMul * ageMul * tagMul * 10) / 10);
}

export function ageMultiplier(age: number): number {
  if (age <= 19) return 1.15; // wonderkid
  if (age <= 22) return 1.10; // young
  if (age <= 25) return 1.05; // rising
  if (age <= 29) return 1.0;  // peak
  if (age <= 32) return 0.85; // veteran
  if (age <= 35) return 0.6;
  return 0.35;
}

/**
 * Move `previous` toward `target` by the market's inertia factor. Perception
 * lags reality, so a single season never moves the price all the way — but
 * the gap also closes, which is what stops value from riding its own
 * history forever. An old save therefore converges onto the current scale
 * within two or three seasons without any migration.
 */
export function applyMarketInertia(previous: number | undefined, target: number): number {
  const from = typeof previous === 'number' && previous > 0 ? previous : target;
  return from + (target - from) * REVALUATION_INERTIA;
}

/**
 * Annual revaluation at season-end based on stats and team success.
 * Mutates the players array in place — call from season-end.
 *
 * Side effects per player:
 *   1. age = age + 1
 *   2. rating recomputed from (peakRating, newAge, peakAge) — so the cached
 *      Player.rating tracks the curve without callers having to recompute.
 *   3. marketValue re-anchored on `computePresentMarketValue`, lifted by a
 *      BOUNDED season-context multiplier, then eased toward that target.
 *
 * `peakRating` and `peakAge` are NEVER mutated here — they're immutable
 * destiny attributes set at generation (or backfilled by v9→v10).
 *
 * Phase G: players carrying an ACTIVE major / long_term injury (still
 * sidelined past the current global window counter) take a 10% haircut on
 * marketValue — "伤情打折". Caller passes `currentWindowIdx`; defaults to 0
 * for backward-compatible test paths that don't yet track injuries.
 */
export function applyAnnualRevaluation(
  squads: Record<string, Player[]>,
  playerStats: Record<string, PlayerSeasonStats>,
  promotedTeamIds: Set<string>,
  championTeamId: string | null,
  currentWindowIdx: number = 0,
): void {
  for (const [teamId, players] of Object.entries(squads)) {
    const isPromoted = promotedTeamIds.has(teamId);
    const isChampion = teamId === championTeamId;
    for (const p of players) {
      // Age each player
      const newAge = (p.age ?? 25) + 1;
      p.age = newAge;
      // Recompute current rating from the development curve. peakRating /
      // peakAge are immutable; rating is the cached projection. If a save
      // is mid-migration and missing peakRating, fall back to the old rating
      // so the worst-case is "rating doesn't shift this season".
      if (typeof p.peakRating === 'number' && typeof p.peakAge === 'number') {
        p.rating = computeCurrentRating(p.peakRating, newAge, p.peakAge);
      }

      // Fresh anchor — what he is worth on his own merits this season.
      const anchor = computePresentMarketValue(p);

      // Season context. Same signals as before, but they now scale a fresh
      // anchor instead of last year's number, and the product is clamped so
      // no combination of good fortune can run away.
      let form = 1;
      const stats = playerStats[p.uuid];
      if (stats) {
        const goals = stats.goals ?? 0;
        const assists = stats.assists ?? 0;
        const involvement = goals * 1.0 + assists * 0.5;
        if (involvement >= 25) form *= 1.40;
        else if (involvement >= 15) form *= 1.25;
        else if (involvement >= 8) form *= 1.10;
        else if ((stats.appearances ?? 0) < 5) form *= 0.85; // benched
      }
      if (isPromoted) form *= 1.30;
      if (isChampion) form *= 1.15;
      form = Math.max(MIN_FORM_MULTIPLIER, Math.min(MAX_FORM_MULTIPLIER, form));

      let target = anchor * form;

      // Phase G: long-injury haircut. Buyers price in the recovery risk and
      // the games missed; we model it as -10% for any player whose latest
      // injury is still active and was major / long_term. Applied AFTER the
      // clamp so a floor-bound season cannot swallow it.
      const lastInj = p.injuryHistory?.[p.injuryHistory.length - 1];
      const stillSidelined = (p.injuredUntilWindow ?? 0) > currentWindowIdx;
      if (stillSidelined && lastInj && (lastInj.type === 'major' || lastInj.type === 'long_term')) {
        target *= 0.90;
      }

      const next = applyMarketInertia(p.marketValue, target);
      p.marketValue = Math.max(MARKET_VALUE_FLOOR, Math.min(MARKET_VALUE_CAP, Math.round(next * 10) / 10));
    }
  }
}

/** Format value in millions: €85M or €1.5M */
export function formatMarketValue(value: number): string {
  if (value >= 10) return `€${Math.round(value)}M`;
  return `€${value.toFixed(1)}M`;
}

/** Sum a team's squad market value. */
export function getTeamSquadValue(players: Player[]): number {
  return players.reduce((sum, p) => sum + (p.marketValue ?? 0), 0);
}
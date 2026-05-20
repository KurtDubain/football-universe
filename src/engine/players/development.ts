import { Player } from '../../types/player';

/**
 * Player development / aging curve (revised after S16 migration sim showed
 * the previous slope was too steep — 412/704 players hit the floor of 30,
 * making post-migration universe near-uniformly weak).
 *
 * A pure function from (peakRating, age, peakAge) → currentRating:
 *   - Below 18: 0.65× (kids)
 *   - 18 → peakAge − 2: linear ramp from 0.70× to 1.00×
 *   - peakAge ± 2: full plateau (1.00×)
 *   - peakAge + 3..+5: -0.025/yr (1.00 → 0.925, gentle veteran)
 *   - peakAge + 6..+10: -0.035/yr (0.925 → 0.75, late career)
 *   - peakAge + 11..+15: -0.040/yr (0.75 → 0.55, twilight)
 *   - past peakAge + 15: -0.050/yr, floored at 0.40× (very-old)
 *
 * The result is rounded and clamped to [35, 99] (raised from 30 — a 35-rated
 * player is still distinguishable from useless on the bench, while 30 felt
 * like everyone hit the same wall).
 */
export function computeCurrentRating(
  peakRating: number,
  age: number,
  peakAge: number,
): number {
  // Defensive normalization — the curve must never throw on a partial input.
  const safePeak = Number.isFinite(peakRating) ? peakRating : 60;
  const safeAge = Number.isFinite(age) && age >= 0 ? age : 18;
  const rawPeakAge = Number.isFinite(peakAge) ? peakAge : 27;
  const safePeakAge = Math.max(22, Math.min(32, rawPeakAge));

  let mul: number;
  if (safeAge < 18) {
    mul = 0.65;
  } else if (safeAge < safePeakAge - 2) {
    // Rising: linear from 0.70 at 18 → 1.00 at peakAge - 2.
    const t = (safeAge - 18) / Math.max(1, safePeakAge - 2 - 18);
    mul = 0.70 + 0.30 * Math.max(0, Math.min(1, t));
  } else if (safeAge <= safePeakAge + 2) {
    // Plateau (5 yrs centered on peakAge)
    mul = 1.00;
  } else if (safeAge <= safePeakAge + 5) {
    // Gentle veteran (3 yrs)
    mul = 1.00 - (safeAge - safePeakAge - 2) * 0.025;
  } else if (safeAge <= safePeakAge + 10) {
    // Late career (5 yrs)
    mul = 0.925 - (safeAge - safePeakAge - 5) * 0.035;
  } else if (safeAge <= safePeakAge + 15) {
    // Twilight (5 yrs)
    mul = 0.75 - (safeAge - safePeakAge - 10) * 0.040;
  } else {
    // Very-old tail
    mul = Math.max(0.40, 0.55 - (safeAge - safePeakAge - 15) * 0.050);
  }
  const computed = Math.round(safePeak * mul);
  return Math.max(35, Math.min(99, computed));
}

/**
 * Returns a NEW squads object whose every Player has its `rating` recomputed
 * from `peakRating` + `age` + `peakAge`. Designed for the season-end hook
 * after age has been bumped.
 *
 * Each squad array is a fresh array; each Player is a fresh object — callers
 * that hold a reference to the old object see no mutation. `peakRating` and
 * `peakAge` are carried forward unchanged.
 *
 * Players missing `peakRating` (a v9 save not yet migrated) get
 * `peakRating = rating` as a fallback so this function is safe to call even
 * during a half-applied migration. The migration itself is the canonical
 * place to populate these fields.
 */
export function recomputeAllRatings(
  squads: Record<string, Player[]>,
): Record<string, Player[]> {
  const out: Record<string, Player[]> = {};
  for (const [teamId, squad] of Object.entries(squads)) {
    if (!Array.isArray(squad)) {
      out[teamId] = squad;
      continue;
    }
    out[teamId] = squad.map((p) => {
      const peak = Number.isFinite(p.peakRating) ? p.peakRating : p.rating;
      const peakAge = Number.isFinite(p.peakAge) ? p.peakAge : 27;
      const newRating = computeCurrentRating(peak, p.age ?? 27, peakAge);
      return { ...p, rating: newRating, peakRating: peak, peakAge };
    });
  }
  return out;
}

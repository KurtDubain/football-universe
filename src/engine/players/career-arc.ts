import { computeCurrentRating } from './development';

/**
 * One sample on a player's career rating arc — the rating they would have
 * shown at age `age`, given a frozen `peakRating` + `peakAge`.
 */
export interface CareerArcPoint {
  age: number;
  rating: number;
}

/**
 * Build a deterministic career trajectory for the legends-page mini chart.
 *
 * Walks every integer age in `[startAge, endAge]` and computes the curve
 * value via the canonical `computeCurrentRating` — the same function used
 * by the season-end recompute pass, so the arc here matches "what the
 * player actually looked like" at each season turn (no UI-side drift).
 *
 * Defaults: startAge = 18 (when ratings start flowing through the curve;
 * before 18 the multiplier is a flat kid-discount and the line would be
 * uninteresting), endAge = retirementAge (so the arc tells the full story).
 *
 * `peakAge` falls back to 27 when the retirement record predates v10
 * peakAge tracking — keeps legacy retirees renderable without an explicit
 * empty-state branch in the UI.
 */
export function buildCareerArc(
  peakRating: number,
  retirementAge: number,
  peakAge: number = 27,
  startAge: number = 18,
): CareerArcPoint[] {
  // Guard against malformed retirement records that would otherwise produce
  // an empty / inverted arc. We always emit at least one point so the SVG
  // path never collapses into a zero-length stroke (which renders nothing).
  const safeStart = Math.max(0, Math.floor(startAge));
  const safeEnd = Math.max(safeStart, Math.floor(retirementAge));
  const safePeak = Number.isFinite(peakAge) ? peakAge : 27;
  const points: CareerArcPoint[] = [];
  for (let age = safeStart; age <= safeEnd; age++) {
    points.push({ age, rating: computeCurrentRating(peakRating, age, safePeak) });
  }
  return points;
}

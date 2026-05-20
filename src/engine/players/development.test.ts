import { describe, it, expect } from 'vitest';
import { computeCurrentRating, recomputeAllRatings } from './development';
import { Player } from '../../types/player';

/**
 * Tests for the player development curve.
 *
 * The curve has six segments — these tests pin one anchor per segment plus
 * boundary cases (NaN, missing peakAge, floor/ceiling clamps).
 */
describe('computeCurrentRating', () => {
  it('returns peakRating exactly at peakAge (plateau apex, no rounding loss)', () => {
    // peakRating * 1.00 = peakRating, then round → unchanged
    expect(computeCurrentRating(85, 27, 27)).toBe(85);
    expect(computeCurrentRating(99, 26, 26)).toBe(99);
    expect(computeCurrentRating(60, 24, 24)).toBe(60);
  });

  it('plateau spans peakAge ± 2 — full peak across 5 years', () => {
    // peakAge=27 → ages 25,26,27,28,29 all yield exactly peakRating.
    for (const age of [25, 26, 27, 28, 29]) {
      expect(computeCurrentRating(80, age, 27)).toBe(80);
    }
  });

  it('rookies under 18 get 0.65× multiplier', () => {
    // 16 → 0.65 × 80 = 52
    expect(computeCurrentRating(80, 16, 27)).toBe(52);
    // Floor at 35: 0.65 × 40 = 26 → clamped to 35
    expect(computeCurrentRating(40, 12, 27)).toBe(35);
  });

  it('rising segment ramps linearly 0.70 → 1.00 between age 18 and peakAge − 2', () => {
    // peakAge=27, peakAge-2=25. At 18: 0.70. At 25: 1.00.
    expect(computeCurrentRating(80, 18, 27)).toBe(56); // 0.70 × 80
    expect(computeCurrentRating(80, 25, 27)).toBe(80); // 1.00 × 80 (also start of plateau)
    // Midpoint: 21 — t = (21-18)/(25-18) = 3/7 ≈ 0.4286. mul ≈ 0.70 + 0.30*0.4286 ≈ 0.8286.
    // 0.8286 * 80 = 66.29 → 66
    expect(computeCurrentRating(80, 21, 27)).toBe(66);
  });

  it('first decline window (peakAge+3 .. +5) drops 0.025 per year', () => {
    // peakAge=27, peakRating=90.
    // age 30: 1.00 - (30-29)*0.025 = 0.975 → 88 (round of 87.75)
    expect(computeCurrentRating(90, 30, 27)).toBe(88);
    // age 32: 1.00 - (32-29)*0.025 = 0.925 → 83 (round of 83.25)
    expect(computeCurrentRating(90, 32, 27)).toBe(83);
  });

  it('second decline window (peakAge+6 .. +10) drops 0.035 per year from 0.925', () => {
    // peakAge=27, peakRating=90.
    // age 33: 0.925 - (33-32)*0.035 = 0.890 → 80 (round of 80.1)
    expect(computeCurrentRating(90, 33, 27)).toBe(80);
    // age 37: 0.925 - (37-32)*0.035 = 0.750 → 68 (round of 67.5)
    expect(computeCurrentRating(90, 37, 27)).toBe(68);
  });

  it('twilight window (peakAge+11 .. +15) drops 0.040 per year from 0.75', () => {
    // peakAge=27, peakRating=90.
    // age 38: 0.75 - (38-37)*0.040 = 0.710 → 64 (round of 63.9)
    expect(computeCurrentRating(90, 38, 27)).toBe(64);
    // age 42: 0.75 - (42-37)*0.040 = 0.550 → 50 (round of 49.5)
    expect(computeCurrentRating(90, 42, 27)).toBe(50);
  });

  it('very-old tail (past peakAge+15) drops 0.05 per year, floored at 0.40×', () => {
    // peakAge=27, peakRating=90.
    // age 43: max(0.40, 0.55 - (43-42)*0.050) = 0.500 → 45 (round of 45.0)
    expect(computeCurrentRating(90, 43, 27)).toBe(45);
    // age 50: max(0.40, 0.55 - 8*0.050) = 0.40 (floor) → 36
    expect(computeCurrentRating(90, 50, 27)).toBe(36);
    // Extreme: 100 yo → still floor of 0.40 × 90 = 36
    expect(computeCurrentRating(90, 100, 27)).toBe(36);
  });

  it('late vs early bloomers diverge at the same age', () => {
    // Two players both peakRating=85, age=23, but with different peak ages.
    // Late bloomer (peakAge=29): 23 < 27 (peakAge-2), still rising → ~75
    // Early bloomer (peakAge=24): 23 = 22 (peakAge-2)? 23 > 22 → plateau → 85
    const late = computeCurrentRating(85, 23, 29);
    const early = computeCurrentRating(85, 23, 24);
    expect(early).toBeGreaterThan(late);
    expect(early).toBe(85); // 23 in plateau
  });

  it('clamps result to [35, 99]', () => {
    // peakRating > 99 should be clamped (defensive — generator never produces this)
    expect(computeCurrentRating(110, 27, 27)).toBe(99);
    // Very low peak + steep decline → floor at 35
    expect(computeCurrentRating(35, 60, 25)).toBe(35);
  });

  it('handles missing/NaN peakRating gracefully (falls back to 60)', () => {
    expect(computeCurrentRating(NaN, 27, 27)).toBe(60); // 60 × 1.00 = 60
    // Number.isFinite(undefined) → false, but TS would normally reject. Test
    // the runtime safety with a cast.
    expect(computeCurrentRating(undefined as unknown as number, 27, 27)).toBe(60);
  });

  it('handles negative or NaN age (treated as 18, rookie floor)', () => {
    // age -5 → 18 → rising segment t=0 → 0.70 × peakRating
    expect(computeCurrentRating(80, -5, 27)).toBe(56);
    expect(computeCurrentRating(80, NaN, 27)).toBe(56);
  });

  it('handles missing peakAge (falls back to 27, the median)', () => {
    // age 27, fallback peakAge 27 → plateau → exact peak
    expect(computeCurrentRating(80, 27, NaN)).toBe(80);
    expect(computeCurrentRating(80, 27, undefined as unknown as number)).toBe(80);
  });

  it('clamps absurd peakAge values to [22, 32] band', () => {
    // peakAge=18 → clamped to 22. age=20 → in rising segment for clamped
    // peakAge=22, peakAge-2=20, so age=20 is the start of plateau → mul=1.0
    expect(computeCurrentRating(80, 20, 18)).toBe(80);
    // peakAge=99 → clamped to 32. age=27 → still rising (27 < 30=peakAge-2)
    // t = (27-18)/(32-2-18) = 9/12 = 0.75 → mul = 0.70 + 0.30*0.75 = 0.925
    // 80 * 0.925 = 74
    expect(computeCurrentRating(80, 27, 99)).toBe(74);
  });

  it('is monotonically non-increasing past peakAge+2', () => {
    // From age 30 onward, rating only goes DOWN (or stays equal at boundaries
    // due to rounding). Pin a few consecutive ages to confirm.
    let prev = computeCurrentRating(95, 30, 27);
    for (let age = 31; age <= 50; age++) {
      const r = computeCurrentRating(95, age, 27);
      expect(r).toBeLessThanOrEqual(prev);
      prev = r;
    }
  });

  it('boundary: peakAge ± 2 plateau edges flow into decline cleanly', () => {
    // peakAge=27. Plateau: 25..29 → 1.00. Just past: 30 → first decline
    // segment, mul=1.00 - (30-29)*0.025 = 0.975. Smaller than plateau edge.
    const plateauTop = computeCurrentRating(95, 29, 27);
    const declineStart = computeCurrentRating(95, 30, 27);
    expect(plateauTop).toBe(95);
    expect(declineStart).toBe(93); // round(95 * 0.975) = 92.6 → 93
    expect(declineStart).toBeLessThan(plateauTop);
  });
});

describe('recomputeAllRatings', () => {
  function mkPlayer(uuid: string, age: number, peakRating: number, peakAge: number): Player {
    return {
      uuid, teamId: 'A', name: uuid, number: 1, position: 'FW',
      rating: 0, // intentionally stale — recompute should overwrite
      peakRating, peakAge, goalScoring: 50, marketValue: 10, age,
    };
  }

  it('returns a NEW squads object (no mutation of input)', () => {
    const original = { teamA: [mkPlayer('p-1', 25, 80, 27)] };
    const result = recomputeAllRatings(original);
    expect(result).not.toBe(original);
    expect(result.teamA).not.toBe(original.teamA);
    expect(result.teamA[0]).not.toBe(original.teamA[0]);
    // Original still has stale rating 0
    expect(original.teamA[0].rating).toBe(0);
    // Result has the recomputed value
    expect(result.teamA[0].rating).toBe(80);
  });

  it('refreshes rating across an aging player (year-over-year)', () => {
    const youngPlayer = mkPlayer('p-1', 20, 90, 27);
    const result1 = recomputeAllRatings({ teamA: [youngPlayer] });
    const r1 = result1.teamA[0].rating;
    // Now age them up to 25 (still rising / plateau-adjacent)
    const result2 = recomputeAllRatings({ teamA: [{ ...youngPlayer, age: 25 }] });
    const r2 = result2.teamA[0].rating;
    expect(r2).toBeGreaterThanOrEqual(r1); // ages 20→25 → rating climbs
    expect(r2).toBe(90); // 25 == peakAge-2 → plateau
  });

  it('preserves peakRating and peakAge unchanged', () => {
    const result = recomputeAllRatings({
      teamA: [mkPlayer('p-1', 35, 92, 26)],
    });
    expect(result.teamA[0].peakRating).toBe(92);
    expect(result.teamA[0].peakAge).toBe(26);
  });

  it('handles missing peakRating/peakAge by falling back to current rating + 27', () => {
    // Simulate a half-migrated player — only `rating` set, no peak fields.
    const p: Player = {
      uuid: 'p-x', teamId: 'A', name: 'x', number: 1, position: 'FW',
      rating: 75, goalScoring: 50, marketValue: 10, age: 27,
      peakRating: undefined as unknown as number,
      peakAge: undefined as unknown as number,
    };
    const result = recomputeAllRatings({ teamA: [p] });
    // Fallback: peakRating = 75, peakAge = 27, age = 27 → plateau → rating = 75
    expect(result.teamA[0].rating).toBe(75);
    expect(result.teamA[0].peakRating).toBe(75);
    expect(result.teamA[0].peakAge).toBe(27);
  });
});

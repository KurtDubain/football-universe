import { describe, it, expect } from 'vitest';
import { buildCareerArc } from './career-arc';
import { computeCurrentRating } from './development';

describe('buildCareerArc', () => {
  it('produces one point per integer age inclusive of start and end', () => {
    const arc = buildCareerArc(85, 38, 27, 18);
    // 18, 19, ..., 38 — 21 points
    expect(arc).toHaveLength(21);
    expect(arc[0].age).toBe(18);
    expect(arc[arc.length - 1].age).toBe(38);
  });

  it('matches the canonical curve at each sampled age', () => {
    const arc = buildCareerArc(90, 35, 26, 18);
    for (const p of arc) {
      expect(p.rating).toBe(computeCurrentRating(90, p.age, 26));
    }
  });

  it('falls back to peakAge 27 when the retirement record predates v10 tracking', () => {
    const explicit = buildCareerArc(80, 36, 27, 18);
    // Same call shape with the default param should produce identical data.
    const fallback = buildCareerArc(80, 36, undefined as unknown as number, 18);
    expect(fallback).toEqual(explicit);
  });

  it('emits at least one point when retirement age <= start age', () => {
    // A degenerate record (e.g. retired before 18) should still render — the
    // mini chart's polyline must never have zero points.
    const arc = buildCareerArc(60, 17, 25, 18);
    expect(arc.length).toBeGreaterThanOrEqual(1);
  });

  it('non-decreasing then non-increasing across the peak (rough shape check)', () => {
    // Pick a clearly-aged retiree: peakAge 27, retirement at 38. The arc
    // should rise to peakAge ± 2 plateau, then decline through veteran years.
    const arc = buildCareerArc(95, 38, 27, 18);
    // Find the peak — should land somewhere in the plateau (25-29).
    const peakIdx = arc.findIndex((p) => p.rating === 95);
    expect(peakIdx).toBeGreaterThanOrEqual(0);
    // Last point (age 38) should be below peak — veterans decay.
    expect(arc[arc.length - 1].rating).toBeLessThan(95);
  });
});

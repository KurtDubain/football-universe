import { describe, it, expect } from 'vitest';
import { rollTagForUuid, TAG_META } from './tags';

describe('rollTagForUuid (v17)', () => {
  it('deterministic — same uuid → same tag', () => {
    const t1 = rollTagForUuid('p-1234');
    const t2 = rollTagForUuid('p-1234');
    expect(t1).toBe(t2);
  });

  it('returns one of the 4 tags or undefined', () => {
    for (let i = 0; i < 100; i++) {
      const t = rollTagForUuid(`p-${i}`);
      if (t !== undefined) {
        expect(['loyal', 'ambitious', 'iron', 'glass']).toContain(t);
      }
    }
  });

  it('distribution roughly matches spec across 1000 uuids', () => {
    const counts: Record<string, number> = { loyal: 0, ambitious: 0, iron: 0, glass: 0, none: 0 };
    for (let i = 0; i < 1000; i++) {
      const t = rollTagForUuid(`uuid-${i}`);
      counts[t ?? 'none']++;
    }
    // Spec: 10% loyal / 10% ambitious / 5% iron / 5% glass / 70% none
    // Tolerance ±3% (100-200 buckets in 1000 samples = standard noise)
    expect(counts.loyal).toBeGreaterThan(50);    // ~100 expected
    expect(counts.loyal).toBeLessThan(150);
    expect(counts.ambitious).toBeGreaterThan(50);
    expect(counts.ambitious).toBeLessThan(150);
    expect(counts.iron).toBeGreaterThan(20);     // ~50 expected
    expect(counts.iron).toBeLessThan(80);
    expect(counts.glass).toBeGreaterThan(20);
    expect(counts.glass).toBeLessThan(80);
    expect(counts.none).toBeGreaterThan(600);    // ~700 expected
    expect(counts.none).toBeLessThan(800);
  });

  it('TAG_META has labels + colors for all 4 tags', () => {
    expect(TAG_META.loyal.label).toBe('忠诚');
    expect(TAG_META.ambitious.label).toBe('野心家');
    expect(TAG_META.iron.label).toBe('铁人');
    expect(TAG_META.glass.label).toBe('玻璃人');
  });
});

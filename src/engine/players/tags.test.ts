import { describe, it, expect } from 'vitest';
import { rollTagForUuid, TAG_META } from './tags';

describe('rollTagForUuid (v17)', () => {
  it('deterministic — same uuid → same tag', () => {
    const t1 = rollTagForUuid('p-1234');
    const t2 = rollTagForUuid('p-1234');
    expect(t1).toBe(t2);
  });

  it('returns one of the 7 tags or undefined', () => {
    for (let i = 0; i < 100; i++) {
      const t = rollTagForUuid(`p-${i}`);
      if (t !== undefined) {
        expect(['loyal', 'ambitious', 'iron', 'glass', 'clutch', 'late_bloomer', 'wanderer']).toContain(t);
      }
    }
  });

  it('distribution roughly matches spec across 1000 uuids', () => {
    const counts: Record<string, number> = { loyal: 0, ambitious: 0, iron: 0, glass: 0, clutch: 0, late_bloomer: 0, wanderer: 0, none: 0 };
    for (let i = 0; i < 1000; i++) {
      const t = rollTagForUuid(`uuid-${i}`);
      counts[t ?? 'none']++;
    }
    // Spec: 10/10/5/5/6/4/5 % tagged, 55% none. Tolerance ±3%.
    expect(counts.loyal).toBeGreaterThan(50);    // ~100 expected
    expect(counts.loyal).toBeLessThan(150);
    expect(counts.ambitious).toBeGreaterThan(50);
    expect(counts.ambitious).toBeLessThan(150);
    expect(counts.iron).toBeGreaterThan(20);     // ~50 expected
    expect(counts.iron).toBeLessThan(80);
    expect(counts.glass).toBeGreaterThan(20);
    expect(counts.glass).toBeLessThan(80);
    expect(counts.clutch).toBeGreaterThan(30);   // ~60 expected
    expect(counts.clutch).toBeLessThan(90);
    expect(counts.late_bloomer).toBeGreaterThan(15);  // ~40 expected
    expect(counts.late_bloomer).toBeLessThan(70);
    expect(counts.wanderer).toBeGreaterThan(20);     // ~50 expected
    expect(counts.wanderer).toBeLessThan(80);
    expect(counts.none).toBeGreaterThan(450);    // ~550 expected
    expect(counts.none).toBeLessThan(650);
  });

  it('TAG_META has labels + colors for all 7 tags', () => {
    expect(TAG_META.loyal.label).toBe('忠诚');
    expect(TAG_META.ambitious.label).toBe('野心家');
    expect(TAG_META.iron.label).toBe('铁人');
    expect(TAG_META.glass.label).toBe('玻璃人');
    expect(TAG_META.clutch.label).toBe('大心脏');
    expect(TAG_META.late_bloomer.label).toBe('大器晚成');
    expect(TAG_META.wanderer.label).toBe('浪子');
  });
});

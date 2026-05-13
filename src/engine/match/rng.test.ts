import { describe, it, expect } from 'vitest';
import { SeededRNG } from './rng';

describe('SeededRNG', () => {
  describe('determinism', () => {
    it('produces the same sequence for the same seed', () => {
      const a = new SeededRNG(42);
      const b = new SeededRNG(42);
      const seqA = Array.from({ length: 20 }, () => a.next());
      const seqB = Array.from({ length: 20 }, () => b.next());
      expect(seqA).toEqual(seqB);
    });

    it('produces different sequences for different seeds', () => {
      const a = new SeededRNG(1);
      const b = new SeededRNG(2);
      const seqA = Array.from({ length: 10 }, () => a.next());
      const seqB = Array.from({ length: 10 }, () => b.next());
      expect(seqA).not.toEqual(seqB);
    });

    it('next() returns floats in [0, 1)', () => {
      const rng = new SeededRNG(123);
      for (let i = 0; i < 200; i++) {
        const v = rng.next();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });
  });

  describe('nextInt', () => {
    it('returns integers within inclusive bounds', () => {
      const rng = new SeededRNG(7);
      for (let i = 0; i < 200; i++) {
        const v = rng.nextInt(5, 10);
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(5);
        expect(v).toBeLessThanOrEqual(10);
      }
    });

    it('handles zero-width range', () => {
      const rng = new SeededRNG(1);
      for (let i = 0; i < 10; i++) {
        expect(rng.nextInt(3, 3)).toBe(3);
      }
    });
  });

  describe('nextFloat', () => {
    it('returns floats in [min, max)', () => {
      const rng = new SeededRNG(99);
      for (let i = 0; i < 200; i++) {
        const v = rng.nextFloat(2, 5);
        expect(v).toBeGreaterThanOrEqual(2);
        expect(v).toBeLessThan(5);
      }
    });
  });

  describe('shuffle', () => {
    it('returns the same elements in a (likely) different order', () => {
      const rng = new SeededRNG(11);
      const orig = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const copy = [...orig];
      const shuffled = rng.shuffle(copy);
      expect(shuffled).toBe(copy); // mutates in place
      expect([...shuffled].sort((a, b) => a - b)).toEqual(orig);
      // Highly unlikely to be identical for 10 elements, but tolerate it.
    });

    it('is deterministic for a fixed seed', () => {
      const a = new SeededRNG(11);
      const b = new SeededRNG(11);
      expect(a.shuffle([1, 2, 3, 4, 5])).toEqual(b.shuffle([1, 2, 3, 4, 5]));
    });
  });

  describe('pick', () => {
    it('returns an element from the array', () => {
      const rng = new SeededRNG(31);
      const pool = ['a', 'b', 'c', 'd'];
      for (let i = 0; i < 50; i++) {
        expect(pool).toContain(rng.pick(pool));
      }
    });
  });

  describe('fork', () => {
    it('returns an independent RNG seeded from current state', () => {
      const parent = new SeededRNG(2024);
      const childA = parent.fork();
      // Mutating parent does not affect already-forked child
      const childAFirst = childA.next();
      parent.next();
      parent.next();
      const childASecond = childA.next();

      const reparent = new SeededRNG(2024);
      const reChild = reparent.fork();
      expect(reChild.next()).toBe(childAFirst);
      expect(reChild.next()).toBe(childASecond);
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  generateFreshCoach,
  deriveCoachBuffsFromStyle,
  formatCandidateCoachId,
  formatFreshCoachId,
} from './coach-generator';
import type { CoachStyle } from '../../types/coach';
import { SeededRNG } from '../match/rng';

// ── 1. id formatting ─────────────────────────────────────

describe('formatCandidateCoachId', () => {
  it('prefixes uuid with c-from-player-', () => {
    expect(formatCandidateCoachId('p-42')).toBe('c-from-player-p-42');
    expect(formatCandidateCoachId('p-9999')).toBe('c-from-player-p-9999');
  });
});

describe('formatFreshCoachId', () => {
  it('prefixes counter with c-fresh-', () => {
    expect(formatFreshCoachId(0)).toBe('c-fresh-0');
    expect(formatFreshCoachId(123)).toBe('c-fresh-123');
  });
});

// ── 2. generateFreshCoach basic shape ─────────────────────

describe('generateFreshCoach — basic shape', () => {
  it('age in [35, 50]', () => {
    for (let s = 0; s < 50; s++) {
      const { coach } = generateFreshCoach(s, new SeededRNG(s + 1));
      expect(coach.age).toBeGreaterThanOrEqual(35);
      expect(coach.age).toBeLessThanOrEqual(50);
    }
  });

  it('rating in [50, 75]', () => {
    for (let s = 0; s < 50; s++) {
      const { coach } = generateFreshCoach(s, new SeededRNG(s + 100));
      expect(coach.rating).toBeGreaterThanOrEqual(50);
      expect(coach.rating).toBeLessThanOrEqual(75);
    }
  });

  it('uses one of the 5 styles', () => {
    const validStyles: CoachStyle[] = ['attacking', 'defensive', 'balanced', 'possession', 'counter'];
    for (let s = 0; s < 50; s++) {
      const { coach } = generateFreshCoach(s, new SeededRNG(s + 200));
      expect(validStyles).toContain(coach.style);
    }
  });

  it('id matches counter via formatFreshCoachId', () => {
    for (const c of [0, 1, 7, 99]) {
      const { coach } = generateFreshCoach(c, new SeededRNG(42));
      expect(coach.id).toBe(formatFreshCoachId(c));
    }
  });

  it('bumps the counter exactly by 1', () => {
    const { nextCounter } = generateFreshCoach(5, new SeededRNG(1));
    expect(nextCounter).toBe(6);
  });

  it('name has the surname-firstname pattern with middle dot', () => {
    const { coach } = generateFreshCoach(0, new SeededRNG(99));
    expect(coach.name).toContain('·');
    // Length sanity — short flavor names trip 4-8 chars typically
    expect(coach.name.length).toBeGreaterThan(2);
    expect(coach.name.length).toBeLessThan(20);
  });

  it('produces different but coherent coaches across seeds', () => {
    const a = generateFreshCoach(0, new SeededRNG(1));
    const b = generateFreshCoach(0, new SeededRNG(2));
    // Different seed → almost certainly different name OR style OR rating
    const sameAll =
      a.coach.name === b.coach.name &&
      a.coach.style === b.coach.style &&
      a.coach.rating === b.coach.rating &&
      a.coach.age === b.coach.age;
    expect(sameAll).toBe(false);
  });

  it('determinism: same seed + counter → same coach', () => {
    const a = generateFreshCoach(7, new SeededRNG(42));
    const b = generateFreshCoach(7, new SeededRNG(42));
    expect(a.coach).toEqual(b.coach);
  });
});

// ── 3. style-specific buff distribution ──────────────────

describe('deriveCoachBuffsFromStyle — style profiles', () => {
  it('attacking: attackBuff > defenseBuff (positive offense bias)', () => {
    let totalAttack = 0;
    let totalDefense = 0;
    const N = 80;
    for (let s = 0; s < N; s++) {
      const buffs = deriveCoachBuffsFromStyle('attacking', new SeededRNG(s));
      totalAttack += buffs.attackBuff;
      totalDefense += buffs.defenseBuff;
    }
    expect(totalAttack / N).toBeGreaterThan(2);
    expect(totalDefense / N).toBeLessThan(0); // negative on average
  });

  it('defensive: defenseBuff > attackBuff', () => {
    let totalAttack = 0;
    let totalDefense = 0;
    const N = 80;
    for (let s = 0; s < N; s++) {
      const buffs = deriveCoachBuffsFromStyle('defensive', new SeededRNG(s + 1000));
      totalAttack += buffs.attackBuff;
      totalDefense += buffs.defenseBuff;
    }
    expect(totalDefense / N).toBeGreaterThan(2);
    expect(totalAttack / N).toBeLessThan(0);
  });

  it('balanced: both attackBuff and defenseBuff are mildly positive', () => {
    let totalAttack = 0;
    let totalDefense = 0;
    const N = 80;
    for (let s = 0; s < N; s++) {
      const buffs = deriveCoachBuffsFromStyle('balanced', new SeededRNG(s + 2000));
      totalAttack += buffs.attackBuff;
      totalDefense += buffs.defenseBuff;
    }
    const avgAtk = totalAttack / N;
    const avgDef = totalDefense / N;
    expect(avgAtk).toBeGreaterThan(0.5);
    expect(avgAtk).toBeLessThan(3);
    expect(avgDef).toBeGreaterThan(0.5);
    expect(avgDef).toBeLessThan(3);
  });

  it('possession: nonzero leagueBuff', () => {
    let totalLeague = 0;
    const N = 80;
    for (let s = 0; s < N; s++) {
      const buffs = deriveCoachBuffsFromStyle('possession', new SeededRNG(s + 3000));
      totalLeague += buffs.leagueBuff;
    }
    expect(totalLeague / N).toBeGreaterThan(0.5);
  });

  it('counter: nonzero cupBuff', () => {
    let totalCup = 0;
    const N = 80;
    for (let s = 0; s < N; s++) {
      const buffs = deriveCoachBuffsFromStyle('counter', new SeededRNG(s + 4000));
      totalCup += buffs.cupBuff;
    }
    expect(totalCup / N).toBeGreaterThan(0.5);
  });

  it('pressureResistance always in [40, 75]', () => {
    for (const style of ['attacking', 'defensive', 'balanced', 'possession', 'counter'] as CoachStyle[]) {
      for (let s = 0; s < 30; s++) {
        const buffs = deriveCoachBuffsFromStyle(style, new SeededRNG(s + 5000));
        expect(buffs.pressureResistance).toBeGreaterThanOrEqual(40);
        expect(buffs.pressureResistance).toBeLessThanOrEqual(75);
      }
    }
  });
});

// ── 4. Determinism ────────────────────────────────────────

describe('deriveCoachBuffsFromStyle — determinism', () => {
  it('same seed → same buffs', () => {
    const a = deriveCoachBuffsFromStyle('attacking', new SeededRNG(2024));
    const b = deriveCoachBuffsFromStyle('attacking', new SeededRNG(2024));
    expect(a).toEqual(b);
  });
});

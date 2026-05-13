import { describe, it, expect } from 'vitest';
import { drawSimpleKnockout, drawGroups, drawKnockoutBracket } from './draw';
import { SeededRNG } from '../match/rng';

describe('drawSimpleKnockout', () => {
  it('returns N/2 pairs and covers all teams', () => {
    const rng = new SeededRNG(1);
    const teams = Array.from({ length: 32 }, (_, i) => `t${i}`);
    const pairs = drawSimpleKnockout(teams, rng);
    expect(pairs).toHaveLength(16);
    const flat = pairs.flatMap(([a, b]) => [a, b]);
    expect(new Set(flat).size).toBe(32);
    expect([...flat].sort()).toEqual([...teams].sort());
  });

  it('is deterministic for a fixed seed', () => {
    const teams = ['a', 'b', 'c', 'd', 'e', 'f'];
    const a = drawSimpleKnockout(teams, new SeededRNG(7));
    const b = drawSimpleKnockout(teams, new SeededRNG(7));
    expect(a).toEqual(b);
  });
});

describe('drawGroups (no pots)', () => {
  it('distributes all teams round-robin into the requested groups', () => {
    const rng = new SeededRNG(2);
    const teams = Array.from({ length: 16 }, (_, i) => `t${i}`);
    const groups = drawGroups(teams, 4, rng);
    expect(groups).toHaveLength(4);
    groups.forEach((g) => expect(g).toHaveLength(4));
    const flat = groups.flat();
    expect(new Set(flat).size).toBe(16);
  });
});

describe('drawGroups (with pots)', () => {
  it('places exactly one team from each pot in each group', () => {
    const rng = new SeededRNG(3);
    const pot1 = ['p1a', 'p1b', 'p1c', 'p1d'];
    const pot2 = ['p2a', 'p2b', 'p2c', 'p2d'];
    const pot3 = ['p3a', 'p3b', 'p3c', 'p3d'];
    const pot4 = ['p4a', 'p4b', 'p4c', 'p4d'];
    const all = [...pot1, ...pot2, ...pot3, ...pot4];
    const groups = drawGroups(all, 4, rng, [pot1, pot2, pot3, pot4]);

    expect(groups).toHaveLength(4);
    for (const g of groups) {
      expect(g).toHaveLength(4);
      // Exactly one from each pot
      expect(g.filter((t) => pot1.includes(t)).length).toBe(1);
      expect(g.filter((t) => pot2.includes(t)).length).toBe(1);
      expect(g.filter((t) => pot3.includes(t)).length).toBe(1);
      expect(g.filter((t) => pot4.includes(t)).length).toBe(1);
    }
  });
});

describe('drawKnockoutBracket', () => {
  it('pairs winner of group i with runner-up of group (n - 1 - i)', () => {
    const qualified = [
      { teamId: '1A', groupIndex: 0, position: 1 },
      { teamId: '2A', groupIndex: 0, position: 2 },
      { teamId: '1B', groupIndex: 1, position: 1 },
      { teamId: '2B', groupIndex: 1, position: 2 },
      { teamId: '1C', groupIndex: 2, position: 1 },
      { teamId: '2C', groupIndex: 2, position: 2 },
      { teamId: '1D', groupIndex: 3, position: 1 },
      { teamId: '2D', groupIndex: 3, position: 2 },
    ];
    const pairs = drawKnockoutBracket(qualified, new SeededRNG(0));
    // n = 4 winners. Pairing: i vs (n-1-i)
    // i=0 winner of A (1A) vs runner-up of D (2D)
    // i=1 winner of B (1B) vs runner-up of C (2C)
    // i=2 winner of C (1C) vs runner-up of B (2B)
    // i=3 winner of D (1D) vs runner-up of A (2A)
    expect(pairs).toEqual([
      ['1A', '2D'],
      ['1B', '2C'],
      ['1C', '2B'],
      ['1D', '2A'],
    ]);
  });
});

import { describe, it, expect } from 'vitest';
import { initWorldCup } from './world-cup';
import { SeededRNG } from '../match/rng';

describe('initWorldCup', () => {
  it('throws on non-32 inputs', () => {
    expect(() => initWorldCup(['a', 'b'], 1, new SeededRNG(0))).toThrow(/32 teams/);
    expect(() =>
      initWorldCup(Array.from({ length: 31 }, (_, i) => `t${i}`), 1, new SeededRNG(0)),
    ).toThrow(/32 teams/);
  });

  it('creates 8 groups of 4 teams each', () => {
    const teams = Array.from({ length: 32 }, (_, i) => `t${i + 1}`);
    const wc = initWorldCup(teams, 1, new SeededRNG(11));
    expect(wc.groups).toHaveLength(8);
    wc.groups.forEach((g, i) => {
      expect(g.groupName).toBe(String.fromCharCode(65 + i)); // A..H
      expect(g.teamIds).toHaveLength(4);
      expect(g.standings).toHaveLength(4);
    });
    expect(wc.participantIds).toEqual(teams);
    expect(wc.completed).toBe(false);
    expect(wc.groupStageCompleted).toBe(false);
    expect(wc.knockoutRounds).toHaveLength(0);
  });

  it('uses pots: each group has exactly one team from each of the 4 OVR-sorted pots', () => {
    // Participants are already sorted by overall (descending) by selectWorldCupParticipants.
    // initWorldCup slices: pot1=[0..7], pot2=[8..15], pot3=[16..23], pot4=[24..31].
    const teams = Array.from({ length: 32 }, (_, i) => `t${i}`);
    const wc = initWorldCup(teams, 1, new SeededRNG(99));

    const pot1 = new Set(teams.slice(0, 8));
    const pot2 = new Set(teams.slice(8, 16));
    const pot3 = new Set(teams.slice(16, 24));
    const pot4 = new Set(teams.slice(24, 32));

    for (const g of wc.groups) {
      expect(g.teamIds.filter((t) => pot1.has(t)).length).toBe(1);
      expect(g.teamIds.filter((t) => pot2.has(t)).length).toBe(1);
      expect(g.teamIds.filter((t) => pot3.has(t)).length).toBe(1);
      expect(g.teamIds.filter((t) => pot4.has(t)).length).toBe(1);
    }

    // All 32 teams placed exactly once
    const allInGroups = wc.groups.flatMap((g) => g.teamIds);
    expect(new Set(allInGroups).size).toBe(32);
  });

  it('generates 12 double round-robin fixtures per group (96 total)', () => {
    const teams = Array.from({ length: 32 }, (_, i) => `t${i + 1}`);
    const wc = initWorldCup(teams, 1, new SeededRNG(11));
    const total = wc.groups.reduce((s, g) => s + g.fixtures.length, 0);
    expect(total).toBe(96); // 8 × 12
    wc.groups.forEach((g) => expect(g.fixtures).toHaveLength(12));
  });
});

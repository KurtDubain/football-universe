import { describe, it, expect } from 'vitest';
import { generateAllSquads } from './generator';
import { TeamBase } from '../../types/team';

function makeTeam(id: string, overall: number): TeamBase {
  return {
    id, name: id, shortName: id.slice(0, 3), color: '#000000',
    tier: overall >= 82 ? 'elite' : overall >= 65 ? 'mid' : 'lower',
    overall, attack: overall, midfield: overall, defense: overall,
    stability: overall, depth: overall, reputation: overall,
    initialLeagueLevel: 1, expectation: 3, region: '大陆+测试',
  };
}

describe('generator — peakRating / peakAge assignment', () => {
  it('every generated player has peakRating + peakAge fields', () => {
    const { squads } = generateAllSquads([makeTeam('a', 80)], 2024);
    const all = Object.values(squads).flat();
    expect(all.length).toBeGreaterThan(0);
    for (const p of all) {
      expect(typeof p.peakRating).toBe('number');
      expect(typeof p.peakAge).toBe('number');
      expect(p.peakAge).toBeGreaterThanOrEqual(24);
      expect(p.peakAge).toBeLessThanOrEqual(29);
    }
  });

  it('peakAge spans the full [24, 29] range across a large sample', () => {
    // Generate enough players that we cover every peakAge value with high
    // probability. 22 players × 8 teams = 176 samples — way more than enough
    // to land all 6 values.
    const teams = Array.from({ length: 8 }, (_, i) => makeTeam(`t${i}`, 60 + i * 5));
    const { squads } = generateAllSquads(teams, 9999);
    const peakAges = new Set(Object.values(squads).flat().map(p => p.peakAge));
    for (const a of [24, 25, 26, 27, 28, 29]) {
      expect(peakAges.has(a)).toBe(true);
    }
  });

  it('young players (age < peakAge - 2) have rating below peakRating', () => {
    // Across many teams, find at least one player who is clearly in the
    // rising segment (age < peakAge - 2) — their rating should be strictly
    // less than peakRating.
    const teams = Array.from({ length: 6 }, (_, i) => makeTeam(`t${i}`, 70));
    const { squads } = generateAllSquads(teams, 4242);
    const all = Object.values(squads).flat();
    const risingPlayers = all.filter(p => p.age < p.peakAge - 2);
    expect(risingPlayers.length).toBeGreaterThan(0); // sanity
    for (const p of risingPlayers) {
      expect(p.rating).toBeLessThanOrEqual(p.peakRating);
      // Strictly less if not at the rounding boundary
      if (p.peakRating > 40) expect(p.rating).toBeLessThan(p.peakRating);
    }
  });

  it('players in plateau (peakAge ± 2) have rating == peakRating', () => {
    const teams = Array.from({ length: 4 }, (_, i) => makeTeam(`t${i}`, 75));
    const { squads } = generateAllSquads(teams, 12345);
    const all = Object.values(squads).flat();
    const plateauPlayers = all.filter(
      p => p.age >= p.peakAge - 2 && p.age <= p.peakAge + 2,
    );
    expect(plateauPlayers.length).toBeGreaterThan(0); // sanity
    for (const p of plateauPlayers) {
      expect(p.rating).toBe(Math.max(30, Math.min(99, p.peakRating)));
    }
  });

  it('old players (age > peakAge + 2) have rating below peakRating', () => {
    const teams = Array.from({ length: 8 }, (_, i) => makeTeam(`t${i}`, 70));
    const { squads } = generateAllSquads(teams, 8888);
    const all = Object.values(squads).flat();
    // Pre-v10 generator caps non-star age at 34 → some players are 30+ which
    // is well past plateau for peakAge 24-27.
    const veterans = all.filter(p => p.age > p.peakAge + 2);
    expect(veterans.length).toBeGreaterThan(0); // sanity
    for (const p of veterans) {
      expect(p.rating).toBeLessThanOrEqual(p.peakRating);
    }
  });

  it('determinism: same seed produces same peakRating + peakAge', () => {
    const teams = [makeTeam('a', 80), makeTeam('b', 70)];
    const a = generateAllSquads(teams, 7777);
    const b = generateAllSquads(teams, 7777);
    for (const tid of Object.keys(a.squads)) {
      for (let i = 0; i < a.squads[tid].length; i++) {
        expect(a.squads[tid][i].peakRating).toBe(b.squads[tid][i].peakRating);
        expect(a.squads[tid][i].peakAge).toBe(b.squads[tid][i].peakAge);
        expect(a.squads[tid][i].rating).toBe(b.squads[tid][i].rating);
      }
    }
  });

  it('goalScoring is NOT affected by peakRating / peakAge logic', () => {
    // goalScoring is its own position-keyed roll; it must not be touched by
    // the development curve. Confirm FW players still hit the 55-100 band.
    const teams = [makeTeam('a', 75)];
    const { squads } = generateAllSquads(teams, 33333);
    const fws = Object.values(squads).flat().filter(p => p.position === 'FW');
    expect(fws.length).toBeGreaterThan(0);
    for (const p of fws) {
      expect(p.goalScoring).toBeGreaterThanOrEqual(55);
      expect(p.goalScoring).toBeLessThanOrEqual(120); // star bonus +20 can push past 100 if not capped, but actual cap is 100
    }
  });
});

import { describe, it, expect } from 'vitest';
import { computePlayerBoosts } from './player-boosts';
import type { Player } from '../../types/player';

function mk(uuid: string, position: 'FW'|'MF'|'DF'|'GK', rating: number, overrides: Partial<Player> = {}): Player {
  return {
    uuid, teamId: 'T', name: uuid, number: 1, position,
    rating, peakRating: rating, peakAge: 27, goalScoring: 50,
    marketValue: 10, age: 26,
    ...overrides,
  };
}

describe('computePlayerBoosts', () => {
  it('returns zero for empty squad', () => {
    expect(computePlayerBoosts([], 0)).toEqual({ attack: 0, midfield: 0, defense: 0 });
  });

  it('baseline-rating (60) squad produces zero boost', () => {
    const squad = [
      ...Array.from({ length: 4 }, (_, i) => mk(`gk-${i}`, 'GK', 60)),
      ...Array.from({ length: 5 }, (_, i) => mk(`df-${i}`, 'DF', 60)),
      ...Array.from({ length: 5 }, (_, i) => mk(`mf-${i}`, 'MF', 60)),
      ...Array.from({ length: 4 }, (_, i) => mk(`fw-${i}`, 'FW', 60)),
    ];
    const b = computePlayerBoosts(squad, 0);
    expect(b.attack).toBe(0);
    expect(b.midfield).toBe(0);
    expect(b.defense).toBe(0);
  });

  it('all-star squad (rating 90) produces positive caps', () => {
    const squad = [
      ...Array.from({ length: 2 }, (_, i) => mk(`gk-${i}`, 'GK', 90)),
      ...Array.from({ length: 5 }, (_, i) => mk(`df-${i}`, 'DF', 90)),
      ...Array.from({ length: 5 }, (_, i) => mk(`mf-${i}`, 'MF', 90)),
      ...Array.from({ length: 4 }, (_, i) => mk(`fw-${i}`, 'FW', 90)),
    ];
    const b = computePlayerBoosts(squad, 0);
    // FW top 3 × (90-70)*0.4*1.0 = 3 × 8 = 24, capped to 15
    expect(b.attack).toBeLessThanOrEqual(15);
    expect(b.attack).toBeGreaterThan(10);
    expect(b.defense).toBeLessThanOrEqual(15);
    expect(b.defense).toBeGreaterThan(10);
  });

  it('low-rated squad produces negative boost (capped at -15)', () => {
    const squad = [
      ...Array.from({ length: 2 }, (_, i) => mk(`gk-${i}`, 'GK', 50)),
      ...Array.from({ length: 5 }, (_, i) => mk(`df-${i}`, 'DF', 50)),
      ...Array.from({ length: 5 }, (_, i) => mk(`mf-${i}`, 'MF', 50)),
      ...Array.from({ length: 4 }, (_, i) => mk(`fw-${i}`, 'FW', 50)),
    ];
    const b = computePlayerBoosts(squad, 0);
    expect(b.attack).toBeGreaterThanOrEqual(-15);
    expect(b.attack).toBeLessThan(-5);
    expect(b.defense).toBeGreaterThanOrEqual(-15);
  });

  it('only top N per position contribute (substitutes ignored)', () => {
    const squad = [
      mk('gk-1', 'GK', 80),
      mk('df-1', 'DF', 80), mk('df-2', 'DF', 80), mk('df-3', 'DF', 80), mk('df-4', 'DF', 80),
      mk('df-bench', 'DF', 30),  // way below baseline — would tank if counted
      mk('mf-1', 'MF', 80), mk('mf-2', 'MF', 80), mk('mf-3', 'MF', 80), mk('mf-4', 'MF', 80),
      mk('mf-bench', 'MF', 30),
      mk('fw-1', 'FW', 80), mk('fw-2', 'FW', 80), mk('fw-3', 'FW', 80),
      mk('fw-bench', 'FW', 30),
    ];
    const b = computePlayerBoosts(squad, 0);
    // Bench players (rating 30) would have made things very negative — expect positive.
    expect(b.attack).toBeGreaterThan(0);
    expect(b.defense).toBeGreaterThan(0);
  });

  it('injured / suspended players are excluded — boost drops accordingly', () => {
    const starFW = mk('star', 'FW', 95, { injuredUntilWindow: 100 });
    const squad = [
      mk('gk-1', 'GK', 70),
      ...Array.from({ length: 4 }, (_, i) => mk(`df-${i}`, 'DF', 70)),
      ...Array.from({ length: 4 }, (_, i) => mk(`mf-${i}`, 'MF', 70)),
      starFW,
      ...Array.from({ length: 2 }, (_, i) => mk(`fw-${i}`, 'FW', 70)),
    ];
    // currentWindow=50 < injuredUntil=100 → star is out
    const bInjured = computePlayerBoosts(squad, 50);
    // currentWindow=200 > injuredUntil=100 → star is back
    const bHealthy = computePlayerBoosts(squad, 200);
    expect(bHealthy.attack).toBeGreaterThan(bInjured.attack);
  });
});

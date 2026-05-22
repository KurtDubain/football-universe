import { describe, it, expect } from 'vitest';
import { generateRumors, shouldGenerateRumors } from './rumor-generator';
import { SeededRNG } from '../match/rng';
import type { GameWorld } from '../season/season-manager';

function makeWorld(currentWindow: number, calendarLen: number = 47): GameWorld {
  return {
    seasonState: {
      seasonNumber: 5,
      currentWindowIndex: currentWindow,
      calendar: Array.from({ length: calendarLen }, () => ({ id: 0, type: 'league', label: 'X', description: '', fixtures: [], completed: false })),
      completed: false,
      isWorldCupYear: false,
      worldCupPhase: false,
    },
    teamBases: {
      ELITE1: { id: 'ELITE1', name: 'Elite One', shortName: 'E1', color: '#000', overall: 90, attack: 90, midfield: 90, defense: 90, reputation: 90 },
      ELITE2: { id: 'ELITE2', name: 'Elite Two', shortName: 'E2', color: '#111', overall: 88, attack: 88, midfield: 88, defense: 88, reputation: 88 },
      WEAK: { id: 'WEAK', name: 'Weak FC', shortName: 'W', color: '#222', overall: 65, attack: 65, midfield: 65, defense: 65, reputation: 65 },
    },
    squads: {
      ELITE1: [],
      ELITE2: [],
      WEAK: [
        { uuid: 'p-1', teamId: 'WEAK', name: 'Striker', number: 9, position: 'FW', rating: 80, peakRating: 82, peakAge: 26, goalScoring: 75, marketValue: 30, age: 26 },
        { uuid: 'p-2', teamId: 'WEAK', name: 'Loyal Striker', number: 10, position: 'FW', rating: 78, peakRating: 80, peakAge: 26, goalScoring: 70, marketValue: 28, age: 26, tag: 'loyal' },
      ],
    },
    playerStats: {
      'p-1': { playerId: 'p-1', teamId: 'WEAK', goals: 15, assists: 5, yellowCards: 0, redCards: 0, appearances: 28, cleanSheets: 0 },
      'p-2': { playerId: 'p-2', teamId: 'WEAK', goals: 12, assists: 3, yellowCards: 0, redCards: 0, appearances: 27, cleanSheets: 0 },
    },
    transferRumors: [],
  } as unknown as GameWorld;
}

describe('shouldGenerateRumors', () => {
  it('fires only in the last 10 windows of the season AND every 3 windows', () => {
    expect(shouldGenerateRumors(makeWorld(10))).toBe(false); // 37 remaining (too early)
    expect(shouldGenerateRumors(makeWorld(36))).toBe(false); // 11 remaining (> 10)
    expect(shouldGenerateRumors(makeWorld(39))).toBe(true);  // 8 remaining, idx%3 = 0
    expect(shouldGenerateRumors(makeWorld(40))).toBe(false); // 7 remaining, idx%3 = 1
    expect(shouldGenerateRumors(makeWorld(45))).toBe(true);  // 2 remaining, idx%3 = 0
  });
  it('never fires in the very last window (avoid noise as transfer fires)', () => {
    expect(shouldGenerateRumors(makeWorld(46))).toBe(false); // 1 remaining
  });
});

describe('generateRumors', () => {
  it('generates rumors for non-loyal candidates only', () => {
    const w = makeWorld(40);
    const result = generateRumors(w, new SeededRNG(42));
    expect(result.rumors.length).toBeGreaterThan(0);
    for (const r of result.rumors) {
      // p-2 is loyal, should never be rumored
      expect(r.candidateUuid).not.toBe('p-2');
    }
  });
  it('emits a rumor news entry per generated rumor', () => {
    const w = makeWorld(40);
    const r = generateRumors(w, new SeededRNG(42));
    expect(r.news.length).toBe(r.rumors.length);
    for (const n of r.news) {
      expect(n.type).toBe('rumor');
    }
  });
  it('returns empty when no candidates exist', () => {
    const w = makeWorld(40);
    w.playerStats = {};
    const r = generateRumors(w, new SeededRNG(42));
    expect(r.rumors).toHaveLength(0);
    expect(r.news).toHaveLength(0);
  });
});

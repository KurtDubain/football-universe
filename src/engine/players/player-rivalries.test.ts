import { describe, it, expect } from 'vitest';
import { computePlayerRivals } from './player-rivalries';
import type { GameWorld } from '../season/season-manager';

function makeWorld(): GameWorld {
  return {
    squads: {
      A: [
        { uuid: 'subject', teamId: 'A', name: 'Hero', number: 9, position: 'FW', rating: 85, peakRating: 88, peakAge: 27, goalScoring: 80, marketValue: 60, age: 27 },
      ],
      B: [
        { uuid: 'rival1', teamId: 'B', name: 'Rival 1', number: 9, position: 'FW', rating: 84, peakRating: 86, peakAge: 26, goalScoring: 75, marketValue: 50, age: 26 },
      ],
      C: [
        { uuid: 'rival2', teamId: 'C', name: 'Rival 2', number: 10, position: 'FW', rating: 82, peakRating: 84, peakAge: 28, goalScoring: 78, marketValue: 45, age: 28 },
        // Not a rival — different position
        { uuid: 'mid', teamId: 'C', name: 'Midfielder', number: 8, position: 'MF', rating: 88, peakRating: 90, peakAge: 28, goalScoring: 50, marketValue: 70, age: 28 },
      ],
      D: [
        // Wrong league level — won't appear if subject has level
        { uuid: 'outlier', teamId: 'D', name: 'Outlier', number: 9, position: 'FW', rating: 90, peakRating: 92, peakAge: 27, goalScoring: 80, marketValue: 90, age: 27 },
      ],
    },
    teamBases: {
      A: { id: 'A', name: 'Team A', shortName: 'A', color: '#a00', overall: 80, attack: 80, midfield: 80, defense: 80, reputation: 80 },
      B: { id: 'B', name: 'Team B', shortName: 'B', color: '#0a0', overall: 78, attack: 78, midfield: 78, defense: 78, reputation: 78 },
      C: { id: 'C', name: 'Team C', shortName: 'C', color: '#00a', overall: 76, attack: 76, midfield: 76, defense: 76, reputation: 76 },
      D: { id: 'D', name: 'Team D (L2)', shortName: 'D', color: '#aaa', overall: 65, attack: 65, midfield: 65, defense: 65, reputation: 65 },
    },
    teamStates: {
      A: { leagueLevel: 1 },
      B: { leagueLevel: 1 },
      C: { leagueLevel: 1 },
      D: { leagueLevel: 2 },
    },
    playerAwardsHistory: [],
  } as unknown as GameWorld;
}

describe('computePlayerRivals', () => {
  it('returns top N same-position rivals in same league level, sorted by rating', () => {
    const r = computePlayerRivals(makeWorld(), 'subject', 3);
    // rival1 (rating 84) + rival2 (rating 82), excluding midfielder + outlier (L2)
    expect(r).toHaveLength(2);
    expect(r[0].playerUuid).toBe('rival1');
    expect(r[1].playerUuid).toBe('rival2');
  });
  it('returns empty for unknown player', () => {
    const r = computePlayerRivals(makeWorld(), 'nonexistent', 3);
    expect(r).toEqual([]);
  });
  it('marks derby rivals if config matches', () => {
    const w = makeWorld();
    const r = computePlayerRivals(w, 'subject', 3);
    // No derbies in config for our synthetic teams — should be all false
    for (const rv of r) {
      expect(rv.isDerbyRival).toBe(false);
    }
  });
  it('counts career awards when present', () => {
    const w = makeWorld();
    w.playerAwardsHistory = [
      { season: 1, type: 'mvp', playerId: 'rival1', playerName: 'Rival 1', playerNumber: 9, teamId: 'B', teamName: 'Team B', statValue: 0, statLabel: 'X' },
    ];
    const r = computePlayerRivals(w, 'subject', 3);
    const rival1 = r.find(x => x.playerUuid === 'rival1');
    expect(rival1?.awardCount).toBe(1);
  });
});

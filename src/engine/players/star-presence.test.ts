import { describe, expect, it } from 'vitest';
import type { Player, PlayerSeasonStats } from '../../types/player';
import { selectMatchFeaturedPlayers, selectStarObservations } from './star-presence';

function player(id: string, teamId: string, rating: number, age = 26, peakRating = rating): Player {
  return {
    uuid: id,
    teamId,
    name: id,
    number: 9,
    position: 'FW',
    rating,
    peakRating,
    peakAge: 27,
    goalScoring: 80,
    marketValue: 20,
    age,
  };
}

function stats(item: Player, minutes = 1800): PlayerSeasonStats {
  const appearances = Math.round(minutes / 90);
  return {
    playerId: item.uuid,
    teamId: item.teamId,
    goals: 10,
    assists: 4,
    yellowCards: 0,
    redCards: 0,
    appearances,
    starts: appearances,
    minutesPlayed: minutes,
    cleanSheets: 0,
    saves: 0,
    keyBlocks: 0,
    bigChances: 12,
    keyPasses: 5,
    teamMatchesAllCompetitions: appearances,
  };
}

describe('star presence', () => {
  it('returns every qualifying world-focus player without a fixed display cap', () => {
    const players = Array.from({ length: 14 }, (_, index) => player(`star-${index}`, 'A', 90 - index * 0.1));
    const playerStats = Object.fromEntries(players.map(item => [item.uuid, stats(item)]));
    const result = selectStarObservations(players, { playerStats });

    expect(result.worldFocus).toHaveLength(14);
  });

  it('defines rising stars as under 23 and never uses hidden potential for ordering', () => {
    const highPotential = player('a-high-hidden', 'A', 76, 22, 98);
    const lowPotential = player('b-low-hidden', 'A', 76, 22, 76);
    const agedOut = player('aged-out', 'A', 92, 23, 99);
    const playerStats = Object.fromEntries([highPotential, lowPotential, agedOut]
      .map(item => [item.uuid, stats(item)]));
    const result = selectStarObservations([highPotential, lowPotential, agedOut], { playerStats });

    expect(result.risingStars.map(entry => entry.player.uuid)).toEqual([
      highPotential.uuid,
      lowPotential.uuid,
    ]);
    expect(result.risingStars.some(entry => entry.player.uuid === agedOut.uuid)).toBe(false);
  });

  it('selects at most five actual starters without forcing equal team quotas', () => {
    const homeStarters = Array.from({ length: 7 }, (_, index) => player(`home-${index}`, 'home', 95 - index));
    const awayStarters = Array.from({ length: 4 }, (_, index) => player(`away-${index}`, 'away', 70 - index));
    const all = [...homeStarters, ...awayStarters];
    const playerStats = Object.fromEntries(all.map(item => [item.uuid, stats(item)]));
    const marginalImpacts = all.map((item, index) => ({
      playerId: item.uuid,
      unit: 'attack' as const,
      value: Math.max(0, 2 - index * 0.1),
    }));
    const selected = selectMatchFeaturedPlayers({
      homeStarters,
      awayStarters,
      marginalImpacts,
      playerStats,
    });

    expect(selected).toHaveLength(5);
    expect(selected.every(entry => entry.teamId === 'home')).toBe(true);
    expect(selected.every(entry => homeStarters.some(player => player.uuid === entry.playerId))).toBe(true);
  });

  it('does not fill the live strip with ordinary players below every qualification threshold', () => {
    const ordinary = Array.from({ length: 11 }, (_, index) => player(`ordinary-${index}`, 'home', 70));
    const selected = selectMatchFeaturedPlayers({
      homeStarters: ordinary,
      awayStarters: [],
      marginalImpacts: ordinary.map(item => ({ playerId: item.uuid, unit: 'attack', value: 0 })),
      playerStats: {},
    });

    expect(selected).toEqual([]);
  });

  it('keeps a strong lineup selective when only a few players clear the focus bar', () => {
    const starters = Array.from({ length: 11 }, (_, index) => player(
      `selective-${index}`,
      'home',
      index < 2 ? 91 - index : 82,
    ));
    const selected = selectMatchFeaturedPlayers({
      homeStarters: starters,
      awayStarters: [],
      marginalImpacts: starters.map(item => ({ playerId: item.uuid, unit: 'attack', value: 0.8 })),
      playerStats: {},
    });

    expect(selected.map(entry => entry.playerId)).toEqual(['selective-0', 'selective-1']);
  });
});

import { describe, expect, it } from 'vitest';
import type { Player, PlayerSeasonStats } from '../../types/player';
import { buildMatchFeaturedLineups, selectMatchFeaturedPlayers, selectStarObservations } from './star-presence';
import { selectMatchday } from './injuries';
import { initializeGameWorld } from '../season/season-manager';
import { buildSimulationContext } from '../season/helpers';
import { simulateMatch } from '../match/simulator';
import { SeededRNG } from '../match/rng';

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
  it('reserves default seats for distinct previous winners without removing current stars or extending protection', () => {
    const winner = player('low-winner', 'A', 73);
    const keeper = { ...player('low-keeper', 'B', 72), position: 'GK' as const };
    const stars = Array.from({ length: 18 }, (_, i) => player(`star-${i}`, 'C', 95));
    const honor = { season: 1, type: 'mvp' as const, playerId: winner.uuid, playerName: winner.name,
      playerNumber: 9, teamId: 'A', teamName: 'A', statValue: 83, statLabel: '综合83' };
    const context = { seasonNumber: 2, playerStats: {}, playerAwardsHistory: [honor,
      { ...honor, type: 'golden_boot' as const }, { ...honor, type: 'best_goalkeeper' as const, playerId: keeper.uuid }] };
    const list = selectStarObservations([...stars, winner, keeper], context).worldFocus;
    expect(list.slice(0, 10).map(row => row.player.uuid)).toContain(winner.uuid);
    expect(list.slice(0, 10).map(row => row.player.uuid)).toContain(keeper.uuid);
    expect(new Set(list.map(row => row.player.uuid)).size).toBe(list.length);
    expect(list.slice(0, 10).filter(row => row.player.rating === 95)).toHaveLength(8);
    expect(selectStarObservations([...stars, winner, keeper], { ...context, seasonNumber: 3 }).worldFocus).toHaveLength(18);
  });
  it('never restores an unavailable award winner to a matchday lineup', () => {
    const winner = { ...player('injured-winner', 'A', 83), injuredUntilWindow: 20 };
    const squad = [winner, ...Array.from({ length: 14 }, (_, i) => player(`healthy-${i}`, 'A', 72))];
    const lineups = buildMatchFeaturedLineups({ homeSquad: squad, homeSelection: selectMatchday(squad, 0),
      homeFormation: '4-4-2', awayFormation: '4-4-2', playerStats: {}, seasonNumber: 2,
      playerAwardsHistory: [{ season: 1, type: 'mvp', playerId: winner.uuid, playerName: winner.name,
        playerNumber: 9, teamId: 'A', teamName: 'A', statValue: 83, statLabel: '综合83' }] });
    expect(lineups.homeStarters.some(item => item.uuid === winner.uuid)).toBe(false);
    expect(lineups.featuredPlayers.some(item => item.playerId === winner.uuid)).toBe(false);
  });
  it('changes only focus metadata, not lineups, match outcomes, events or RNG consumption', () => {
    const world = initializeGameWorld(20260709);
    const fixture = world.seasonState.calendar.flatMap(window => window.fixtures)[0];
    const players = [...world.squads[fixture.homeTeamId], ...world.squads[fixture.awayTeamId]];
    for (const seed of [1, 7, 20260709]) {
      const oldRng = new SeededRNG(seed);
      const newRng = new SeededRNG(seed);
      const baseline = buildSimulationContext(fixture, world, oldRng);
      const candidate = { ...buildSimulationContext(fixture, world, newRng), seasonNumber: 2,
        playerAwardsHistory: players.map(player => ({ season: 1, type: 'mvp' as const, playerId: player.uuid,
          playerName: player.name, playerNumber: player.number, teamId: player.teamId, teamName: player.teamId,
          statValue: 83, statLabel: '综合83' })) };
      const before = simulateMatch(baseline, fixture);
      const after = simulateMatch(candidate, fixture);
      delete before.matchResult.featuredPlayers;
      delete after.matchResult.featuredPlayers;
      expect(after).toEqual(before);
      expect(newRng.getState()).toBe(oldRng.getState());
    }
  });
  it('keeps last-season winners eligible without locking their ranking or bypassing the lineup', () => {
    const winner = player('winner', 'A', 83);
    const star = player('current-star', 'A', 95);
    const context = { playerStats: {}, seasonNumber: 2, playerAwardsHistory: [{
      playerId: winner.uuid, playerName: winner.name, playerNumber: 9, teamId: 'A', teamName: 'A',
      season: 1, type: 'mvp' as const, statValue: 83, statLabel: '综合83',
    }] };
    const focus = selectStarObservations([winner, star], context).worldFocus;
    expect(focus.map(entry => entry.player.uuid)).toEqual([star.uuid, winner.uuid]);
    expect(focus[1].fact).toBe('上季金球得主');
    expect(focus[1].factTarget).toBe('/player/winner#awards-S1');
    expect(selectStarObservations([winner], { ...context, seasonNumber: 3 }).worldFocus).toEqual([]);
    const selected = selectMatchFeaturedPlayers({ ...context, homeStarters: [winner], awayStarters: [], marginalImpacts: [] });
    expect(selected[0]).toMatchObject({ playerId: winner.uuid, reason: 'previous_award' });
    expect(selectMatchFeaturedPlayers({ ...context, homeStarters: [], awayStarters: [], marginalImpacts: [] })).toEqual([]);
  });

  it('extends all four major honors and does not invent recognition for a talented youngster', () => {
    const prospect = player('prospect', 'A', 91, 20);
    const observation = selectStarObservations([prospect], { playerStats: {} }).worldFocus[0];
    expect(observation.fact).toContain('基础能力 91');
    expect(observation.fact).not.toMatch(/统治|顶级|得主/);
    for (const type of ['mvp', 'golden_boot', 'best_defender', 'best_goalkeeper'] as const) {
      const context = { playerStats: {}, seasonNumber: 2, playerAwardsHistory: [{
        season: 1, type, playerId: 'low', playerName: '低能力得主', playerNumber: 3,
        teamId: 'A', teamName: 'A', statValue: 33, statLabel: '33球',
      }] };
      expect(selectStarObservations([player('low', 'A', 73)], context).worldFocus).toHaveLength(1);
    }
  });
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

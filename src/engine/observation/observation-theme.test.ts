import { describe, expect, it } from 'vitest';
import {
  executeCurrentWindow,
  initializeGameWorld,
  type GameWorld,
} from '../season/season-manager';
import {
  buildObservationTheme,
  recommendObservationTheme,
  type ObservationThemeType,
} from './observation-theme';

function teamAtLevel(world: GameWorld, level: 1 | 2 | 3): string {
  const teamId = Object.keys(world.teamStates)
    .find(id => world.teamStates[id].leagueLevel === level);
  if (!teamId) throw new Error(`Missing level ${level} team`);
  return teamId;
}

function teamByTier(world: GameWorld, tier: 'elite' | 'mid'): string {
  const teamId = Object.values(world.teamBases)
    .find(team => team.tier === tier && world.teamStates[team.id].leagueLevel === 1)?.id;
  if (!teamId) throw new Error(`Missing ${tier} team`);
  return teamId;
}

describe('observation themes', () => {
  it('recommends a fitting lens without inventing a team for neutral observers', () => {
    const world = initializeGameWorld(20260718);
    const elite = teamByTier(world, 'elite');
    const lowerLeague = teamAtLevel(world, 3);

    expect(recommendObservationTheme(world, null)).toBe('pure_observation');
    expect(recommendObservationTheme(world, elite)).toBe('giant_defense');
    expect(recommendObservationTheme(world, lowerLeague)).toBe('promotion_survival');

    const promotedWorld = structuredClone(world);
    promotedWorld.seasonState.seasonNumber = 2;
    promotedWorld.teamSeasonRecords[elite] = [{
      seasonNumber: 1,
      leagueLevel: 2,
      leaguePosition: 1,
      leaguePlayed: 14,
      leagueWon: 10,
      leagueDrawn: 2,
      leagueLost: 2,
      leagueGF: 30,
      leagueGA: 12,
      leaguePoints: 32,
      coachId: 'coach',
      promoted: true,
      relegated: false,
    }];
    expect(recommendObservationTheme(promotedWorld, elite)).toBe('promotion_survival');
  });

  it.each([
    'giant_defense',
    'dark_horse_challenge',
    'promotion_survival',
    'player_growth',
  ] satisfies ObservationThemeType[])('derives %s entirely from canonical world data', (type) => {
    const world = initializeGameWorld(20260718);
    const teamId = type === 'promotion_survival' ? teamAtLevel(world, 3) : teamByTier(world, 'mid');
    const before = structuredClone(world);
    const theme = buildObservationTheme(world, teamId, type);

    expect(theme).not.toBeNull();
    expect(theme?.type).toBe(type);
    expect(theme?.evidence.length).toBeGreaterThanOrEqual(3);
    expect(theme?.progress).toBe(0);
    expect(world).toEqual(before);
    if (type === 'player_growth') {
      expect(theme?.playerId).toBeTruthy();
      expect(theme?.evidence.join(' ')).toMatch(/评分 \d+\/\d+/);
    }
  });

  it('updates visible progress and player contribution after authoritative matches', () => {
    let world = initializeGameWorld(20260718);
    const teamId = teamByTier(world, 'mid');
    const before = buildObservationTheme(world, teamId, 'player_growth');
    const playerId = before?.playerId;
    expect(playerId).toBeTruthy();

    for (let index = 0; index < 3; index++) {
      world = executeCurrentWindow(world, { favoriteTeamIds: [teamId] }).world;
    }

    const after = buildObservationTheme(world, teamId, 'player_growth');
    expect(after?.played).toBeGreaterThan(before?.played ?? 0);
    expect(after?.progress).toBeGreaterThan(before?.progress ?? 0);
    expect(after?.evidence).not.toEqual(before?.evidence);
    expect(world.playerStats[playerId!].appearances).toBeGreaterThanOrEqual(0);
  });

  it('keeps simulation and RNG identical whether themes are read, switched, or disabled', () => {
    const baseline = initializeGameWorld(20260718);
    const observed = structuredClone(baseline);
    const teamId = teamByTier(observed, 'mid');

    buildObservationTheme(observed, teamId, 'auto');
    buildObservationTheme(observed, teamId, 'giant_defense');
    buildObservationTheme(observed, teamId, 'player_growth');
    buildObservationTheme(observed, teamId, 'disabled');

    const baselineResult = executeCurrentWindow(baseline, { favoriteTeamIds: [teamId] });
    const observedResult = executeCurrentWindow(observed, { favoriteTeamIds: [teamId] });
    expect(observedResult.results).toEqual(baselineResult.results);
    expect(observedResult.world).toEqual(baselineResult.world);
  });

  it('falls back to a world-level theme when no primary club exists', () => {
    const world = initializeGameWorld(20260718);
    const theme = buildObservationTheme(world, null, 'auto');

    expect(theme).toMatchObject({
      type: 'pure_observation',
      seasonPhase: '序章',
      played: 0,
    });
    expect(theme?.title).toContain('第一条线索');
    expect(buildObservationTheme(world, null, 'disabled')).toBeNull();
  });
});

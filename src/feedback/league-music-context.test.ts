import { describe, expect, it } from 'vitest';
import { initializeGameWorld, type GameWorld } from '../engine/season/season-manager';
import { pastSeasonOpening } from '../engine/season/test-world';
import {
  isLeagueBedRoute,
  leagueBedScene,
  shouldYieldToLeagueBed,
} from './league-music-context';

const SEED = 20260722;

function leagueWorld(): GameWorld {
  return pastSeasonOpening(initializeGameWorld(SEED));
}

/** Move the world onto a window of the given type without touching anything else. */
function onWindow(world: GameWorld, type: GameWorld['seasonState']['calendar'][number]['type']): GameWorld {
  const calendar = world.seasonState.calendar.map((window, index) => (
    index === world.seasonState.currentWindowIndex ? { ...window, type } : window
  ));
  return { ...world, seasonState: { ...world.seasonState, calendar } };
}

describe('isLeagueBedRoute', () => {
  it('keeps the bed on the season desk and off everything else', () => {
    expect(isLeagueBedRoute('/')).toBe(true);
    expect(isLeagueBedRoute('/calendar')).toBe(true);
    expect(isLeagueBedRoute('/league/1')).toBe(true);
    expect(isLeagueBedRoute('/league/3')).toBe(true);
    expect(isLeagueBedRoute('/market')).toBe(false);
    expect(isLeagueBedRoute('/cup/league_cup')).toBe(false);
    expect(isLeagueBedRoute('/league')).toBe(false);
  });
});

describe('leagueBedScene', () => {
  it('plays through a league window and the opening and closing of a season', () => {
    const world = leagueWorld();
    expect(leagueBedScene(world, '/')).toBe('league_season');
    expect(leagueBedScene(onWindow(world, 'pre_season'), '/calendar')).toBe('league_season');
    expect(leagueBedScene(onWindow(world, 'season_end'), '/league/1')).toBe('league_season');
  });

  it('goes quiet for every cup window, whatever the route says', () => {
    const world = leagueWorld();
    for (const type of [
      'league_cup',
      'super_cup',
      'super_cup_group',
      'continental_cup',
      'world_cup',
      'world_cup_group',
      'relegation_playoff',
    ] as const) {
      expect(leagueBedScene(onWindow(world, type), '/')).toBeNull();
    }
  });

  it('stays off routes that are not the season desk', () => {
    expect(leagueBedScene(leagueWorld(), '/market')).toBeNull();
    expect(leagueBedScene(leagueWorld(), '/player/abc')).toBeNull();
  });
});

describe('shouldYieldToLeagueBed', () => {
  it('takes over from a cup theme once the calendar is back in the league', () => {
    const world = leagueWorld();
    expect(shouldYieldToLeagueBed(world, '/', 'league_cup')).toBe(true);
    expect(shouldYieldToLeagueBed(onWindow(world, 'league_cup'), '/', 'league_cup')).toBe(false);
  });

  it('leaves the bed alone and stays out of the way off the desk', () => {
    const world = leagueWorld();
    expect(shouldYieldToLeagueBed(world, '/', 'league_season')).toBe(false);
    expect(shouldYieldToLeagueBed(world, '/', null)).toBe(false);
    expect(shouldYieldToLeagueBed(world, '/market', 'league_cup')).toBe(false);
  });
});

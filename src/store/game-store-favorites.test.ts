// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { __resetCompressedStorageForTests, compressedStorage } from './compressed-storage';
import { useGameStore } from './game-store';
import { SAVE_STORAGE_KEY } from './save-schema';

describe('observer focus ordering', () => {
  beforeEach(() => {
    __resetCompressedStorageForTests();
    localStorage.clear();
    compressedStorage.removeItem(SAVE_STORAGE_KEY);
    useGameStore.setState({
      world: null,
      initialized: false,
      favoriteTeamId: null,
      favoriteTeamIds: [],
      favoritePlayerIds: [],
      observationThemePreference: 'auto',
      narrativeMemory: [],
    });
  });

  it('does not replace the primary observer team when adding secondary teams', () => {
    useGameStore.getState().setFavoriteTeams(['alpha', 'beta']);
    useGameStore.getState().toggleFavoriteTeam('gamma');

    expect(useGameStore.getState().favoriteTeamId).toBe('alpha');
    expect(useGameStore.getState().favoriteTeamIds).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('promotes and removes primary teams with one authoritative ordering', () => {
    useGameStore.getState().setFavoriteTeams(['alpha', 'beta', 'gamma']);
    useGameStore.getState().setPrimaryFavoriteTeam('beta');
    expect(useGameStore.getState().favoriteTeamIds).toEqual(['beta', 'alpha', 'gamma']);
    expect(useGameStore.getState().favoriteTeamId).toBe('beta');

    useGameStore.getState().toggleFavoriteTeam('beta');
    expect(useGameStore.getState().favoriteTeamIds).toEqual(['alpha', 'gamma']);
    expect(useGameStore.getState().favoriteTeamId).toBe('alpha');
  });

  it('keeps the legacy setter as an explicit primary selection', () => {
    useGameStore.getState().setFavoriteTeams(['alpha', 'beta']);
    useGameStore.getState().setFavoriteTeam('beta');

    expect(useGameStore.getState().favoriteTeamIds).toEqual(['beta', 'alpha']);
    expect(useGameStore.getState().favoriteTeamId).toBe('beta');
  });

  it('keeps the observation lens display-only and independently selectable', () => {
    useGameStore.getState().setFavoriteTeams(['alpha']);
    useGameStore.getState().setObservationThemePreference('player_growth');

    expect(useGameStore.getState().favoriteTeamIds).toEqual(['alpha']);
    expect(useGameStore.getState().observationThemePreference).toBe('player_growth');
    useGameStore.getState().setObservationThemePreference('disabled');
    expect(useGameStore.getState().observationThemePreference).toBe('disabled');
  });

  it('follows at most eight stable player UUIDs without replacing earlier choices', () => {
    for (let index = 0; index < 9; index++) {
      useGameStore.getState().toggleFavoritePlayer(`player-${index}`);
    }
    expect(useGameStore.getState().favoritePlayerIds).toEqual(
      Array.from({ length: 8 }, (_, index) => `player-${index}`),
    );

    useGameStore.getState().toggleFavoritePlayer('player-3');
    expect(useGameStore.getState().favoritePlayerIds).not.toContain('player-3');
    useGameStore.getState().toggleFavoritePlayer('player-8');
    expect(useGameStore.getState().favoritePlayerIds.at(-1)).toBe('player-8');
  });

  it('initializes the observer focus and lens atomically with a new universe', async () => {
    await useGameStore.getState().newGame(20260709, {
      favoriteTeamIds: ['gz_hengda', 'missing-team', 'shimazu'],
      observationThemePreference: 'dark_horse_challenge',
    });

    expect(useGameStore.getState().favoriteTeamIds).toEqual(['gz_hengda', 'shimazu']);
    expect(useGameStore.getState().favoriteTeamId).toBe('gz_hengda');
    expect(useGameStore.getState().observationThemePreference).toBe('dark_horse_challenge');
  });

  it('keeps exactly one spoiler-free watch target per advance', () => {
    useGameStore.setState({ starredFixtureIds: [] });
    useGameStore.getState().toggleStarFixture('fixture-a');
    expect(useGameStore.getState().starredFixtureIds).toEqual(['fixture-a']);

    useGameStore.getState().toggleStarFixture('fixture-b');
    expect(useGameStore.getState().starredFixtureIds).toEqual(['fixture-b']);

    useGameStore.getState().toggleStarFixture('fixture-b');
    expect(useGameStore.getState().starredFixtureIds).toEqual([]);
  });

  it('continues the selected observation lens into the next season', async () => {
    await useGameStore.getState().newGame(20260718);
    useGameStore.getState().setObservationThemePreference('player_growth');

    expect(await useGameStore.getState().advanceUntil('season_end')).toBe(true);
    expect(await useGameStore.getState().advanceWindow()).toBe(true);
    expect(useGameStore.getState().world?.seasonState.seasonNumber).toBe(2);
    expect(useGameStore.getState().observationThemePreference).toBe('player_growth');
  });
});

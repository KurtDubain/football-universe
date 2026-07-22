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
});

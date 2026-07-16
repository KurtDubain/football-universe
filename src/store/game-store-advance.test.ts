// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCompressedStorageForTests, compressedStorage } from './compressed-storage';
import { useGameStore } from './game-store';
import { SAVE_STORAGE_KEY } from './save-schema';

describe('game store advance scheduling', () => {
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    __resetCompressedStorageForTests();
    localStorage.clear();
    useGameStore.setState({
      world: null,
      initialized: false,
      lastResults: [],
      lastNews: [],
      isAdvancing: false,
      advanceTick: 0,
      favoriteTeamId: null,
      favoriteTeamIds: [],
      starredFixtureIds: [],
      newAchievements: [],
    });
    compressedStorage.removeItem(SAVE_STORAGE_KEY);
    useGameStore.getState().newGame(20260716);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetCompressedStorageForTests();
  });

  it('publishes busy feedback before engine work and rejects duplicate taps', async () => {
    const before = useGameStore.getState().world!.seasonState.currentWindowIndex;
    const first = useGameStore.getState().advanceWindow();
    const second = useGameStore.getState().advanceWindow();

    expect(useGameStore.getState().isAdvancing).toBe(true);
    expect(useGameStore.getState().world!.seasonState.currentWindowIndex).toBe(before);
    await second;

    expect(frames).toHaveLength(1);
    frames.shift()!(performance.now());
    expect(frames).toHaveLength(1);
    expect(useGameStore.getState().world!.seasonState.currentWindowIndex).toBe(before);
    frames.shift()!(performance.now());
    await first;

    expect(useGameStore.getState().isAdvancing).toBe(false);
    expect(useGameStore.getState().advanceTick).toBe(1);
    expect(useGameStore.getState().world!.seasonState.currentWindowIndex).toBe(before + 1);
  });
});

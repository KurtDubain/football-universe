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
      lastObservationSettlements: [],
      lastWorldResponse: null,
      isAdvancing: false,
      advanceError: null,
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
    expect(useGameStore.getState().lastWorldResponse).toMatchObject({
      mode: 'single',
      advancedWindows: 1,
    });
    expect(useGameStore.getState().advanceError).toBeNull();
  });

  it('restores interaction and publishes a readable error when engine work fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const validWorld = useGameStore.getState().world!;
    const brokenWorld = { ...validWorld, seasonState: undefined } as unknown as typeof validWorld;
    useGameStore.setState({ world: brokenWorld });

    const advance = useGameStore.getState().advanceWindow();
    frames.shift()!(performance.now());
    frames.shift()!(performance.now());
    const completed = await advance;

    expect(completed).toBe(false);
    expect(useGameStore.getState().isAdvancing).toBe(false);
    expect(useGameStore.getState().advanceError).toContain('本次推进没有完成');
    useGameStore.getState().dismissAdvanceError();
    expect(useGameStore.getState().advanceError).toBeNull();
    consoleError.mockRestore();
  });
});

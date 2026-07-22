// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveBetOutcome } from '../engine/observation/bet-settlement';
import type { MatchResult } from '../types/match';
import { __resetCompressedStorageForTests, compressedStorage } from './compressed-storage';
import { useGameStore } from './game-store';
import { SAVE_STORAGE_KEY } from './save-schema';

describe('game store bet settlement paths', () => {
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
    useGameStore.getState().newGame(20260722);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetCompressedStorageForTests();
  });

  async function completeAdvance(promise: Promise<void>) {
    expect(frames).toHaveLength(1);
    frames.shift()!(performance.now());
    expect(frames).toHaveLength(1);
    frames.shift()!(performance.now());
    await promise;
  }

  function placeHomeBet() {
    const world = useGameStore.getState().world!;
    const fixtureId = world.seasonState.calendar[world.seasonState.currentWindowIndex].fixtures[0].id;
    useGameStore.getState().placeBet(fixtureId, 'home', 50, 2);
    expect(useGameStore.getState().world?.coins).toBe(950);
    return fixtureId;
  }

  function expectedCoins(result: MatchResult) {
    return resolveBetOutcome(result) === 'home' ? 1050 : 950;
  }

  it('settles through a single-window advance without mutating the old world', async () => {
    const originalWorld = useGameStore.getState().world!;
    const fixtureId = placeHomeBet();
    expect(originalWorld.coins).toBe(1000);

    await completeAdvance(useGameStore.getState().advanceWindow());

    const result = useGameStore.getState().lastResults.find(entry => entry.fixtureId === fixtureId)!;
    expect(result).toBeDefined();
    expect(useGameStore.getState().world?.coins).toBe(expectedCoins(result));
    expect(useGameStore.getState().world?.bets).toEqual([]);
  });

  it('settles the first skipped window during batch advance', async () => {
    const fixtureId = placeHomeBet();
    await completeAdvance(useGameStore.getState().batchAdvance(2));

    const world = useGameStore.getState().world!;
    const result = world.seasonState.calendar[0].results.find(entry => entry.fixtureId === fixtureId)!;
    expect(result).toBeDefined();
    expect(world.coins).toBe(expectedCoins(result));
    expect(world.bets).toEqual([]);
  });

  it.each([
    ['next cup', 'cup'],
    ['season end', 'season_end'],
  ] as const)('settles skipped windows while advancing to %s', async (_label, target) => {
    const fixtureId = placeHomeBet();
    await completeAdvance(useGameStore.getState().advanceUntil(target));

    const world = useGameStore.getState().world!;
    const result = world.seasonState.calendar[0].results.find(entry => entry.fixtureId === fixtureId)!;
    expect(result).toBeDefined();
    expect(world.coins).toBe(expectedCoins(result));
    expect(world.bets).toEqual([]);
  });

  it('keeps unmatched bets pending instead of silently clearing them', async () => {
    useGameStore.getState().placeBet('future-fixture', 'away', 50, 2);
    await completeAdvance(useGameStore.getState().advanceWindow());

    expect(useGameStore.getState().world?.coins).toBe(950);
    expect(useGameStore.getState().world?.bets).toEqual([
      { fixtureId: 'future-fixture', outcome: 'away', amount: 50, odds: 2 },
    ]);
  });
});

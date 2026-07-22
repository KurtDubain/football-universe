// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { initializeGameWorld } from '../engine/season/season-manager';
import { __flushCompressedStorageForTests, compressedStorage, replaceCompressedStorageItem } from './compressed-storage';
import { useGameStore } from './game-store';
import { exportCurrentSave, importCurrentSave } from './save-backup';
import { SAVE_SCHEMA_VERSION, SAVE_STORAGE_KEY } from './save-schema';

function makeCurrentSave(seed: number) {
  return {
    version: SAVE_SCHEMA_VERSION,
    state: {
      world: initializeGameWorld(seed),
      initialized: true,
      lastResults: [],
      lastNews: [],
      favoriteTeamId: null,
      favoriteTeamIds: [],
    },
  };
}

beforeEach(() => {
  __flushCompressedStorageForTests();
  compressedStorage.removeItem(SAVE_STORAGE_KEY);
  localStorage.clear();
  useGameStore.setState({
    world: null,
    initialized: false,
    lastResults: [],
    lastNews: [],
    favoriteTeamId: null,
    favoriteTeamIds: [],
  });
  compressedStorage.removeItem(SAVE_STORAGE_KEY);
});

describe('game store current-save persistence', () => {
  it('hydrates a real current world and survives export/import/reload', async () => {
    const save = makeCurrentSave(24680);
    replaceCompressedStorageItem(SAVE_STORAGE_KEY, JSON.stringify(save));

    await useGameStore.persist.rehydrate();

    expect(useGameStore.getState().initialized).toBe(true);
    expect(useGameStore.getState().world?.seed).toBe(24680);

    const favorite = Object.keys(save.state.world.teamBases)[0];
    useGameStore.getState().setFavoriteTeams([favorite]);
    __flushCompressedStorageForTests();
    const exported = exportCurrentSave(SAVE_STORAGE_KEY);

    useGameStore.setState({ world: null, initialized: false, favoriteTeamIds: [] });
    compressedStorage.removeItem(SAVE_STORAGE_KEY);
    importCurrentSave(SAVE_STORAGE_KEY, exported);
    await useGameStore.persist.rehydrate();

    expect(useGameStore.getState().world?.seed).toBe(24680);
    expect(useGameStore.getState().favoriteTeamIds).toEqual([favorite]);
  });

  it('does not duplicate result/news batches and reconstructs them on hydration', async () => {
    useGameStore.getState().newGame(13579);
    await useGameStore.getState().advanceWindow();
    const resultCount = useGameStore.getState().lastResults.length;
    expect(resultCount).toBeGreaterThan(0);

    __flushCompressedStorageForTests();
    const exported = JSON.parse(exportCurrentSave(SAVE_STORAGE_KEY));
    expect(exported.state.lastResults).toEqual([]);
    expect(exported.state.lastNews).toEqual([]);

    useGameStore.setState({ world: null, initialized: false, lastResults: [], lastNews: [] });
    replaceCompressedStorageItem(SAVE_STORAGE_KEY, JSON.stringify(exported));
    await useGameStore.persist.rehydrate();

    expect(useGameStore.getState().lastResults).toHaveLength(resultCount);
    expect(useGameStore.getState().lastNews).toEqual(useGameStore.getState().world?.newsLog.slice(-30));
  });

  it('preserves the bounded universe intervention record across export and reload', async () => {
    useGameStore.getState().newGame(20260722);
    const teamId = Object.keys(useGameStore.getState().world!.teamBases)[0];
    useGameStore.getState().useGodHand(teamId, 'boost');
    __flushCompressedStorageForTests();
    const exported = exportCurrentSave(SAVE_STORAGE_KEY);

    useGameStore.setState({ world: null, initialized: false });
    compressedStorage.removeItem(SAVE_STORAGE_KEY);
    importCurrentSave(SAVE_STORAGE_KEY, exported);
    await useGameStore.persist.rehydrate();

    expect(useGameStore.getState().world?.godHandUsed).toBe(true);
    expect(useGameStore.getState().world?.godHandHistory).toEqual([
      expect.objectContaining({ teamId, type: 'boost', season: 1 }),
    ]);
  });

  it('preserves a pending observation and its bounded lifetime record', async () => {
    useGameStore.getState().newGame(20260722);
    const world = useGameStore.getState().world!;
    const fixtureId = world.seasonState.calendar[world.seasonState.currentWindowIndex].fixtures[0].id;
    useGameStore.getState().setObservationJudgment(fixtureId, 'goals', 'over-2');
    useGameStore.setState({
      world: {
        ...useGameStore.getState().world!,
        observationRecord: {
          total: 7,
          correct: 4,
          currentStreak: 2,
          bestStreak: 3,
          recent: [],
        },
      },
    });
    __flushCompressedStorageForTests();
    const exported = exportCurrentSave(SAVE_STORAGE_KEY);

    useGameStore.setState({ world: null, initialized: false });
    compressedStorage.removeItem(SAVE_STORAGE_KEY);
    importCurrentSave(SAVE_STORAGE_KEY, exported);
    await useGameStore.persist.rehydrate();

    expect(useGameStore.getState().world?.pendingObservationJudgment).toMatchObject({
      fixtureId,
      kind: 'goals',
      selection: 'over-2',
    });
    expect(useGameStore.getState().world?.observationRecord).toMatchObject({
      total: 7,
      correct: 4,
      currentStreak: 2,
      bestStreak: 3,
    });
  });
});

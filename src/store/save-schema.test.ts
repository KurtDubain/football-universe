// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { __flushCompressedStorageForTests, compressedStorage } from './compressed-storage';
import {
  __resetSaveRecoveryForTests,
  consumeSaveRecoveryMessage,
  currentSaveStorage,
  getLatestSaveRecoveryDiagnostic,
  getSaveRecoveryMessage,
  SAVE_DIAGNOSTIC_KEY,
  SAVE_SCHEMA_VERSION,
  SAVE_STORAGE_KEY,
} from './save-schema';

function makeSave(seasonNumber = 3) {
  return {
    version: SAVE_SCHEMA_VERSION,
    state: {
      initialized: true,
      lastResults: [],
      lastNews: [],
      favoriteTeamId: null,
      favoriteTeamIds: ['a'],
      world: {
        seasonState: { seasonNumber, calendar: [] },
        teamBases: { a: { id: 'a' } },
        teamStates: { a: { id: 'a' } },
        squads: { a: [] },
        playerStats: {},
      },
    },
  };
}

beforeEach(() => {
  __flushCompressedStorageForTests();
  localStorage.clear();
  __resetSaveRecoveryForTests();
});

describe('current schema hydration boundary', () => {
  it('hydrates a valid current save through Zustand JSON storage', () => {
    compressedStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(makeSave(7)));
    __flushCompressedStorageForTests();

    type TestState = { initialized: boolean; world: unknown };
    const useTestStore = create<TestState>()(
      persist<TestState>(
        () => ({ initialized: false, world: null }),
        {
          name: SAVE_STORAGE_KEY,
          version: SAVE_SCHEMA_VERSION,
          storage: createJSONStorage(() => currentSaveStorage),
        },
      ),
    );

    expect(useTestStore.getState().initialized).toBe(true);
    expect(useTestStore.getState().world).toMatchObject({
      seasonState: { seasonNumber: 7 },
    });
    expect(getSaveRecoveryMessage()).toBeNull();
  });

  it.each([
    ['malformed JSON', '{not-json'],
    ['wrong version', JSON.stringify({ ...makeSave(), version: SAVE_SCHEMA_VERSION - 1 })],
    ['missing world fields', JSON.stringify({
      ...makeSave(),
      state: { ...makeSave().state, world: { seasonState: { seasonNumber: 1, calendar: [] } } },
    })],
  ])('quarantines %s, clears the active key, and exposes a recovery notice', (_label, payload) => {
    localStorage.setItem(SAVE_STORAGE_KEY, payload);

    expect(currentSaveStorage.getItem(SAVE_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(SAVE_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(SAVE_DIAGNOSTIC_KEY)).not.toBeNull();
    expect(getLatestSaveRecoveryDiagnostic()?.payload).toBe(payload);
    expect(getSaveRecoveryMessage()).toContain('已隔离并返回新游戏');
    expect(consumeSaveRecoveryMessage()).toContain('已隔离并返回新游戏');
    expect(consumeSaveRecoveryMessage()).toBeNull();
  });
});

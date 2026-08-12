// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { initializeGameWorld } from '../engine/season/season-manager';
import { __flushCompressedStorageForTests, compressedStorage } from './compressed-storage';
import { exportCurrentSave, importCurrentSave } from './save-backup';
import { SAVE_SCHEMA_VERSION } from './save-schema';

const KEY = 'football-save-test';
const currentSave = {
  version: SAVE_SCHEMA_VERSION,
  state: {
    initialized: true,
    lastResults: [],
    lastNews: [],
    favoriteTeamId: null,
    favoriteTeamIds: [],
    favoritePlayerIds: [],
    narrativeMemory: [],
    world: initializeGameWorld(20260730),
  },
};
const serializedCurrentSave = JSON.stringify(currentSave);
const normalizedCurrentSave = JSON.parse(serializedCurrentSave) as typeof currentSave;

beforeEach(() => {
  __flushCompressedStorageForTests();
  localStorage.clear();
});

describe('current save backup', () => {
  it('exports compressed runtime storage as readable JSON', () => {
    compressedStorage.setItem(KEY, serializedCurrentSave);
    const exported = exportCurrentSave(KEY);
    expect(JSON.parse(exported)).toEqual(normalizedCurrentSave);
    expect(exported).toContain('\n  "version"');
  });

  it('imports valid current JSON and stores it compressed', () => {
    importCurrentSave(KEY, serializedCurrentSave);
    expect(JSON.parse(compressedStorage.getItem(KEY) as string)).toEqual(normalizedCurrentSave);
    expect(localStorage.getItem(KEY)?.startsWith('{')).toBe(false);
  });

  it('rejects older schemas and malformed current saves', () => {
    expect(() => importCurrentSave(KEY, JSON.stringify({ ...currentSave, version: 23 })))
      .toThrow('仅支持当前版本存档');
    expect(() => importCurrentSave(KEY, JSON.stringify({ version: SAVE_SCHEMA_VERSION, state: {} })))
      .toThrow('存档未包含已初始化的游戏状态');
  });

  it('replaces an older pending write and survives a JSON export/import round-trip', () => {
    compressedStorage.setItem(KEY, JSON.stringify({ stale: true }));
    importCurrentSave(KEY, serializedCurrentSave);
    __flushCompressedStorageForTests();

    const exported = exportCurrentSave(KEY);
    localStorage.clear();
    importCurrentSave(KEY, exported);
    __flushCompressedStorageForTests();

    expect(JSON.parse(exportCurrentSave(KEY))).toEqual(normalizedCurrentSave);
  });
});

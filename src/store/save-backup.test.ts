// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { __flushCompressedStorageForTests, compressedStorage } from './compressed-storage';
import { exportCurrentSave, importCurrentSave } from './save-backup';

const KEY = 'football-save-test';
const VERSION = 24;
const currentSave = {
  version: VERSION,
  state: {
    world: {
      seasonState: { seasonNumber: 3 },
      teamBases: { a: { id: 'a' } },
      squads: { a: [] },
    },
  },
};

beforeEach(() => {
  __flushCompressedStorageForTests();
  localStorage.clear();
});

describe('current save backup', () => {
  it('exports compressed runtime storage as readable JSON', () => {
    compressedStorage.setItem(KEY, JSON.stringify(currentSave));
    const exported = exportCurrentSave(KEY, VERSION);
    expect(JSON.parse(exported)).toEqual(currentSave);
    expect(exported).toContain('\n  "version"');
  });

  it('imports valid current JSON and stores it compressed', () => {
    importCurrentSave(KEY, JSON.stringify(currentSave), VERSION);
    expect(JSON.parse(compressedStorage.getItem(KEY) as string)).toEqual(currentSave);
    expect(localStorage.getItem(KEY)?.startsWith('{')).toBe(false);
  });

  it('rejects older schemas and malformed current saves', () => {
    expect(() => importCurrentSave(KEY, JSON.stringify({ ...currentSave, version: 23 }), VERSION))
      .toThrow('仅支持当前版本存档');
    expect(() => importCurrentSave(KEY, JSON.stringify({ version: VERSION, state: {} }), VERSION))
      .toThrow('缺少当前版本所需的核心数据');
  });
});

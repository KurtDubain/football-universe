import { describe, it, expect, vi, afterEach } from 'vitest';
import * as personal from './personal';
import * as contest from './contest';
import personalCoaches from './personal/coaches.json';
import contestCoaches from './contest/coaches.json';
import { resolveBuildTarget } from '../../scripts/build-target';

afterEach(() => { vi.doUnmock('./preset'); vi.doUnmock('./coach-names'); vi.resetModules(); });

describe('edition boundary', () => {
  it('uses edition-specific sandbox instructions without changing mode mechanics', async () => {
    const personalModes = await import('../types/game-mode');
    expect(personalModes.getGameModeConfig('sandbox').description).toContain('球队编辑器');
    vi.resetModules(); vi.doMock('./preset', () => contest);
    const contestModes = await import('../types/game-mode');
    expect(contestModes.getGameModeConfig('sandbox').description).toBe('使用内置参赛球队，不提供球队编辑或导入');
    expect(contestModes.getGameModeConfig('sandbox').applyTeamOverrides).toBeUndefined();
  });

  it('locks output, identity, required URL and production audit policy', () => {
    expect(resolveBuildTarget('personal', {}).outDir).toBe('dist/personal');
    expect(resolveBuildTarget('audit', {}).audit).toBe(true);
    expect(resolveBuildTarget('contest', { CONTEST_SITE_URL: 'https://contest.invalid' }).presetId).toBe('three-shores-v1');
    for (const mode of ['personal', 'contest']) expect(() => resolveBuildTarget(mode, { VITE_ENABLE_AUDIT: 'true' })).toThrow();
    expect(() => resolveBuildTarget('other', {})).toThrow();
    expect(() => resolveBuildTarget('contest', {})).toThrow();
    expect(() => resolveBuildTarget('contest', { APP_EDITION: 'personal' })).toThrow();
    expect(() => resolveBuildTarget('personal', { APP_PRESET_ID: 'three-shores-v1' })).toThrow();
    expect(() => resolveBuildTarget('contest', { CONTEST_SITE_URL: 'https://football-universe-ebon.vercel.app' })).toThrow();
  });

  it('keeps IDs, continent membership and every regional derby partition', () => {
    const ids = Object.keys(personal.preset.teams);
    expect(Object.keys(contest.preset.teams)).toEqual(ids);
    expect(Object.keys(contestCoaches)).toEqual(Object.keys(personalCoaches));
    for (const id of ids) {
      const a = personal.preset.teams[id], b = contest.preset.teams[id];
      expect(b.region.split('+')[0]).toBe(a.region.split('+')[0]);
      expect(b.name).not.toBe(a.name);
      for (const other of ids) expect(b.region === contest.preset.teams[other].region).toBe(a.region === personal.preset.teams[other].region);
    }
  });

  it('preserves all possible player-name collision relationships and pool cardinalities', () => {
    const a = personal.namePools, b = contest.namePools;
    const groups = [
      ['MAINLAND_SURNAMES', 'MAINLAND_GIVEN', ''],
      ['MAINLAND_SURNAMES', 'NORTH_GIVEN', ''],
      ['WESTERN_SURNAMES', 'WESTERN_GIVEN', '·'],
      ['KOREAN_SURNAMES', 'KOREAN_GIVEN', ''],
      ['JAPANESE_SURNAMES', 'JAPANESE_GIVEN', ''],
    ] as const;
    const forward = new Map<string, string>(), reverse = new Map<string, string>();
    for (const [surname, given, separator] of groups) {
      expect(b[surname].length).toBe(a[surname].length);
      expect(b[given].length).toBe(a[given].length);
      for (let i = 0; i < a[surname].length; i++) for (let j = 0; j < a[given].length; j++) {
        const oldName = a[surname][i] + separator + a[given][j];
        const newName = b[surname][i] + separator + b[given][j];
        expect(forward.get(oldName) ?? newName).toBe(newName);
        expect(reverse.get(newName) ?? oldName).toBe(oldName);
        forward.set(oldName, newName); reverse.set(newName, oldName);
      }
    }
    expect(b.COACH_FIRST_NAMES.length).toBe(a.COACH_FIRST_NAMES.length);
    expect(b.COACH_SURNAMES.length).toBe(a.COACH_SURNAMES.length);
  });

  it('preserves personal storage and blocks contest content ingress below UI', async () => {
    const original = await import('./policy');
    expect(original.editionStorageKey('football-universe-save')).toBe('football-universe-save');
    expect(() => original.requireCustomContent()).not.toThrow();
    vi.resetModules(); vi.doMock('./preset', () => contest);
    vi.doMock('./coach-names', () => ({ default: contestCoaches }));
    const policy = await import('./policy');
    expect(policy.editionStorageKey('football-universe-save')).not.toBe('football-universe-save');
    expect(() => policy.requireCustomContent()).toThrow('参赛版');
    const backup = await import('../store/save-backup');
    expect(() => backup.importCurrentSave('any-key', '{}')).toThrow('参赛版');
    const engine = await import('../engine/season/season-manager');
    expect(() => engine.initializeGameWorld(1, { customTeams: [] })).toThrow('参赛版');
    const world = engine.initializeGameWorld(20260709);
    const schema = await import('../store/save-schema');
    const envelope = {
      version: 25, edition: 'contest', presetId: 'three-shores-v1',
      state: { initialized: true, world, favoriteTeamId: null, favoriteTeamIds: [], lastResults: [], lastNews: [] },
    };
    expect(schema.parseCurrentSave(JSON.stringify(envelope)).state.world.teamBases.tsmc_fc.shortName).toBe('微光');
    expect(() => schema.parseCurrentSave(JSON.stringify({ ...envelope, edition: undefined }))).toThrow('版别');
    expect(() => schema.parseCurrentSave(JSON.stringify({ ...envelope, presetId: 'personal-v1' }))).toThrow('版别');
    const update = await import('../pwa/update-coordinator');
    expect(update.parseRemoteAppVersion({ version: '4.61.5', edition: 'personal', presetId: 'personal-v1' })).toBeNull();
    expect(update.parseRemoteAppVersion({ version: '4.61.5' })).toBeNull();
    expect(update.parseRemoteAppVersion({ version: '4.61.5', edition: 'contest', presetId: 'three-shores-v1' })).not.toBeNull();
  });
});

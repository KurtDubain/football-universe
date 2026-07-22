import { describe, expect, it } from 'vitest';
import { defaultTeams } from './teams';
import { getObserverLensOptions, OBSERVER_SEED_CANDIDATES } from './observer-experience';

describe('observer experience configuration', () => {
  it('keeps the seed audit bounded to twenty reproducible candidates', () => {
    expect(OBSERVER_SEED_CANDIDATES).toHaveLength(20);
    expect(new Set(OBSERVER_SEED_CANDIDATES).size).toBe(20);
  });

  it('derives distinct narrative lenses without changing team data', () => {
    const snapshot = structuredClone(defaultTeams);
    const options = getObserverLensOptions(defaultTeams);

    expect(options.map(option => option.id)).toEqual(['giant', 'challenger', 'underdog', 'neutral']);
    expect(options.slice(0, 3).every(option => option.teamId)).toBe(true);
    expect(new Set(options.slice(0, 3).map(option => option.teamId)).size).toBe(3);
    expect(options.at(-1)?.teamId).toBeNull();
    expect(defaultTeams).toEqual(snapshot);
  });
});

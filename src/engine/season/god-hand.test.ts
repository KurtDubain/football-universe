import { describe, expect, it } from 'vitest';
import { initializeGameWorld, initializeNewSeason } from './season-manager';
import { applyGodHandIntervention, GOD_HAND_HISTORY_LIMIT } from './god-hand';

describe('god hand intervention', () => {
  it('applies immutable permanent effects without consuming the simulation RNG', () => {
    const world = initializeGameWorld(20260722);
    const teamId = Object.keys(world.teamBases)[0];
    const originalTeam = world.teamBases[teamId];
    const rngState = world.rngState;
    const updated = applyGodHandIntervention(world, teamId, 'boost');

    expect(updated).not.toBe(world);
    expect(updated.teamBases).not.toBe(world.teamBases);
    expect(world.teamBases[teamId]).toBe(originalTeam);
    expect(updated.teamBases[teamId].attack).toBe(Math.min(99, originalTeam.attack + 5));
    expect(updated.teamBases[teamId].midfield).toBe(Math.min(99, originalTeam.midfield + 3));
    expect(updated.godHandUsed).toBe(true);
    expect(updated.rngState).toBe(rngState);
    expect(updated.godHandHistory).toEqual([expect.objectContaining({
      season: 1,
      teamId,
      type: 'boost',
    })]);
    expect(updated.newsLog.at(-1)).toMatchObject({ type: 'intervention', importance: 'major' });
  });

  it('rejects a second intervention in the same season', () => {
    const world = initializeGameWorld(7);
    const [firstTeam, secondTeam] = Object.keys(world.teamBases);
    const first = applyGodHandIntervention(world, firstTeam, 'nerf');
    const second = applyGodHandIntervention(first, secondTeam, 'boost');
    expect(second).toBe(first);
    expect(second.godHandHistory).toHaveLength(1);
  });

  it('resets the seasonal allowance while preserving the universe record', () => {
    const world = initializeGameWorld(17);
    const teamId = Object.keys(world.teamBases)[0];
    const intervened = applyGodHandIntervention(world, teamId, 'boost');
    const nextSeason = initializeNewSeason(intervened);

    expect(nextSeason.godHandUsed).toBe(false);
    expect(nextSeason.godHandHistory).toEqual(intervened.godHandHistory);
  });

  it('keeps intervention history bounded', () => {
    const world = initializeGameWorld(8);
    const teamId = Object.keys(world.teamBases)[0];
    const history = Array.from({ length: GOD_HAND_HISTORY_LIMIT }, (_, index) => ({
      id: `old-${index}`,
      season: index + 1,
      windowIndex: 0,
      teamId,
      type: 'boost' as const,
      effects: [],
    }));
    const updated = applyGodHandIntervention({ ...world, godHandHistory: history }, teamId, 'nerf');
    expect(updated.godHandHistory).toHaveLength(GOD_HAND_HISTORY_LIMIT);
    expect(updated.godHandHistory?.[0].id).toBe('old-1');
    expect(updated.godHandHistory?.at(-1)?.type).toBe('nerf');
  });
});

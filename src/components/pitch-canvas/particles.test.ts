import { describe, expect, it } from 'vitest';
import { spawnGoalBurst, spawnGrassKick, spawnTackleSparks } from './particles';

describe('pitch particles', () => {
  it('replays event effects deterministically when a seed is supplied', () => {
    expect(spawnGoalBurst(500, 170, '#22c55e', 334, 88))
      .toEqual(spawnGoalBurst(500, 170, '#22c55e', 334, 88));
    expect(spawnTackleSparks(400, 120, 91))
      .toEqual(spawnTackleSparks(400, 120, 91));
    expect(spawnGrassKick(240, 180, 1, 0, 93))
      .toEqual(spawnGrassKick(240, 180, 1, 0, 93));
  });

  it('still varies effects between different event seeds', () => {
    expect(spawnGoalBurst(500, 170, '#22c55e', 334, 88))
      .not.toEqual(spawnGoalBurst(500, 170, '#22c55e', 334, 89));
  });
});

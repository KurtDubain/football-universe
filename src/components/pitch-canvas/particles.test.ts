import { describe, expect, it } from 'vitest';
import { newParticle, spawnGoalBurst, spawnGrassKick, spawnTackleSparks, updateAndCullParticles } from './particles';

describe('pitch particles', () => {
  it('advances the same distance per second at either render cadence', () => {
    // Every constant in the integrator used to be per rendered frame, so a
    // machine that degraded to 30 fps ran the whole system at half speed: turf
    // spray hung in the air twice as long and drifted half as far, right next
    // to player positions that were already being scaled correctly.
    const seed = () => [newParticle({
      x: 100, y: 40, vx: 1.4, vy: -2.2, color: '#fff',
      gravity: 0.05, drag: 0.015, life: 600, bounces: 0,
    })];

    let fast = seed();
    for (let frame = 0; frame < 120; frame++) {
      fast = updateAndCullParticles(fast, 344, 350, false, 1);
    }
    let slow = seed();
    for (let frame = 0; frame < 60; frame++) {
      slow = updateAndCullParticles(slow, 344, 350, false, 2);
    }

    expect(slow).toHaveLength(1);
    expect(fast).toHaveLength(1);
    // Explicit Euler is step-size sensitive at the couple-of-percent level,
    // which is invisible on turf spray. What this rules out is the old
    // behaviour, where the 30 fps run covered half the ground.
    const travel = (p: { x: number; y: number }) => Math.hypot(p.x - 100, p.y - 40);
    expect(travel(slow[0])).toBeGreaterThan(travel(fast[0]) * 0.96);
    expect(travel(slow[0])).toBeLessThan(travel(fast[0]) * 1.04);
    expect(slow[0].life).toBeCloseTo(fast[0].life, 6);
  });

  it('culls a particle once its life has run out at either cadence', () => {
    const dying = () => [newParticle({ x: 10, y: 10, vx: 0, vy: 0, color: '#fff', life: 4 })];

    let stepped = dying();
    for (let step = 0; step < 4; step += 1) {
      stepped = updateAndCullParticles(stepped, 344, 350, false, 1);
    }
    expect(stepped).toHaveLength(0);
    expect(updateAndCullParticles(dying(), 344, 350, false, 4)).toHaveLength(0);
    expect(updateAndCullParticles(dying(), 344, 350, false, 0.5)).toHaveLength(1);
  });
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

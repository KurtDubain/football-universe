import { describe, expect, it } from 'vitest';
import { updatePlayerPositions } from './physics';
import { BASE_FORMATION, type PassPhase, type PlayerState } from './types';

function initialPlayers(): PlayerState[] {
  return Array.from({ length: 22 }, (_, index) => {
    const base = BASE_FORMATION[index % 11];
    const isHome = index < 11;
    return {
      x: isHome ? base.x : 1 - base.x,
      y: base.y,
      vx: 0,
      vy: 0,
      sprintT: 0,
    };
  });
}

describe('pitch player movement', () => {
  it('keeps supporting forwards in the box instead of stacking on the goal line', () => {
    const players = initialPlayers();
    const shot: PassPhase = {
      passerIdx: 9,
      receiverIdx: 9,
      attackingHome: true,
      kind: 'shot',
      duration: 12,
      hold: 12,
      arc: 0.1,
      intercepted: false,
    };

    for (let frame = 0; frame < 25; frame++) {
      updatePlayerPositions(players, 0.985, 0.5, 'home', 9, shot, 'shooting', { x: 0.985, y: 0.5 }, 0.07);
    }

    expect(players[9].x).toBeGreaterThan(0.95);
    expect(players[8].x).toBeLessThan(0.94);
    expect(players[10].x).toBeLessThan(0.94);
    expect(Math.abs(players[8].y - players[10].y)).toBeGreaterThan(0.04);
  });
});

import { describe, expect, it } from 'vitest';
import { computeBallPosition, selectDefensiveRoles, updatePlayerPositions } from './physics';
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
  it('keeps an aerial pass on its ground path while reporting visual elevation separately', () => {
    const ball = computeBallPosition({
      passing: true,
      phaseFrame: 30,
      duration: 60,
      arc: 1,
      source: { x: 10, y: 40 },
      target: { x: 110, y: 80 },
      frame: 30,
    });

    expect(ball.bx).toBe(60);
    expect(ball.by).toBe(60);
    expect(ball.arcLift).toBeCloseTo(22);
  });

  it('keeps the shooter near the release point and supporting forwards in separate lanes', () => {
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
      sourceOverride: { x: 0.84, y: 0.5 },
    };

    for (let frame = 0; frame < 25; frame++) {
      updatePlayerPositions(players, 0.985, 0.5, 'home', 9, shot, 'shooting', { x: 0.985, y: 0.5 }, 0.07);
    }

    expect(players[9].x).toBeGreaterThan(0.8);
    expect(players[9].x).toBeLessThan(0.9);
    expect(players[8].x).toBeLessThan(0.94);
    expect(players[10].x).toBeLessThan(0.94);
    expect(Math.abs(players[8].y - players[10].y)).toBeGreaterThan(0.04);
  });

  it('assigns one ball presser and a distinct goal-side cover defender', () => {
    const players = initialPlayers();
    const roles = selectDefensiveRoles(players, false, 0.72, 0.3);

    expect(roles.presserIndex).toBeGreaterThanOrEqual(11);
    expect(roles.coverIndex).toBeGreaterThanOrEqual(11);
    expect(roles.coverIndex).not.toBe(roles.presserIndex);
  });

  it('never assigns a dismissed player as the presser or cover defender', () => {
    const players = initialPlayers();
    players[18].x = 0.72;
    players[18].y = 0.3;
    const activePlayerIndices = new Set(Array.from({ length: 22 }, (_, index) => index));
    activePlayerIndices.delete(18);

    const roles = selectDefensiveRoles(players, false, 0.72, 0.3, activePlayerIndices);

    expect(roles.presserIndex).not.toBe(18);
    expect(roles.coverIndex).not.toBe(18);
  });

  it('moves the presser toward the ball while the cover stays goal-side', () => {
    const players = initialPlayers();
    const phase: PassPhase = {
      passerIdx: 7,
      receiverIdx: 10,
      attackingHome: true,
      kind: 'pass',
      duration: 40,
      hold: 20,
      arc: 0.1,
      intercepted: false,
    };
    const before = selectDefensiveRoles(players, false, 0.72, 0.3);

    for (let frame = 0; frame < 12; frame++) {
      updatePlayerPositions(players, 0.72, 0.3, 'home', 7, phase, 'passing', null, 0.04);
    }

    expect(distToBall(players[before.presserIndex], 0.72, 0.3)).toBeLessThan(0.12);
    expect(players[before.coverIndex].x).toBeGreaterThan(0.72);
  });
});

function distToBall(player: PlayerState, x: number, y: number): number {
  return Math.hypot(player.x - x, player.y - y);
}

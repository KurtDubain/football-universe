import { describe, expect, it } from 'vitest';
import { computeBallPosition, computeCarryTarget, computePostShotBallPosition, selectDefensiveRoles, updatePlayerPositions } from './physics';
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

  it('gives ground passes an early roll advantage while shots wait for the kicking motion', () => {
    const groundPass = computeBallPosition({
      passing: true,
      phaseFrame: 30,
      duration: 60,
      arc: 0,
      source: { x: 0, y: 0 },
      target: { x: 100, y: 0 },
      frame: 30,
      flightKind: 'pass',
    });
    const windingUp = computeBallPosition({
      passing: true,
      phaseFrame: 3,
      duration: 20,
      arc: 0.1,
      source: { x: 10, y: 20 },
      target: { x: 100, y: 20 },
      frame: 3,
      flightKind: 'shot',
      releaseDelayFrames: 4,
    });

    expect(groundPass.bx).toBeGreaterThan(50);
    expect(windingUp.bx).toBe(10);
    expect(windingUp.arcLift).toBe(0);
  });

  it('adds a bounded visual bend to shots without changing their endpoints', () => {
    const middle = computeBallPosition({
      passing: true,
      phaseFrame: 14,
      duration: 28,
      arc: 0.1,
      source: { x: 100, y: 100 },
      target: { x: 200, y: 100 },
      frame: 14,
      flightKind: 'shot',
      swerve: 0.8,
    });
    const end = computeBallPosition({
      passing: true,
      phaseFrame: 28,
      duration: 28,
      arc: 0.1,
      source: { x: 100, y: 100 },
      target: { x: 200, y: 100 },
      frame: 28,
      flightKind: 'shot',
      swerve: 0.8,
    });

    expect(middle.by).toBeGreaterThan(106);
    expect(end.by).toBeCloseTo(100);
  });

  it('spills saves into play and sends blocks farther sideways', () => {
    const save = computePostShotBallPosition({
      outcome: 'save', target: { x: 500, y: 140 }, attackingHome: true, progress: 1, seed: 2,
    });
    const block = computePostShotBallPosition({
      outcome: 'block', target: { x: 500, y: 140 }, attackingHome: true, progress: 1, seed: 2,
    });

    expect(save.bx).toBeLessThan(500);
    expect(block.bx).toBeLessThan(save.bx);
    expect(Math.abs(block.by - 140)).toBeGreaterThan(Math.abs(save.by - 140));
  });

  it('carries possession forward without leaving the pitch', () => {
    expect(computeCarryTarget({ x: 0.5, y: 0.4 }, true, 1, 0.03)).toEqual({ x: 0.53, y: 0.4 });
    expect(computeCarryTarget({ x: 0.04, y: 0.4 }, false, 1, 0.03).x).toBe(0.03);
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

  it('does not let the shooter chase a completed shot into the goal', () => {
    const players = initialPlayers();
    const shot: PassPhase = {
      passerIdx: 9,
      receiverIdx: 9,
      attackingHome: true,
      kind: 'shot',
      duration: 20,
      hold: 12,
      arc: 0.1,
      intercepted: false,
      sourceOverride: { x: 0.82, y: 0.48 },
    };

    for (let frame = 0; frame < 20; frame++) {
      updatePlayerPositions(players, 0.985, 0.5, 'home', 9, shot, 'holding', { x: 0.985, y: 0.5 }, 0.07);
    }

    expect(players[9].x).toBeGreaterThan(0.79);
    expect(players[9].x).toBeLessThan(0.85);
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

  it('moves the receiver and presser toward the pass destination while cover stays goal-side', () => {
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
      targetOverride: { x: 0.82, y: 0.3 },
    };
    const before = selectDefensiveRoles(players, false, 0.82, 0.3);

    for (let frame = 0; frame < 12; frame++) {
      updatePlayerPositions(players, 0.6, 0.45, 'home', 7, phase, 'passing', null, 0.04);
    }

    expect(players[10].x).toBeGreaterThan(0.75);
    expect(distToBall(players[before.presserIndex], 0.82, 0.3)).toBeLessThan(0.16);
    expect(players[before.coverIndex].x).toBeGreaterThan(0.6);
  });

  it('steps the goalkeeper out to narrow a close-range angle', () => {
    const players = initialPlayers();
    const phase: PassPhase = {
      passerIdx: 9,
      receiverIdx: 9,
      attackingHome: true,
      kind: 'shot',
      duration: 20,
      hold: 10,
      arc: 0.1,
      intercepted: false,
    };

    for (let frame = 0; frame < 12; frame++) {
      updatePlayerPositions(players, 0.86, 0.35, 'home', 9, phase, 'shooting', { x: 0.985, y: 0.45 }, 0.04);
    }

    expect(players[11].x).toBeLessThan(0.925);
    expect(players[11].y).toBeLessThan(0.5);
  });

  it('delays the credited goalkeeper reaction until after the shot leaves the foot', () => {
    const beforeRelease = initialPlayers();
    const afterRelease = initialPlayers();
    const phase: PassPhase = {
      passerIdx: 9,
      receiverIdx: 9,
      attackingHome: false,
      kind: 'shot',
      duration: 20,
      hold: 10,
      arc: 0.1,
      intercepted: false,
    };
    const action = { playerIndex: 0, target: { x: 0.015, y: 0.42 } };

    for (let frame = 0; frame < 10; frame++) {
      updatePlayerPositions(beforeRelease, 0.15, 0.42, 'away', 9, phase, 'shooting', { x: 0.015, y: 0.42 }, 0.04, action, undefined, 0.1);
      updatePlayerPositions(afterRelease, 0.08, 0.42, 'away', 9, phase, 'shooting', { x: 0.015, y: 0.42 }, 0.04, action, undefined, 0.9);
    }

    expect(afterRelease[0].x).toBeLessThan(beforeRelease[0].x);
  });
});

function distToBall(player: PlayerState, x: number, y: number): number {
  return Math.hypot(player.x - x, player.y - y);
}

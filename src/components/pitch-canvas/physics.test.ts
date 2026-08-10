import { describe, expect, it } from 'vitest';
import { buildTacticalAssignments, computeAttackingShapeTarget, computeBallPosition, computeCarryTarget, computePostShotBallPosition, selectDefensiveRoles, selectMarkingTarget, separateActivePlayers, updatePlayerPositions } from './physics';
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

  it('keeps a routine held save with the goalkeeper instead of inventing a rebound', () => {
    const held = computePostShotBallPosition({
      outcome: 'save', target: { x: 500, y: 140 }, attackingHome: true, progress: 1, seed: 2, held: true,
    });
    const parried = computePostShotBallPosition({
      outcome: 'save', target: { x: 500, y: 140 }, attackingHome: true, progress: 1, seed: 2,
    });

    expect(Math.abs(held.bx - 500)).toBeLessThan(Math.abs(parried.bx - 500));
    expect(Math.abs(held.by - 140)).toBeLessThan(2);
  });

  it('carries possession forward without leaving the pitch', () => {
    expect(computeCarryTarget({ x: 0.5, y: 0.4 }, true, 1, 0.03)).toEqual({ x: 0.53, y: 0.4 });
    expect(computeCarryTarget({ x: 0.04, y: 0.4 }, false, 1, 0.03).x).toBe(0.03);
  });

  it('separates crowded active silhouettes while keeping the ball actor fixed', () => {
    const players = initialPlayers();
    players[8].x = players[9].x = players[10].x = 0.84;
    players[8].y = players[9].y = players[10].y = 0.5;
    const pinned = new Set([9]);

    separateActivePlayers(players, new Set([8, 9, 10]), pinned);

    expect(players[9]).toMatchObject({ x: 0.84, y: 0.5 });
    expect(Math.hypot(players[8].x - players[9].x, (players[8].y - players[9].y) * 0.52)).toBeGreaterThan(0.018);
    expect(Math.hypot(players[10].x - players[9].x, (players[10].y - players[9].y) * 0.52)).toBeGreaterThan(0.018);
    expect(players.every(player => player.x >= 0.03 && player.x <= 0.97)).toBe(true);
    expect(players.every(player => player.y >= 0.05 && player.y <= 0.95)).toBe(true);
  });

  it('sends only the ball-side unit into a wing overload', () => {
    const nearFullback = computeAttackingShapeTarget({
      formIdx: 1, isHomeTeam: true, shift: 0, ballNX: 0.62, ballNY: 0.2, pattern: 'wing_overload', stage: 'create',
    });
    const farFullback = computeAttackingShapeTarget({
      formIdx: 4, isHomeTeam: true, shift: 0, ballNX: 0.62, ballNY: 0.2, pattern: 'wing_overload', stage: 'create',
    });
    const striker = computeAttackingShapeTarget({
      formIdx: 9, isHomeTeam: true, shift: 0, ballNX: 0.62, ballNY: 0.2, pattern: 'wing_overload', stage: 'create',
    });

    expect(nearFullback.x).toBeGreaterThan(farFullback.x);
    expect(nearFullback.y).toBeLessThan(0.2);
    expect(nearFullback.sprint).toBeGreaterThan(0.7);
    expect(striker.y).toBe(0.5);
  });

  it('keeps rest defence behind a counter while the front three sprint', () => {
    const centerBack = computeAttackingShapeTarget({
      formIdx: 2, isHomeTeam: true, shift: 0, ballNX: 0.55, ballNY: 0.3, pattern: 'counter', stage: 'transition',
    });
    const winger = computeAttackingShapeTarget({
      formIdx: 8, isHomeTeam: true, shift: 0, ballNX: 0.55, ballNY: 0.3, pattern: 'counter', stage: 'transition',
    });

    expect(centerBack.x).toBeLessThan(0.3);
    expect(centerBack.sprint).toBe(0);
    expect(winger.x).toBeGreaterThan(0.65);
    expect(winger.sprint).toBe(1);
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
    players[9].x = 0.82;
    players[9].y = 0.48;

    for (let frame = 0; frame < 20; frame++) {
      updatePlayerPositions(players, 0.985, 0.5, 'home', 9, shot, 'holding', { x: 0.985, y: 0.5 }, 0.07);
    }

    expect(players[9].x).toBeGreaterThan(0.79);
    expect(players[9].x).toBeLessThan(0.85);
  });

  it('holds a spaced defensive box line after a shot is released', () => {
    const players = initialPlayers();
    const shot: PassPhase = {
      passerIdx: 9,
      receiverIdx: 9,
      attackingHome: true,
      kind: 'shot',
      pattern: 'central_combination',
      stage: 'finish',
      duration: 24,
      hold: 12,
      arc: 0.1,
      intercepted: false,
      sourceOverride: { x: 0.82, y: 0.5 },
    };

    for (let frame = 0; frame < 30; frame++) {
      updatePlayerPositions(players, 0.96, 0.48, 'home', 9, shot, 'shooting', { x: 0.985, y: 0.48 }, 0.04);
    }

    const backLine = players.slice(12, 16);
    const sortedY = backLine.map(player => player.y).sort((a, b) => a - b);
    expect(backLine.every(player => player.x > 0.82 && player.x < 0.94)).toBe(true);
    expect(sortedY.slice(1).every((value, index) => value - sortedY[index] > 0.08)).toBe(true);
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

  it('pairs active defensive lanes with active midfield or forward threats', () => {
    const players = initialPlayers();
    const activePlayerIndices = new Set(Array.from({ length: 22 }, (_, index) => index));
    const firstTarget = selectMarkingTarget(players, 1, true, activePlayerIndices);
    const farTarget = selectMarkingTarget(players, 4, true, activePlayerIndices);

    expect(firstTarget).toBeDefined();
    expect(farTarget).toBeDefined();
    expect(firstTarget).not.toBe(farTarget);
    expect(firstTarget).toBeGreaterThanOrEqual(11);

    activePlayerIndices.delete(firstTarget!);
    expect(selectMarkingTarget(players, 1, true, activePlayerIndices)).not.toBe(firstTarget);
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
    const assignments = buildTacticalAssignments(players, false, 0.82, 0.3);
    const receiverDistanceBefore = distToBall(players[10], 0.82, 0.3);

    for (let frame = 0; frame < 12; frame++) {
      updatePlayerPositions(players, 0.6, 0.45, 'home', 7, phase, 'passing', null, 0.04, undefined, undefined, 0, assignments);
    }

    expect(distToBall(players[10], 0.82, 0.3)).toBeLessThan(receiverDistanceBefore);
    expect(distToBall(players[before.presserIndex], 0.82, 0.3)).toBeLessThan(0.22);
    expect(players[before.coverIndex].x).toBeGreaterThan(0.6);
  });

  it('keeps defensive responsibilities stable for a complete phase', () => {
    const players = initialPlayers();
    const assignments = buildTacticalAssignments(players, false, 0.72, 0.3);
    const originalPresser = assignments.presserIndex;
    const originalMark = assignments.markingTargets[12];

    players[17].x = 0.72;
    players[17].y = 0.3;
    players[originalPresser].x = 0.95;
    players[originalPresser].y = 0.9;

    expect(assignments.presserIndex).toBe(originalPresser);
    expect(assignments.markingTargets[12]).toBe(originalMark);
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

  it('prepares the credited blocker in the shooting lane before the final shot', () => {
    const players = initialPlayers();
    const createPhase: PassPhase = {
      passerIdx: 7,
      receiverIdx: 9,
      attackingHome: true,
      kind: 'pass',
      pattern: 'central_combination',
      stage: 'create',
      duration: 52,
      hold: 18,
      arc: 0.08,
      intercepted: false,
      targetOverride: { x: 0.82, y: 0.52 },
    };
    const action = { playerIndex: 13, target: { x: 0.985, y: 0.54 } };
    const initialDistance = distToBall(players[13], 0.91, 0.54);

    for (let frame = 0; frame < 90; frame++) {
      updatePlayerPositions(
        players, 0.72, 0.5, 'home', 7, createPhase, 'passing', null, 0.04,
        action, undefined, frame / 90,
      );
    }

    expect(distToBall(players[13], 0.91, 0.54)).toBeLessThan(Math.min(0.08, initialDistance * 0.4));
    expect(players[13].x).toBeGreaterThan(0.85);
  });

  it('lets the credited goalkeeper shade across without diving before release', () => {
    const players = initialPlayers();
    const createPhase: PassPhase = {
      passerIdx: 7,
      receiverIdx: 9,
      attackingHome: false,
      kind: 'pass',
      pattern: 'wing_overload',
      stage: 'create',
      duration: 52,
      hold: 18,
      arc: 0.08,
      intercepted: false,
      targetOverride: { x: 0.18, y: 0.32 },
    };
    const action = { playerIndex: 0, target: { x: 0.015, y: 0.4 } };

    for (let frame = 0; frame < 60; frame++) {
      updatePlayerPositions(
        players, 0.24, 0.32, 'away', 7, createPhase, 'passing', null, 0.04,
        action, undefined, frame / 60,
      );
    }

    expect(players[0].y).toBeLessThan(0.5);
    expect(players[0].y).toBeGreaterThan(0.42);
    expect(players[0].x).toBeGreaterThanOrEqual(0.03);
  });
});

function distToBall(player: PlayerState, x: number, y: number): number {
  return Math.hypot(player.x - x, player.y - y);
}

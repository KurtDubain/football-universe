import { describe, expect, it } from 'vitest';
import { buildTacticalAssignments, computeAttackingShapeTarget, computeBallPosition, computeCarryTarget, computeDefensiveReactionProgress, computePostShotBallPosition, computeReceptionTouchOffset, defensiveReactionDelay, getBaseSlot, idleDriftOffset, pursuitSpeed, selectDefensiveRoles, selectMarkingTarget, separateActivePlayers, updatePlayerPositions } from './physics';
import { setPiecePlayerTarget } from './set-pieces';
import { keeperCanReach } from './keeper-action';
import { BASE_FORMATION, getFormationSlots, type PassPhase, type PlayerState } from './types';
import { createPitchGeometry, NORMALIZED_PITCH_SCREEN_ASPECT, playerSeparationDistance } from './geometry';

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
  it('keeps formation-specific role counts and mirrored base positions', () => {
    const defensiveShape = getFormationSlots('5-4-1');
    const homeFifthDefender = getBaseSlot(5, true, 0, defensiveShape);
    const awayFifthDefender = getBaseSlot(5, false, 0, defensiveShape);

    expect(homeFifthDefender.role).toBe('DF');
    expect(awayFifthDefender.role).toBe('DF');
    expect(homeFifthDefender.x + awayFifthDefender.x).toBeCloseTo(1);
    expect(getFormationSlots('4-2-3-1').filter(slot => slot.role === 'MF')).toHaveLength(5);
  });

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
    // The ball must not travel toward the target before the kick. It is no
    // longer pinned to the exact spot, though: a player standing over a dead
    // ball keeps it moving under their foot, which is what stops the run-up
    // being the longest frozen stretch in a match.
    expect(Math.hypot(windingUp.bx - 10, windingUp.by - 20)).toBeLessThan(4);
    expect(windingUp.arcLift).toBe(0);
  });

  it('cushions an arriving pass without moving either endpoint', () => {
    const source = { x: 20, y: 40 };
    const target = { x: 120, y: 80 };
    expect(computeReceptionTouchOffset(source, target, 0)).toEqual({ x: 0, y: 0 });
    expect(computeReceptionTouchOffset(source, target, 1).x).toBeCloseTo(0);
    const middle = computeReceptionTouchOffset(source, target, 0.5);
    expect(Math.hypot(middle.x, middle.y)).toBeCloseTo(3.4);
    expect(middle.x).toBeGreaterThan(0);
    expect(middle.y).toBeGreaterThan(0);
  });

  it('lets transitions react faster than settled build-up while preserving a readable delay', () => {
    expect(computeDefensiveReactionProgress('build', 'passing', 0.08)).toBe(0);
    expect(computeDefensiveReactionProgress('transition', 'passing', 0.08)).toBeGreaterThan(0);
    expect(computeDefensiveReactionProgress('finish', 'holding', 0)).toBe(1);
  });

  it('staggers off-ball defensive reactions deterministically by role and lane', () => {
    expect(defensiveReactionDelay(2, 'DF', 'build')).toBeGreaterThan(0);
    expect(defensiveReactionDelay(2, 'DF', 'build')).toBe(defensiveReactionDelay(2, 'DF', 'build'));
    expect(defensiveReactionDelay(7, 'MF', 'build')).toBeGreaterThan(defensiveReactionDelay(2, 'DF', 'transition'));
    expect(defensiveReactionDelay(0, 'GK', 'create')).toBe(0);
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
    expect(Math.hypot(players[8].x - players[9].x, (players[8].y - players[9].y) * NORMALIZED_PITCH_SCREEN_ASPECT)).toBeGreaterThan(0.018);
    expect(Math.hypot(players[10].x - players[9].x, (players[10].y - players[9].y) * NORMALIZED_PITCH_SCREEN_ASPECT)).toBeGreaterThan(0.018);
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

  it('keeps a two-forward shape in staggered finishing lanes', () => {
    const formation = getFormationSlots('4-4-2');
    const firstForward = computeAttackingShapeTarget({
      formIdx: 9,
      isHomeTeam: true,
      shift: 0,
      ballNX: 0.66,
      ballNY: 0.46,
      pattern: 'central_combination',
      stage: 'create',
      formation,
    });
    const secondForward = computeAttackingShapeTarget({
      formIdx: 10,
      isHomeTeam: true,
      shift: 0,
      ballNX: 0.66,
      ballNY: 0.46,
      pattern: 'central_combination',
      stage: 'create',
      formation,
    });

    expect(firstForward.x).toBeCloseTo(secondForward.x);
    expect(secondForward.y - firstForward.y).toBeGreaterThan(0.14);
  });

  it('keeps supporting counter runners outside the goal-line buffer', () => {
    const formation = getFormationSlots('4-4-2');
    const awayForward = computeAttackingShapeTarget({
      formIdx: 9,
      isHomeTeam: false,
      shift: 0,
      ballNX: 0.11,
      ballNY: 0.46,
      pattern: 'counter',
      stage: 'create',
      formation,
    });

    expect(awayForward.x).toBeGreaterThanOrEqual(0.075);
    expect(awayForward.x).toBeLessThan(0.11);
  });

  it('lets a free-kick wall form during the setup instead of reacting after contact', () => {
    const players = initialPlayers();
    const phase: PassPhase = {
      passerIdx: 7,
      receiverIdx: 7,
      attackingHome: true,
      kind: 'shot',
      duration: 112,
      releaseDelayFrames: 84,
      hold: 20,
      arc: 0.2,
      intercepted: false,
      setPiece: 'direct_free_kick',
      sourceOverride: { x: 0.8, y: 0.5 },
    };

    // The wall walks into shape at a footballer's pace. A live free kick
    // stages the wall directly when the scene loads; this is the un-staged
    // path, and it needs enough frames for players to actually get there.
    for (let frame = 0; frame < 220; frame++) {
      updatePlayerPositions(
        players,
        0.8,
        0.5,
        'home',
        7,
        phase,
        'shooting',
        { x: 0.985, y: 0.5 },
        0,
        undefined,
        undefined,
        0,
      );
    }

    expect(players.slice(12, 16).every(player => player.x > 0.8)).toBe(true);
    expect(Math.max(...players.slice(12, 16).map(player => player.y))
      - Math.min(...players.slice(12, 16).map(player => player.y))).toBeGreaterThan(0.07);
  });

  it('shows the number ten ahead of the double pivot in a 4-2-3-1 combination', () => {
    const formation = getFormationSlots('4-2-3-1');
    const pivot = computeAttackingShapeTarget({
      formIdx: 5,
      isHomeTeam: true,
      shift: 0,
      ballNX: 0.62,
      ballNY: 0.5,
      pattern: 'central_combination',
      stage: 'progress',
      formation,
    });
    const numberTen = computeAttackingShapeTarget({
      formIdx: 8,
      isHomeTeam: true,
      shift: 0,
      ballNX: 0.62,
      ballNY: 0.5,
      pattern: 'central_combination',
      stage: 'progress',
      formation,
    });

    expect(numberTen.x - pivot.x).toBeGreaterThan(0.12);
    expect(numberTen.y).toBeCloseTo(0.5);
  });

  it('never snaps the shooter to the release point and keeps support lanes apart', () => {
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

    // The shooter walks toward their release point and is never snapped to
    // it. This used to assert `> 0.8`, which was the defect itself: the
    // release clamp moved the shooter 29 m in a single frame, on the most
    // visible frame of the match.
    expect(players[9].x).toBeGreaterThan(0.52);
    expect(players[9].x).toBeLessThan(0.8);
    // Nobody follows the ball into the goal.
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

    // A back line dropping into its own box covers eight or nine metres. At
    // a footballer's pace that is over three seconds, not half of one: the old
    // budget of 30 frames only worked because players moved at 24 m/s.
    for (let frame = 0; frame < 200; frame++) {
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

    // A keeper narrowing the angle covers about five metres off their line.
    for (let frame = 0; frame < 70; frame++) {
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

  it('sets the goalkeeper rather than sliding them onto the ball', () => {
    const players = initialPlayers();
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
    const target = { x: 0.015, y: 0.54 };
    const action = { playerIndex: 0, target };

    for (let frame = 0; frame < 90; frame++) {
      updatePlayerPositions(
        players, 0.12, 0.5, 'away', 9, phase, 'shooting', target, 0.04,
        action, undefined, 0.95,
      );
    }

    // The keeper has to still be short of the ball when it arrives: the dive
    // covers the rest, and a keeper already standing on the target leaves the
    // drawn save with no distance to travel.
    const gap = Math.abs(target.y - players[0].y);
    expect(gap).toBeGreaterThan(0.01);
    expect(keeperCanReach(target.y, players[0].y)).toBe(true);
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

    // Recovering into a shooting lane is a fifteen-metre run, not a five-metre
    // one, so the blocker needs the length of a real approach.
    for (let frame = 0; frame < 190; frame++) {
      updatePlayerPositions(
        players, 0.72, 0.5, 'home', 7, createPhase, 'passing', null, 0.04,
        action, undefined, frame / 190,
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

  it('separates overlapping silhouettes to the drawn body width, not a fixed constant', () => {
    const cluster = (): PlayerState[] => {
      const players = initialPlayers();
      for (const index of [8, 9, 10]) {
        players[index].x = 0.84;
        players[index].y = 0.5;
      }
      return players;
    };
    const gapFromPinned = (players: PlayerState[], index: number) => Math.hypot(
      players[index].x - players[9].x,
      (players[index].y - players[9].y) * NORMALIZED_PITCH_SCREEN_ASPECT,
    );

    // The default must already carry the derived bound: the old fixed 0.022
    // default left the drawn markers wider than the gap between them.
    const byDefault = cluster();
    separateActivePlayers(byDefault, new Set([8, 9, 10]), new Set([9]));
    expect(gapFromPinned(byDefault, 8)).toBeGreaterThan(0.024);

    const base = cluster();
    separateActivePlayers(base, new Set([8, 9, 10]), new Set([9]), playerSeparationDistance(1));
    const constrained = cluster();
    separateActivePlayers(constrained, new Set([8, 9, 10]), new Set([9]), playerSeparationDistance(1.16));

    expect(base[9]).toMatchObject({ x: 0.84, y: 0.5 });
    expect(gapFromPinned(base, 8)).toBeGreaterThan(0.022);
    expect(gapFromPinned(constrained, 8)).toBeGreaterThan(gapFromPinned(base, 8));
    expect(gapFromPinned(constrained, 8)).toBeGreaterThan(playerSeparationDistance(1.16) * 0.85);
  });

  it('holds three defensive depths on a released shot instead of collapsing into the box', () => {
    const players = initialPlayers();
    const shot: PassPhase = {
      passerIdx: 9,
      receiverIdx: 9,
      attackingHome: true,
      kind: 'shot',
      duration: 90,
      hold: 10,
      arc: 0.1,
      intercepted: false,
      sourceOverride: { x: 0.82, y: 0.18 },
    };

    for (let frame = 0; frame < 200; frame++) {
      updatePlayerPositions(players, 0.94, 0.18, 'home', 9, shot, 'shooting', null, 0.05);
    }

    const away = players.slice(11, 22);
    const outfield = away.filter((_, index) => BASE_FORMATION[index].role !== 'GK');
    const xs = outfield.map(player => player.x);
    const meanXFor = (role: string) => {
      const group = away.filter((_, index) => BASE_FORMATION[index].role === role);
      return group.reduce((sum, player) => sum + player.x, 0) / group.length;
    };

    // Eleven defenders spanning 13.7 m is narrower than the penalty area: a
    // wall, not a defence. The layers have to survive the shot.
    expect((Math.max(...xs) - Math.min(...xs)) * 105).toBeGreaterThan(20);
    // Away defends the x = 1 goal, so depth runs DF -> MF -> FW toward halfway.
    expect(meanXFor('DF')).toBeGreaterThan(meanXFor('MF'));
    expect(meanXFor('MF')).toBeGreaterThan(meanXFor('FW'));
    // Forwards stay near halfway as the counter-attack outlet, not as cover.
    expect(meanXFor('FW')).toBeLessThan(0.62);
    // The block slides toward the ball's flank instead of funnelling through the middle.
    const meanY = outfield.reduce((sum, player) => sum + player.y, 0) / outfield.length;
    expect(meanY).toBeLessThan(0.48);
  });

  it('keeps a missed shot beside the goal instead of parking it off-canvas', () => {
    const pitch = createPitchGeometry();
    const sceneTarget = {
      x: pitch.padding + 1.008 * pitch.fieldWidth,
      y: pitch.padding + 0.63 * pitch.fieldHeight,
    };

    const miss = computePostShotBallPosition({
      outcome: 'miss', target: sceneTarget, attackingHome: true, progress: 1, seed: 5,
    });
    const mirrored = computePostShotBallPosition({
      outcome: 'miss',
      target: { x: pitch.padding - 0.008 * pitch.fieldWidth, y: sceneTarget.y },
      attackingHome: false,
      progress: 1,
      seed: 5,
    });

    // The goal line sits 10 px inside the canvas edge; the ball must stay drawn.
    expect(miss.bx).toBeLessThanOrEqual(pitch.canvasWidth - 3);
    expect(mirrored.bx).toBeGreaterThanOrEqual(3);
    // Residual motion runs across the face of goal, not on down the field.
    expect(Math.abs(miss.by - sceneTarget.y)).toBeGreaterThan(Math.abs(miss.bx - sceneTarget.x));
  });
});

function distToBall(player: PlayerState, x: number, y: number): number {
  return Math.hypot(player.x - x, player.y - y);
}

describe('pitch motion liveliness', () => {
  it('holds pace until the braking distance and then eases in', () => {
    expect(pursuitSpeed(0, 0.0034, 0.004)).toBe(0);
    expect(pursuitSpeed(-1, 0.0034, 0.004)).toBe(0);
    expect(pursuitSpeed(0.02, 0.0034, 0.004)).toBeCloseTo(0.0034);
    // A quarter of the braking distance is half the speed — a square root,
    // not the straight line the old proportional controller used.
    expect(pursuitSpeed(0.001, 0.0034, 0.004)).toBeCloseTo(0.0017);
  });

  it('drifts a settled player without carrying them off their slot', () => {
    const early = idleDriftOffset(3, 0);
    const later = idleDriftOffset(3, 40);
    expect(Math.hypot(later.x - early.x, later.y - early.y)).toBeGreaterThan(0.001);
    expect(Math.hypot(early.x, early.y)).toBeLessThan(0.012);
    expect(Math.hypot(later.x, later.y)).toBeLessThan(0.012);
  });

  it('gives every player their own drift phase', () => {
    expect(idleDriftOffset(0, 100)).not.toEqual(idleDriftOffset(1, 100));
    expect(idleDriftOffset(4, 100)).not.toEqual(idleDriftOffset(9, 100));
  });

  it('rolls the ball at the carrier\'s feet instead of pinning it', () => {
    const samples = [0, 5, 11, 17, 23].map(frame => computeBallPosition({
      passing: false,
      phaseFrame: 0,
      duration: 40,
      arc: 0,
      source: { x: 0, y: 0 },
      target: { x: 100, y: 100 },
      frame,
      holdFacing: { dx: 1, dy: 0 },
    }));
    for (const sample of samples) {
      expect(Math.hypot(sample.bx - 100, sample.by - 100)).toBeLessThan(4);
      expect(sample.arcLift).toBe(0);
    }
    const spreadX = Math.max(...samples.map(s => s.bx)) - Math.min(...samples.map(s => s.bx));
    expect(spreadX).toBeGreaterThan(2);
  });

  it('keeps a dead ball alive for the whole run-up', () => {
    const source = { x: 480, y: 40 };
    const samples = [1, 20, 40, 60].map(frame => computeBallPosition({
      passing: true,
      phaseFrame: frame,
      duration: 102,
      arc: 0.92,
      source,
      target: { x: 100, y: 170 },
      frame,
      flightKind: 'pass',
      releaseDelayFrames: 70,
      holdFacing: { dx: -1, dy: 1 },
    }));
    // Not one of those frames may sit exactly on the spot: the run-up used to
    // be the longest frozen stretch in a match.
    for (const sample of samples) {
      expect(Math.hypot(sample.bx - source.x, sample.by - source.y)).toBeGreaterThan(0);
      expect(Math.hypot(sample.bx - source.x, sample.by - source.y)).toBeLessThan(4);
    }
  });

  it('walks a set-piece taker in from behind the ball', () => {
    const phase: PassPhase = {
      passerIdx: 6,
      receiverIdx: 9,
      attackingHome: true,
      kind: 'pass',
      duration: 102,
      hold: 24,
      arc: 0.92,
      intercepted: false,
      setPiece: 'corner',
      releaseDelayFrames: 70,
      sourceOverride: { x: 0.965, y: 0.055 },
      targetOverride: { x: 0.89, y: 0.46 },
    };
    const start = setPiecePlayerTarget(6, true, 'MF', phase, BASE_FORMATION, 0);
    const settled = setPiecePlayerTarget(6, true, 'MF', phase, BASE_FORMATION, 1);
    expect(settled).toEqual({ x: 0.965, y: 0.055 });
    expect(start).toBeDefined();
    expect(Math.hypot(start!.x - settled!.x, start!.y - settled!.y)).toBeGreaterThan(0.02);
  });
});

describe('realistic player pace', () => {
  const PITCH_LENGTH_METERS = 105;
  const PITCH_WIDTH_METERS = 68;
  const FRAMES_PER_SECOND = 60;

  it('never moves a player faster than a footballer can run', () => {
    const players = initialPlayers();
    const phase: PassPhase = {
      passerIdx: 9,
      receiverIdx: 9,
      attackingHome: true,
      kind: 'shot',
      pattern: 'counter',
      stage: 'finish',
      duration: 40,
      hold: 20,
      arc: 0.1,
      intercepted: false,
      sourceOverride: { x: 0.84, y: 0.5 },
    };

    let peakSpeed = 0;
    let peakStep = 0;
    const before = players.map(player => ({ x: player.x, y: player.y }));
    for (let frame = 0; frame < 600; frame++) {
      updatePlayerPositions(
        players,
        0.5 + 0.45 * (frame / 600),
        0.5,
        'home',
        9,
        phase,
        'shooting',
        { x: 0.985, y: 0.5 },
        0,
      );
      for (let index = 0; index < 22; index++) {
        const step = Math.hypot(
          (players[index].x - before[index].x) * PITCH_LENGTH_METERS,
          (players[index].y - before[index].y) * PITCH_WIDTH_METERS,
        );
        peakStep = Math.max(peakStep, step);
        peakSpeed = Math.max(peakSpeed, step * FRAMES_PER_SECOND);
        before[index].x = players[index].x;
        before[index].y = players[index].y;
      }
    }

    // An elite sprinter peaks around 10 m/s. The old speed table produced a
    // 24 m/s cruise and a 63 m/s sprint, which is what made the pitch look
    // like it was on fast-forward.
    expect(peakSpeed).toBeLessThan(12);
    // No single frame may carry a player further than a stride. The release
    // clamp used to move the shooter 19.9 m in one frame.
    expect(peakStep).toBeLessThan(0.5);
  });

  it('covers the same ground per second at half the frame rate', () => {
    const phase: PassPhase = {
      passerIdx: 9,
      receiverIdx: 9,
      attackingHome: true,
      kind: 'pass',
      pattern: 'counter',
      stage: 'progress',
      duration: 60,
      hold: 10,
      arc: 0.05,
      intercepted: false,
      targetOverride: { x: 0.9, y: 0.5 },
    };

    // A 30 fps machine runs a 33 ms step where a 60 fps one runs 16.7 ms, so
    // it must move each player twice as far per call. Without that the same
    // player covers the same ground in half the wall-clock speed while the
    // ball keeps real time around them.
    const run = (steps: number, stepScale: number) => {
      const players = initialPlayers();
      for (let frame = 0; frame < steps; frame++) {
        updatePlayerPositions(
          players, 0.5, 0.5, 'home', 9, phase, 'passing', null, 0,
          undefined, undefined, 0.5, undefined, undefined, frame, 1, stepScale,
        );
      }
      return players[9].x;
    };

    const atSixty = run(120, 1);
    const atThirty = run(60, 2);

    expect(atThirty).toBeCloseTo(atSixty, 2);
  });
});


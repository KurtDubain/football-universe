// Pure ball + player position math. No canvas, no refs.
// Operates entirely in normalized (0-1) field coordinates.

import { clamp, dist, lerp, seededRand } from './math';
import { BASE_FORMATION, type PassPhase, type PlayerState, type Role } from './types';

/**
 * Where a player should be standing in their formation slot, given the
 * tactical shift (positive = home team pushed up, away pulled back).
 * Returns normalized coordinates clamped to a sensible range.
 */
export function getBaseSlot(
  formIdx: number,
  isHomeTeam: boolean,
  shift: number,
): { x: number; y: number; role: Role } {
  const base = BASE_FORMATION[formIdx];
  const s = isHomeTeam ? shift : -shift;
  const bx = isHomeTeam ? base.x + s : 1 - base.x - s;
  return { x: clamp(bx, 0.03, 0.97), y: base.y, role: base.role };
}

export interface BallComputeInput {
  passing: boolean;            // true while in flight; false while held
  phaseFrame: number;          // frames into current phase
  duration: number;            // total frames the pass takes
  arc: number;                 // 0-1 arc factor (long balls higher)
  source: { x: number; y: number };  // pixel coords of passer
  target: { x: number; y: number };  // pixel coords of target / holder spot
  frame: number;               // global frame counter (for hold micro-motion)
  flightKind?: 'pass' | 'shot';
  releaseDelayFrames?: number;
  swerve?: number;
}

export interface BallComputeResult {
  bx: number;
  by: number;
  arcLift: number;             // pixels the ball lifts above ground
  spinDelta: number;           // amount to add to ball spin this frame
}

export interface DefensiveRoles {
  presserIndex: number;
  coverIndex: number;
}

export function selectMarkingTarget(
  playerPos: PlayerState[],
  markerIndex: number,
  defendingHome: boolean,
  activePlayerIndices?: ReadonlySet<number>,
): number | undefined {
  const defendingOffset = defendingHome ? 0 : 11;
  const attackingOffset = defendingHome ? 11 : 0;
  const markerSlot = markerIndex - defendingOffset;
  const markerRole = BASE_FORMATION[markerSlot]?.role;
  if (markerRole !== 'DF' && markerRole !== 'MF') return undefined;

  const markers = BASE_FORMATION
    .map((slot, slotIndex) => ({ slot, index: defendingOffset + slotIndex }))
    .filter(candidate => (
      (candidate.slot.role === 'DF' || candidate.slot.role === 'MF')
      && (!activePlayerIndices || activePlayerIndices.has(candidate.index))
    ))
    .sort((a, b) => a.slot.y - b.slot.y);
  const threats = BASE_FORMATION
    .map((slot, slotIndex) => ({ slot, index: attackingOffset + slotIndex }))
    .filter(candidate => (
      (candidate.slot.role === 'FW' || candidate.slot.role === 'MF')
      && (!activePlayerIndices || activePlayerIndices.has(candidate.index))
    ))
    .sort((a, b) => playerPos[a.index].y - playerPos[b.index].y);
  if (threats.length === 0) return undefined;

  const markerRank = markers.findIndex(candidate => candidate.index === markerIndex);
  if (markerRank < 0) return undefined;
  const threatRank = markers.length <= 1
    ? 0
    : Math.round((markerRank / (markers.length - 1)) * (threats.length - 1));
  return threats[threatRank]?.index;
}

export function selectDefensiveRoles(
  playerPos: PlayerState[],
  defendingHome: boolean,
  ballNX: number,
  ballNY: number,
  activePlayerIndices?: ReadonlySet<number>,
): DefensiveRoles {
  const offset = defendingHome ? 0 : 11;
  const candidates = BASE_FORMATION
    .map((slot, slotIndex) => ({ slot, index: offset + slotIndex }))
    .filter(candidate => candidate.slot.role !== 'GK' && (!activePlayerIndices || activePlayerIndices.has(candidate.index)));
  const byBall = [...candidates].sort((a, b) =>
    (dist(playerPos[a.index].x, playerPos[a.index].y, ballNX, ballNY) - playerPos[a.index].sprintT * 0.08)
    - (dist(playerPos[b.index].x, playerPos[b.index].y, ballNX, ballNY) - playerPos[b.index].sprintT * 0.08)
  );
  const presserIndex = byBall[0].index;
  const ownGoalX = defendingHome ? 0.03 : 0.97;
  const coverX = lerp(ballNX, ownGoalX, 0.22);
  const cover = byBall.slice(1).sort((a, b) =>
    dist(playerPos[a.index].x, playerPos[a.index].y, coverX, ballNY)
    - dist(playerPos[b.index].x, playerPos[b.index].y, coverX, ballNY)
  )[0];
  return { presserIndex, coverIndex: cover.index };
}

/**
 * Compute ball pixel position + arc lift + spin delta for the current frame.
 * Pure: same input → same output. Caller accumulates spin onto its own ref.
 */
export function computeBallPosition(input: BallComputeInput): BallComputeResult {
  const {
    passing, phaseFrame, duration, arc, source, target, frame,
    flightKind = 'pass', releaseDelayFrames = 0, swerve = 0,
  } = input;
  if (passing) {
    const flightDuration = Math.max(1, duration - releaseDelayFrames);
    const t = clamp((phaseFrame - releaseDelayFrames) / flightDuration, 0, 1);
    // Ground passes leave the foot crisply and lose a little pace. Lofted
    // passes and shots keep a near-linear horizontal path.
    const rollBias = flightKind === 'pass' ? 0.12 * (1 - arc) : 0;
    const eased = clamp(t + Math.sin(t * Math.PI) * rollBias, 0, 1);
    const bx = lerp(source.x, target.x, eased);
    const by = lerp(source.y, target.y, eased)
      + (flightKind === 'shot' ? Math.sin(t * Math.PI) * swerve * 9 : 0);
    const arcLift = Math.sin(t * Math.PI) * arc * 22;
    const spinDelta = 0.4 + arc * 0.3;
    return { bx, by, arcLift, spinDelta };
  }
  // Holding — ball gently drifts near holder, with foot tap micro-motion
  const microJ = Math.sin(frame * 0.18) * 0.5;
  const bx = target.x + microJ;
  const by = target.y + Math.cos(frame * 0.18) * 0.3;
  return { bx, by, arcLift: 0, spinDelta: 0.05 };
}

export interface PostShotBallInput {
  outcome: 'save' | 'block' | 'miss';
  target: { x: number; y: number };
  attackingHome: boolean;
  progress: number;
  seed: number;
}

/**
 * Visual-only second-ball motion after the authoritative shot result lands.
 * Saves spill a short distance, blocks ricochet wider, and misses retain their
 * momentum beyond the post. The match result and restart source stay unchanged.
 */
export function computePostShotBallPosition(input: PostShotBallInput): BallComputeResult {
  const progress = clamp(input.progress, 0, 1);
  const travel = 1 - (1 - progress) * (1 - progress);
  const attackDirection = input.attackingHome ? 1 : -1;
  const sideDirection = seededRand(input.seed + 211) < 0.5 ? -1 : 1;
  const distance = input.outcome === 'block' ? 34 : input.outcome === 'save' ? 18 : 16;
  const lateral = input.outcome === 'block' ? 24 : input.outcome === 'save' ? 8 : 13;
  const fieldDirection = input.outcome === 'miss' ? attackDirection : -attackDirection;
  const lift = input.outcome === 'block' ? 7 : input.outcome === 'save' ? 4 : 2;
  return {
    bx: input.target.x + fieldDirection * distance * travel,
    by: input.target.y + sideDirection * lateral * travel,
    arcLift: Math.sin(progress * Math.PI) * lift,
    spinDelta: 0.5 + (1 - progress) * 0.35,
  };
}

export function computeCarryTarget(
  baseTarget: { x: number; y: number },
  attackingHome: boolean,
  progress: number,
  maxAdvance: number,
): { x: number; y: number } {
  const t = clamp(progress, 0, 1);
  const eased = 1 - (1 - t) * (1 - t);
  return {
    x: clamp(baseTarget.x + (attackingHome ? 1 : -1) * maxAdvance * eased, 0.03, 0.97),
    y: clamp(baseTarget.y, 0.05, 0.95),
  };
}

/**
 * Resolve the pixel-coord source point + the receiver-direction unit-ish
 * vector for a phase. Used at every "new phase begins" transition.
 */
export function resolvePhasePoints(
  phase: PassPhase,
  shift: number,
  P: number, fw: number, fh: number,
): { source: { x: number; y: number }; dx: number; dy: number } {
  const passerSlot = getBaseSlot(phase.passerIdx, phase.attackingHome, shift);
  const recvSlot = phase.targetOverride ?? getBaseSlot(phase.receiverIdx, phase.attackingHome, shift);
  const sourceSlot = phase.sourceOverride ?? passerSlot;
  const source = { x: P + sourceSlot.x * fw, y: P + sourceSlot.y * fh };
  return { source, dx: recvSlot.x - passerSlot.x, dy: recvSlot.y - passerSlot.y };
}

/**
 * Tactical AI: update all 22 players' smoothed positions toward their
 * desired tactical slot. Mutates `playerPos` in place.
 *
 * `overrideTarget` (when non-null) must be in normalized (0-1) coords.
 * It pulls forwards toward a goal-mouth attack on goal/penalty events.
 */
export function updatePlayerPositions(
  playerPos: PlayerState[],
  ballNX: number,
  ballNY: number,
  ballHolderTeamSide: 'home' | 'away',
  ballHolderIdx: number,
  currentPhase: PassPhase,
  phaseState: 'passing' | 'holding' | 'shooting',
  overrideTarget: { x: number; y: number } | null,
  shift: number,
  defensiveAction?: { playerIndex: number; target: { x: number; y: number } },
  activePlayerIndices?: ReadonlySet<number>,
  phaseProgress = 0,
): void {
  const isAttHome = currentPhase.attackingHome;
  const defensiveRoles = selectDefensiveRoles(playerPos, !isAttHome, ballNX, ballNY, activePlayerIndices);
  for (let i = 0; i < 22; i++) {
    const isHomeTeam = i < 11;
    const formIdx = i % 11;
    const isHolder = (isHomeTeam ? ballHolderTeamSide === 'home' : ballHolderTeamSide === 'away') && formIdx === ballHolderIdx;
    const isReceiver = (isHomeTeam ? ballHolderTeamSide === 'home' : ballHolderTeamSide === 'away')
      && formIdx === currentPhase.receiverIdx
      && phaseState === 'passing';
    const teamHasBall = (isHomeTeam && isAttHome) || (!isHomeTeam && !isAttHome);

    const slot = getBaseSlot(formIdx, isHomeTeam, shift);
    let targetX_n = slot.x;
    let targetY_n = slot.y;

    // ── Tactical adjustments ──
    if (isHolder) {
      if (phaseState === 'holding') {
        if (currentPhase.kind === 'shot') {
          const releasePoint = currentPhase.sourceOverride ?? slot;
          targetX_n = releasePoint.x;
          targetY_n = releasePoint.y;
        } else {
          targetX_n = ballNX;
          targetY_n = ballNY + 0.01;
        }
      } else if (currentPhase.sourceOverride) {
        // Once the pass or shot leaves the foot, the player stays near the
        // release point instead of unrealistically chasing the flying ball.
        targetX_n = currentPhase.sourceOverride.x;
        targetY_n = currentPhase.sourceOverride.y;
      }
    } else if (isReceiver) {
      // Commit to the destination instead of chasing the moving ball back
      // toward the passer. Directed chances therefore produce a real run.
      const destination = currentPhase.targetOverride
        ?? getBaseSlot(currentPhase.receiverIdx, isHomeTeam, shift);
      targetX_n = destination.x;
      targetY_n = destination.y;
      playerPos[i].sprintT = Math.max(playerPos[i].sprintT, 0.7);
    } else if (teamHasBall) {
      // Possession shape: the ball-side full-back overlaps, midfielders form
      // a support triangle, and the front line stretches depth and width.
      const attackDir = isHomeTeam ? 1 : -1;
      const attackProgress = isHomeTeam ? ballNX : 1 - ballNX;
      const laneSide = slot.y < 0.5 ? -1 : slot.y > 0.5 ? 1 : 0;
      const advance = 0.035 + (slot.role === 'FW' ? 0.06 : slot.role === 'MF' ? 0.035 : slot.role === 'DF' ? 0.015 : 0);
      targetX_n = slot.x + advance * attackDir;
      if (slot.role === 'DF' && (formIdx === 1 || formIdx === 4)) {
        const sameFlank = (slot.y < 0.5) === (ballNY < 0.5);
        if (sameFlank) {
          targetX_n += (0.025 + attackProgress * 0.045) * attackDir;
          targetY_n = lerp(slot.y, ballNY, 0.18);
        }
      } else if (slot.role === 'MF') {
        const supportDepth = formIdx === 6 ? 0.1 : 0.065;
        const supportX = ballNX - attackDir * supportDepth;
        const supportY = laneSide === 0
          ? lerp(0.5, ballNY, 0.42)
          : clamp(ballNY + laneSide * 0.13, 0.12, 0.88);
        targetX_n = lerp(targetX_n, supportX, 0.44);
        targetY_n = lerp(slot.y, supportY, 0.48);
      } else if (slot.role === 'FW') {
        const runDepth = formIdx === 9 ? 0.13 : 0.1;
        const runX = ballNX + attackDir * (runDepth + attackProgress * 0.035);
        const runY = formIdx === 9
          ? lerp(0.5, ballNY, 0.3)
          : clamp(ballNY + laneSide * 0.2, 0.1, 0.9);
        targetX_n = lerp(targetX_n, runX, 0.58);
        targetY_n = lerp(slot.y, runY, 0.48);
        if (phaseState === 'passing') playerPos[i].sprintT = Math.max(playerPos[i].sprintT, 0.35);
      }
      if (Math.abs(slot.y - 0.5) > 0.25 && slot.role !== 'FW') {
        const ballSide = ballNY < 0.5 ? -1 : 1;
        const slotSide = slot.y < 0.5 ? -1 : 1;
        if (ballSide !== slotSide) {
          targetY_n = slot.y + (0.5 - slot.y) * 0.15;
        }
      }
    } else {
      // One player presses, a second protects the route to goal, and the
      // remaining block shifts together instead of swarming the ball.
      const passDestination = currentPhase.targetOverride
        ?? getBaseSlot(currentPhase.receiverIdx, isAttHome, shift);
      const pressureX = phaseState === 'passing' && currentPhase.kind === 'pass' ? passDestination.x : ballNX;
      const pressureY = phaseState === 'passing' && currentPhase.kind === 'pass' ? passDestination.y : ballNY;
      if (i === defensiveRoles.presserIndex) {
        const ownGoalX = isHomeTeam ? 0.03 : 0.97;
        const pressureGap = ownGoalX < pressureX ? -0.025 : 0.025;
        targetX_n = lerp(playerPos[i].x, pressureX + pressureGap, 0.72);
        targetY_n = lerp(playerPos[i].y, pressureY, 0.72);
        playerPos[i].sprintT = 1;
      } else if (i === defensiveRoles.coverIndex) {
        const ownGoalX = isHomeTeam ? 0.03 : 0.97;
        targetX_n = lerp(ballNX, ownGoalX, 0.2);
        targetY_n = lerp(ballNY, 0.5, 0.12);
        playerPos[i].sprintT = Math.max(playerPos[i].sprintT, 0.55);
      } else if (slot.role !== 'GK') {
        const lateralPull = slot.role === 'DF' ? 0.16 : 0.12;
        targetY_n = lerp(slot.y, ballNY, lateralPull);
        const ownGoalX = isHomeTeam ? 0.03 : 0.97;
        const layer = slot.role === 'DF' ? 0.38 : slot.role === 'MF' ? 0.2 : 0.1;
        const threatLineX = lerp(ballNX, ownGoalX, layer);
        const ownHalf = isHomeTeam ? ballNX < 0.5 : ballNX > 0.5;
        targetX_n = lerp(slot.x, threatLineX, ownHalf ? 0.68 : 0.36);

        const markingTargetIndex = selectMarkingTarget(
          playerPos,
          i,
          isHomeTeam,
          activePlayerIndices,
        );
        const markingTarget = markingTargetIndex === undefined ? undefined : playerPos[markingTargetIndex];
        const defendingDanger = isHomeTeam ? ballNX < 0.62 : ballNX > 0.38;
        if (markingTarget && defendingDanger && (slot.role === 'DF' || slot.role === 'MF')) {
          const goalSideGap = slot.role === 'DF' ? 0.038 : 0.06;
          const markX = markingTarget.x + (isHomeTeam ? -goalSideGap : goalSideGap);
          const markY = lerp(markingTarget.y, ballNY, slot.role === 'DF' ? 0.1 : 0.16);
          const markingWeight = slot.role === 'DF' ? 0.7 : 0.48;
          targetX_n = lerp(targetX_n, markX, markingWeight);
          targetY_n = lerp(targetY_n, markY, markingWeight);
        }
      }
      // The goalkeeper narrows the angle as the ball enters the final third,
      // while still protecting the goal line on distant possession.
      if (slot.role === 'GK') {
        targetY_n = clamp(0.5 + (ballNY - 0.5) * 0.3, 0.42, 0.58);
        const ownGoalX = isHomeTeam ? 0.03 : 0.97;
        const threatDistance = Math.abs(ballNX - ownGoalX);
        const stepOut = clamp((0.42 - threatDistance) * 0.16, 0, 0.055);
        targetX_n = slot.x + (isHomeTeam ? stepOut : -stepOut);
      }
    }

    // Shot scene — supporting forwards attack stable lanes around the target.
    if (overrideTarget && teamHasBall && slot.role === 'FW' && !isHolder) {
      const laneSeed = (i + 1) * 97 + Math.round(overrideTarget.x * 1000) + Math.round(overrideTarget.y * 1000);
      const supportDepth = 0.08 + seededRand(laneSeed) * 0.07;
      targetX_n = overrideTarget.x + (isHomeTeam ? -supportDepth : supportDepth);
      targetY_n = overrideTarget.y + (seededRand(laneSeed + 1) - 0.5) * 0.18;
    }

    if (defensiveAction?.playerIndex === i && overrideTarget && phaseState !== 'holding') {
      const reaction = clamp((phaseProgress - 0.18) / 0.62, 0, 1);
      const actionX = defensiveAction.target.x + (isHomeTeam ? 0.012 : -0.012);
      targetX_n = lerp(targetX_n, actionX, reaction);
      targetY_n = lerp(targetY_n, defensiveAction.target.y, reaction);
      playerPos[i].sprintT = Math.max(playerPos[i].sprintT, reaction);
    }

    targetX_n = clamp(targetX_n, 0.03, 0.97);
    targetY_n = clamp(targetY_n, 0.05, 0.95);

    // Smooth approach — sprinters accelerate faster
    const p = playerPos[i];
    const sprintBoost = 1 + p.sprintT * 0.6;
    const ax = (targetX_n - p.x) * 0.06 * sprintBoost;
    const ay = (targetY_n - p.y) * 0.06 * sprintBoost;
    p.vx = p.vx * 0.7 + ax;
    p.vy = p.vy * 0.7 + ay;
    p.x += p.vx;
    p.y += p.vy;
    if (isHolder && phaseState !== 'holding' && currentPhase.sourceOverride) {
      p.x = clamp(p.x, currentPhase.sourceOverride.x - 0.025, currentPhase.sourceOverride.x + 0.025);
      p.y = clamp(p.y, currentPhase.sourceOverride.y - 0.025, currentPhase.sourceOverride.y + 0.025);
    }
    p.sprintT *= 0.95; // sprint decays
  }
}

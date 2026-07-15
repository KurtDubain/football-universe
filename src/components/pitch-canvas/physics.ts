// Pure ball + player position math. No canvas, no refs.
// Operates entirely in normalized (0-1) field coordinates.

import { clamp, dist, easeInOutQuad, lerp, seededRand } from './math';
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
}

export interface BallComputeResult {
  bx: number;
  by: number;
  arcLift: number;             // pixels the ball lifts above ground
  spinDelta: number;           // amount to add to ball spin this frame
}

/**
 * Compute ball pixel position + arc lift + spin delta for the current frame.
 * Pure: same input → same output. Caller accumulates spin onto its own ref.
 */
export function computeBallPosition(input: BallComputeInput): BallComputeResult {
  const { passing, phaseFrame, duration, arc, source, target, frame } = input;
  if (passing) {
    const t = Math.min(1, phaseFrame / duration);
    const eased = easeInOutQuad(t);
    const bx = lerp(source.x, target.x, eased);
    let by = lerp(source.y, target.y, eased);
    const arcLift = Math.sin(t * Math.PI) * arc * 22;
    by -= arcLift;
    const spinDelta = 0.4 + arc * 0.3;
    return { bx, by, arcLift, spinDelta };
  }
  // Holding — ball gently drifts near holder, with foot tap micro-motion
  const microJ = Math.sin(frame * 0.18) * 0.5;
  const bx = target.x + microJ;
  const by = target.y + Math.cos(frame * 0.18) * 0.3;
  return { bx, by, arcLift: 0, spinDelta: 0.05 };
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
  const recvSlot = getBaseSlot(phase.receiverIdx, phase.attackingHome, shift);
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
): void {
  const isAttHome = currentPhase.attackingHome;
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
      // Ball holder moves slightly with ball
      targetX_n = ballNX;
      targetY_n = ballNY + 0.01;
    } else if (isReceiver) {
      // Receiver runs to meet incoming pass — move toward where ball will be
      const meetingT = 0.7;
      targetX_n = lerp(slot.x, ballNX, meetingT);
      targetY_n = lerp(slot.y, ballNY, meetingT);
    } else if (teamHasBall) {
      // Team in possession: shift toward attacking direction
      const attackDir = isHomeTeam ? 1 : -1;
      const advance = 0.04 + (slot.role === 'FW' ? 0.05 : slot.role === 'MF' ? 0.03 : slot.role === 'DF' ? 0.015 : 0);
      targetX_n = slot.x + advance * attackDir;
      // Wide players adjust based on ball lateral position
      if (Math.abs(slot.y - 0.5) > 0.25) {
        // Slight pinch toward middle if ball is central
        const ballSide = ballNY < 0.5 ? -1 : 1;
        const slotSide = slot.y < 0.5 ? -1 : 1;
        if (ballSide !== slotSide) {
          targetY_n = slot.y + (0.5 - slot.y) * 0.15; // pinch in
        }
      }
    } else {
      // Defending team: closest 2 defenders pressure ball, others compress toward ball side
      const defenderDist = dist(slot.x, slot.y, ballNX, ballNY);
      if (defenderDist < 0.18 && slot.role !== 'GK') {
        // Press ball — move toward holder
        const pressT = 0.55;
        targetX_n = lerp(slot.x, ballNX, pressT);
        targetY_n = lerp(slot.y, ballNY, pressT);
        playerPos[i].sprintT = 1;
      } else if (slot.role !== 'GK') {
        // Compress — drift slightly toward ball lateral position
        const lateralPull = 0.08;
        targetY_n = lerp(slot.y, ballNY, lateralPull);
        // Defensive line drops if ball is in own half
        const ownHalf = isHomeTeam ? ballNX < 0.5 : ballNX > 0.5;
        if (ownHalf) {
          const drop = isHomeTeam ? -0.025 : 0.025;
          targetX_n = slot.x + drop;
        }
      }
      // GK tracks ball laterally, narrow range
      if (slot.role === 'GK') {
        targetY_n = clamp(0.5 + (ballNY - 0.5) * 0.3, 0.42, 0.58);
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
      targetX_n = defensiveAction.target.x + (isHomeTeam ? 0.012 : -0.012);
      targetY_n = defensiveAction.target.y;
      playerPos[i].sprintT = 1;
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
    p.sprintT *= 0.95; // sprint decays
  }
}

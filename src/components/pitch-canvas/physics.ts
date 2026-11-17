// Pure ball + player position math. No canvas, no refs.
// Operates entirely in normalized (0-1) field coordinates.

import { clamp, dist, lerp, seededRand } from './math';
import { NORMALIZED_PITCH_SCREEN_ASPECT, playerSeparationDistance } from './geometry';
import { setPiecePlayerTarget } from './set-pieces';
import { keeperSetPosition } from './keeper-action';
import {
  BASE_FORMATION,
  type FormationSlot,
  type PassPhase,
  type PlayerState,
  type PresentationPlayPattern,
  type PresentationPlayStage,
  type Role,
} from './types';

export interface PitchFormationLayouts {
  home: FormationSlot[];
  away: FormationSlot[];
}

const DEFAULT_FORMATIONS: PitchFormationLayouts = {
  home: BASE_FORMATION,
  away: BASE_FORMATION,
};

function formationForTeam(isHomeTeam: boolean, formations: PitchFormationLayouts): FormationSlot[] {
  return isHomeTeam ? formations.home : formations.away;
}

function forwardLaneForSlot(formIdx: number, formation: FormationSlot[]): number {
  const slot = formation[formIdx] ?? BASE_FORMATION[formIdx];
  const forwardCount = formation.filter(entry => entry.role === 'FW').length;
  return forwardCount <= 1 ? 0.5 : 0.5 + (slot.y - 0.5) * 0.72;
}

/**
 * Where a player should be standing in their formation slot, given the
 * tactical shift (positive = home team pushed up, away pulled back).
 * Returns normalized coordinates clamped to a sensible range.
 */
export function getBaseSlot(
  formIdx: number,
  isHomeTeam: boolean,
  shift: number,
  formation: FormationSlot[] = BASE_FORMATION,
): { x: number; y: number; role: Role } {
  const base = formation[formIdx] ?? BASE_FORMATION[formIdx];
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
  /**
   * Unit-ish direction the carrier faces while the ball sits at their feet,
   * in pixel space. Drives the touch cycle in the holding branch so the ball
   * rolls out in front of the player instead of jittering in place.
   */
  holdFacing?: { dx: number; dy: number };
}

export interface BallComputeResult {
  bx: number;
  by: number;
  arcLift: number;             // pixels the ball lifts above ground
  spinDelta: number;           // amount to add to ball spin this frame
}

export function computeReceptionTouchOffset(
  source: { x: number; y: number },
  target: { x: number; y: number },
  progress: number,
  distance = 3.4,
): { x: number; y: number } {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return { x: 0, y: 0 };
  const touch = Math.sin(clamp(progress, 0, 1) * Math.PI) * distance;
  return { x: dx / length * touch, y: dy / length * touch };
}

export function computeDefensiveReactionProgress(
  stage: PresentationPlayStage | undefined,
  phaseState: 'passing' | 'holding' | 'shooting',
  phaseProgress: number,
): number {
  if (phaseState === 'holding') return 1;
  const delay = stage === 'transition' ? 0.035
    : stage === 'finish' ? 0.055
      : stage === 'create' ? 0.075
        : stage === 'progress' ? 0.1
          : 0.13;
  return clamp((phaseProgress - delay) / 0.32, 0, 1);
}

export function defensiveReactionDelay(
  playerIndex: number,
  role: Role,
  stage: PresentationPlayStage | undefined,
): number {
  if (role === 'GK') return 0;
  const roleDelay = role === 'DF' ? 0.012 : role === 'MF' ? 0.026 : 0.042;
  const laneDelay = ((playerIndex * 7) % 5) * 0.009;
  const stageMultiplier = stage === 'transition' ? 0.55
    : stage === 'finish' ? 0.72
      : stage === 'create' ? 0.85
        : stage === 'build' ? 1.1
          : 1;
  return (roleDelay + laneDelay) * stageMultiplier;
}

export interface DefensiveRoles {
  presserIndex: number;
  coverIndex: number;
}

export interface TacticalAssignments extends DefensiveRoles {
  defendingHome: boolean;
  markingTargets: Readonly<Record<number, number>>;
}

export interface DirectedDefensiveAction {
  playerIndex: number;
  target: { x: number; y: number };
}

/**
 * Resolve only presentation-level overlaps after tactical movement. Pinned
 * actors keep their authoritative ball/event positions while nearby players
 * yield just enough space for the top-down silhouettes to remain legible.
 */
export function separateActivePlayers(
  playerPos: PlayerState[],
  activePlayerIndices: ReadonlySet<number>,
  pinnedPlayerIndices: ReadonlySet<number> = new Set<number>(),
  minimumScreenDistance = playerSeparationDistance(),
): void {
  const indices = [...activePlayerIndices].filter(index => playerPos[index] !== undefined);
  const pitchAspect = NORMALIZED_PITCH_SCREEN_ASPECT;

  // Four relaxation passes rather than two. A released shot drives ten
  // defenders toward the same band, and two passes could not untangle a
  // cluster that dense, so the pile-up survived all the way to the screen.
  for (let iteration = 0; iteration < 4; iteration++) {
    for (let firstIndex = 0; firstIndex < indices.length; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < indices.length; secondIndex++) {
        const aIndex = indices[firstIndex];
        const bIndex = indices[secondIndex];
        const a = playerPos[aIndex];
        const b = playerPos[bIndex];
        const aPinned = pinnedPlayerIndices.has(aIndex);
        const bPinned = pinnedPlayerIndices.has(bIndex);
        if (aPinned && bPinned) continue;

        const dx = b.x - a.x;
        const scaledDy = (b.y - a.y) * pitchAspect;
        const distance = Math.hypot(dx, scaledDy);
        if (distance >= minimumScreenDistance) continue;

        const fallbackAngle = ((aIndex * 37 + bIndex * 53) % 360) * Math.PI / 180;
        const directionX = distance > 0.00001 ? dx / distance : Math.cos(fallbackAngle);
        const directionY = distance > 0.00001 ? scaledDy / distance : Math.sin(fallbackAngle);
        const overlap = minimumScreenDistance - distance;
        const aShare = aPinned ? 0 : bPinned ? 1 : 0.5;
        const bShare = bPinned ? 0 : aPinned ? 1 : 0.5;

        a.x = clamp(a.x - directionX * overlap * aShare, 0.03, 0.97);
        a.y = clamp(a.y - directionY * overlap * aShare / pitchAspect, 0.05, 0.95);
        b.x = clamp(b.x + directionX * overlap * bShare, 0.03, 0.97);
        b.y = clamp(b.y + directionY * overlap * bShare / pitchAspect, 0.05, 0.95);
      }
    }
  }
}

export function selectMarkingTarget(
  playerPos: PlayerState[],
  markerIndex: number,
  defendingHome: boolean,
  activePlayerIndices?: ReadonlySet<number>,
  formations: PitchFormationLayouts = DEFAULT_FORMATIONS,
): number | undefined {
  const defendingOffset = defendingHome ? 0 : 11;
  const attackingOffset = defendingHome ? 11 : 0;
  const markerSlot = markerIndex - defendingOffset;
  const defendingFormation = formationForTeam(defendingHome, formations);
  const attackingFormation = formationForTeam(!defendingHome, formations);
  const markerRole = defendingFormation[markerSlot]?.role;
  if (markerRole !== 'DF' && markerRole !== 'MF') return undefined;

  const markers = defendingFormation
    .map((slot, slotIndex) => ({ slot, index: defendingOffset + slotIndex }))
    .filter(candidate => (
      (candidate.slot.role === 'DF' || candidate.slot.role === 'MF')
      && (!activePlayerIndices || activePlayerIndices.has(candidate.index))
    ))
    .sort((a, b) => a.slot.y - b.slot.y);
  const threats = attackingFormation
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
  formations: PitchFormationLayouts = DEFAULT_FORMATIONS,
): DefensiveRoles {
  const offset = defendingHome ? 0 : 11;
  const candidates = formationForTeam(defendingHome, formations)
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

export function buildTacticalAssignments(
  playerPos: PlayerState[],
  defendingHome: boolean,
  pressureX: number,
  pressureY: number,
  activePlayerIndices?: ReadonlySet<number>,
  formations: PitchFormationLayouts = DEFAULT_FORMATIONS,
): TacticalAssignments {
  const roles = selectDefensiveRoles(playerPos, defendingHome, pressureX, pressureY, activePlayerIndices, formations);
  const offset = defendingHome ? 0 : 11;
  const markingTargets: Record<number, number> = {};
  const defendingFormation = formationForTeam(defendingHome, formations);
  for (let slotIndex = 0; slotIndex < defendingFormation.length; slotIndex++) {
    if (defendingFormation[slotIndex].role !== 'DF' && defendingFormation[slotIndex].role !== 'MF') continue;
    const playerIndex = offset + slotIndex;
    if (activePlayerIndices && !activePlayerIndices.has(playerIndex)) continue;
    const target = selectMarkingTarget(playerPos, playerIndex, defendingHome, activePlayerIndices, formations);
    if (target !== undefined) markingTargets[playerIndex] = target;
  }
  return { ...roles, defendingHome, markingTargets };
}

/**
 * Compute ball pixel position + arc lift + spin delta for the current frame.
 * Pure: same input → same output. Caller accumulates spin onto its own ref.
 */
/**
 * Per-frame decay of a ball height carried across a sequence swap.
 *
 * A pass cut out at the top of its arc used to drop to the grass in a single
 * frame, because the sequence replacing it starts with the ball at the
 * interceptor's feet and no lift of its own. That one-frame drop was the most
 * visible cut in a match, and it landed on the turnovers the viewer is watching.
 */
export const LIFT_CARRY_DECAY = 0.86;

/** Below this a carried height is gone and the ball is simply on the grass. */
export const LIFT_CARRY_FLOOR = 0.4;

/**
 * One frame of carried height: what to draw now, and what is left for next frame.
 *
 * 0.86 a frame settles a ball cut out at the top of a long pass in about a
 * third of a second, which reads as the ball coming down rather than as a cut.
 */
export function decayBallLiftCarry(carry: number): { applied: number; remaining: number } {
  if (!Number.isFinite(carry) || carry <= LIFT_CARRY_FLOOR) return { applied: 0, remaining: 0 };
  return { applied: carry, remaining: carry * LIFT_CARRY_DECAY };
}

export function computeBallPosition(input: BallComputeInput): BallComputeResult {
  const {
    passing, phaseFrame, duration, arc, source, target, frame,
    flightKind = 'pass', releaseDelayFrames = 0, swerve = 0, holdFacing,
  } = input;
  if (passing && phaseFrame > releaseDelayFrames) {
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
  // Holding, and the run-up before a dead ball is struck. Both keep the ball
  // alive at the taker's feet.
  //
  // The previous branch moved it by `sin(frame * 0.18) * 0.5` pixels, which is
  // roughly a seventh of the drawn ball radius: mathematically in motion,
  // visually frozen. Worse, a set piece never reached this branch at all —
  // `t` clamps to 0 for the whole run-up, so a corner parked the ball for 70
  // frames (1.17 s) and a direct free kick for 84. Those were the single
  // longest frozen stretches in a match.
  const anchor = passing ? source : target;
  const facingX = holdFacing?.dx ?? 1;
  const facingY = holdFacing?.dy ?? 0;
  const facingLength = Math.hypot(facingX, facingY);
  const dirX = facingLength > 0.0001 ? facingX / facingLength : 1;
  const dirY = facingLength > 0.0001 ? facingY / facingLength : 0;
  const touchCycle = (frame * 0.045) % 1;
  const reach = Math.sin(touchCycle * Math.PI) * 3.4;
  const lateral = Math.sin(touchCycle * Math.PI * 2) * 1.2;
  const bx = anchor.x + dirX * reach - dirY * lateral;
  const by = anchor.y + dirY * reach + dirX * lateral;
  return { bx, by, arcLift: 0, spinDelta: 0.05 + reach * 0.02 };
}

export interface PostShotBallInput {
  outcome: 'save' | 'block' | 'miss';
  target: { x: number; y: number };
  attackingHome: boolean;
  progress: number;
  seed: number;
  held?: boolean;
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
  if (input.outcome === 'save' && input.held) {
    return {
      bx: input.target.x - attackDirection * 3 * travel,
      by: input.target.y + Math.sin(progress * Math.PI) * 1.5,
      arcLift: Math.sin(progress * Math.PI) * 1.5,
      spinDelta: 0.16 * (1 - progress),
    };
  }
  const sideDirection = seededRand(input.seed + 211) < 0.5 ? -1 : 1;
  // A miss keeps travelling across the face of goal rather than straight on.
  // Sending it further downfield parked the ball roughly 5 m outside the pitch
  // in the dark surround, where it sat until the next phase began. The goal
  // line sits at 510 with only 10 px of surround before the canvas edge, so a
  // miss that already aims past the post can barely advance at all without the
  // ball being clipped off-canvas; nearly all of its residual motion is lateral.
  const distance = input.outcome === 'block' ? 34 : input.outcome === 'save' ? 18 : 2;
  const lateral = input.outcome === 'block' ? 24 : input.outcome === 'save' ? 8 : 20;
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

export interface AttackingShapeInput {
  formIdx: number;
  isHomeTeam: boolean;
  shift: number;
  ballNX: number;
  ballNY: number;
  pattern: PresentationPlayPattern;
  stage?: PresentationPlayStage;
  formation?: FormationSlot[];
}

export interface AttackingShapeTarget {
  x: number;
  y: number;
  sprint: number;
}

/**
 * Off-ball shape for one coherent possession episode. Each pattern names a
 * small set of runners and leaves the rest of the team in supporting or
 * rest-defence positions, avoiding whole-team movement toward every touch.
 */
export function computeAttackingShapeTarget(input: AttackingShapeInput): AttackingShapeTarget {
  const { formIdx, isHomeTeam, shift, ballNX, ballNY, pattern, stage } = input;
  const formation = input.formation ?? BASE_FORMATION;
  const slot = getBaseSlot(formIdx, isHomeTeam, shift, formation);
  const attackDirection = isHomeTeam ? 1 : -1;
  // Off-ball runs stop short of the goal line. The authoritative shooter can
  // still enter the event's exact release point, while supporting runners do
  // not drag an entire marking block into the six-yard line.
  const ahead = (x: number, amount: number) => clamp(x + attackDirection * amount, 0.075, 0.925);
  const behind = (x: number, amount: number) => x - attackDirection * amount;
  const upperSide = ballNY < 0.5;
  const slotUpper = slot.y < 0.5;
  const sameFlank = slot.y !== 0.5 && slotUpper === upperSide;
  const wideY = upperSide ? 0.13 : 0.87;
  const farWideY = upperSide ? 0.87 : 0.13;
  const isFullback = slot.role === 'DF' && Math.abs(slot.y - 0.5) >= 0.28;
  const isWideMidfielder = slot.role === 'MF' && Math.abs(slot.y - 0.5) >= 0.22;
  const isWinger = slot.role === 'FW' && Math.abs(slot.y - 0.5) >= 0.2;
  const isCentralMidfielder = slot.role === 'MF' && Math.abs(slot.y - 0.5) < 0.14;
  const isCentralForward = slot.role === 'FW' && Math.abs(slot.y - 0.5) < 0.18;
  const midfieldSlots = formation.filter(entry => entry.role === 'MF');
  const midfieldDepthRange = midfieldSlots.length > 0
    ? Math.max(...midfieldSlots.map(entry => entry.x)) - Math.min(...midfieldSlots.map(entry => entry.x))
    : 0;
  const isHoldingMidfielder = slot.role === 'MF'
    && slot.x <= Math.min(...midfieldSlots.map(entry => entry.x)) + 0.025;
  const isAdvancedMidfielder = slot.role === 'MF'
    && midfieldDepthRange >= 0.055
    && slot.x >= Math.max(...midfieldSlots.map(entry => entry.x)) - 0.025;
  const forwardLaneY = forwardLaneForSlot(formIdx, formation);
  let x = slot.x;
  let y = slot.y;
  let sprint = 0;

  if (slot.role === 'GK') {
    return {
      x: clamp(ahead(slot.x, 0.012), 0.03, 0.97),
      y: clamp(0.5 + (ballNY - 0.5) * 0.12, 0.45, 0.55),
      sprint: 0,
    };
  }

  switch (pattern) {
    case 'build_up':
      if (slot.role === 'DF') {
        x = ahead(slot.x, isFullback ? 0.035 : 0.008);
        y = isFullback ? (slotUpper ? 0.11 : 0.89) : lerp(slot.y, 0.5, 0.08);
      } else if (slot.role === 'MF') {
        x = isAdvancedMidfielder
          ? behind(ballNX, 0.025)
          : isHoldingMidfielder ? behind(ballNX, 0.12) : behind(ballNX, 0.055);
        y = isCentralMidfielder ? lerp(0.5, ballNY, 0.12) : lerp(slot.y, ballNY, 0.22);
      } else {
        x = ahead(ballNX, isCentralForward ? 0.16 : 0.11);
        y = isWinger ? (slotUpper ? 0.12 : 0.88) : forwardLaneY;
      }
      break;

    case 'wing_overload':
      if (isFullback && sameFlank) {
        x = ahead(ballNX, 0.07);
        y = wideY;
        sprint = 0.78;
      } else if (isWideMidfielder && sameFlank) {
        x = isAdvancedMidfielder ? ahead(ballNX, 0.025) : behind(ballNX, 0.075);
        y = lerp(wideY, 0.5, 0.34);
      } else if (isWinger && sameFlank) {
        x = ahead(ballNX, 0.11);
        y = lerp(wideY, 0.5, 0.14);
        sprint = 0.68;
      } else if (isCentralForward) {
        x = ahead(ballNX, 0.13);
        y = forwardLaneY;
        sprint = stage === 'create' ? 0.72 : 0.35;
      } else if (isWinger) {
        x = ahead(ballNX, 0.1);
        y = farWideY;
      } else if (slot.role === 'DF') {
        x = behind(ballNX, 0.2);
        y = lerp(slot.y, 0.5, 0.08);
      }
      break;

    case 'central_combination':
      if (isFullback) {
        x = behind(ballNX, 0.02);
        y = slotUpper ? 0.1 : 0.9;
      } else if (slot.role === 'MF') {
        const side = slot.y < 0.43 ? -1 : slot.y > 0.57 ? 1 : 0;
        x = isAdvancedMidfielder
          ? ahead(ballNX, 0.035)
          : isHoldingMidfielder ? behind(ballNX, 0.12) : behind(ballNX, 0.045);
        y = isCentralMidfielder ? lerp(0.5, ballNY, 0.2) : 0.5 + side * 0.13;
      } else if (isCentralForward) {
        x = ahead(ballNX, 0.12);
        y = forwardLaneY;
        sprint = stage === 'create' ? 0.72 : 0.38;
      } else if (isWinger) {
        x = ahead(ballNX, 0.07);
        y = lerp(slot.y, 0.5, 0.14);
      } else if (slot.role === 'DF') {
        x = behind(ballNX, 0.22);
      }
      break;

    case 'switch_play':
      if ((isFullback || isWinger) && !sameFlank) {
        x = ahead(ballNX, isWinger ? 0.12 : 0.045);
        y = farWideY;
        sprint = isWinger ? 0.62 : 0.34;
      } else if (slot.role === 'MF') {
        x = behind(ballNX, isCentralMidfielder ? 0.12 : 0.045);
        y = lerp(slot.y, farWideY, isCentralMidfielder ? 0.18 : 0.3);
      } else if (sameFlank && (isFullback || isWinger)) {
        x = behind(ballNX, isFullback ? 0.12 : 0.04);
        y = wideY;
      } else if (slot.role === 'DF') {
        x = behind(ballNX, 0.21);
      }
      break;

    case 'counter':
      if (slot.role === 'FW') {
        x = ahead(ballNX, isCentralForward ? 0.16 : 0.13);
        y = isCentralForward ? lerp(forwardLaneY, ballNY, 0.18) : lerp(slot.y, ballNY, 0.18);
        sprint = 1;
      } else if (slot.role === 'MF' && (isCentralMidfielder || sameFlank)) {
        x = behind(ballNX, isCentralMidfielder ? 0.12 : 0.045);
        y = lerp(slot.y, ballNY, 0.3);
        sprint = isCentralMidfielder ? 0.28 : 0.7;
      } else {
        x = slot.role === 'DF' ? slot.x : ahead(slot.x, 0.025);
        y = lerp(slot.y, 0.5, 0.08);
      }
      break;

    case 'recycle':
      if (slot.role === 'DF') {
        x = behind(ballNX, isFullback ? 0.13 : 0.2);
        y = isFullback ? (slotUpper ? 0.1 : 0.9) : lerp(slot.y, 0.5, 0.06);
      } else if (slot.role === 'MF') {
        x = behind(ballNX, isCentralMidfielder ? 0.13 : 0.06);
        y = isCentralMidfielder ? 0.5 : lerp(slot.y, farWideY, 0.2);
      } else {
        x = ahead(ballNX, isCentralForward ? 0.12 : 0.08);
        y = isWinger ? (slotUpper ? 0.12 : 0.88) : forwardLaneY;
      }
      break;
  }

  return {
    x: clamp(x, 0.03, 0.97),
    y: clamp(y, 0.06, 0.94),
    sprint,
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
  formation: FormationSlot[] = BASE_FORMATION,
): { source: { x: number; y: number }; dx: number; dy: number } {
  const passerSlot = getBaseSlot(phase.passerIdx, phase.attackingHome, shift, formation);
  const recvSlot = phase.targetOverride ?? getBaseSlot(phase.receiverIdx, phase.attackingHome, shift, formation);
  const sourceSlot = phase.sourceOverride ?? passerSlot;
  // No phase begins outside the pitch. A source inherited from a ball that had
  // already gone out of play used to place the next pass out in the surround.
  const source = {
    x: P + clamp(sourceSlot.x, 0.03, 0.97) * fw,
    y: P + clamp(sourceSlot.y, 0.05, 0.95) * fh,
  };
  return { source, dx: recvSlot.x - passerSlot.x, dy: recvSlot.y - passerSlot.y };
}

/**
 * How far from its target a player counts as settled, in normalized units.
 * Inside this radius the keep-alive drift fades in; outside it the player is
 * still genuinely running somewhere and the drift must not perturb the run.
 */
export const IDLE_DRIFT_RADIUS = 0.03;

/**
 * How much earlier than physics requires a player starts easing off.
 *
 * 1 is a perfect stop against the acceleration cap; higher values trade a
 * slightly longer approach for a deceleration that reads as a runner slowing
 * down rather than a marker sliding to a halt.
 */
export const BRAKE_DISTANCE_SCALE = 1.5;

/**
 * How much of a move's distance converts into pace.
 *
 * Unchanged from the controller this replaced. The gain is what makes a
 * 20 m recovery run look different from a 2 m adjustment, and that gradient
 * was already tuned against real footage — the defect was never the slope, it
 * was that the slope reached zero.
 */
export const PURSUIT_GAIN = 0.11;

/**
 * Floor under the pursuit slope, as a fraction of top speed.
 *
 * This is the whole fix for the frozen pitch. The old controller had no floor,
 * so every approach ended in a crawl and then a dead stop; measured over a
 * match 41% of player-frames were mathematically motionless. With a floor a
 * player closing the last metre still moves like a person adjusting their
 * position rather than a marker sliding into a slot.
 */
export const MIN_CRUISE_FRACTION = 0.35;

/**
 * Speed a pursuer should hold at `distance` from its target.
 *
 * The old `Math.min(maxSpeed, distance * 0.11)` was a pure proportional
 * controller: it began braking 3.2 m out and then crawled the whole way in, so
 * every player decelerated smoothly into a dead stop and stood there. Measured
 * over 744k player-frames that left the median player at 16.9% of their own top
 * speed and 41.4% of frames completely motionless.
 *
 * A braking-distance curve holds pace until the last moment and then stops
 * over a distance the player's own acceleration cap can actually deliver, so
 * the approach reads as running rather than gliding. `brakeDistance` is
 * derived from that cap at the call site, which keeps the two consistent for
 * every role and every sprint boost.
 */
export function pursuitSpeed(
  distance: number,
  maxSpeed: number,
  brakeDistance: number,
): number {
  if (distance <= 0 || maxSpeed <= 0) return 0;
  if (brakeDistance <= 0) return maxSpeed;
  return maxSpeed * Math.min(1, Math.sqrt(distance / brakeDistance));
}

/**
 * Keep-alive drift for a player who has reached their slot.
 *
 * A footballer who is not involved in the play is never mathematically still:
 * they shift their weight, check a shoulder, take a step. Without this every
 * outfield player froze the instant they arrived, which is what made the pitch
 * read as a diagram of positions rather than a match.
 *
 * Deterministic in (playerIndex, clock) so it is testable, and phase-shifted
 * per player so nobody sways in lockstep. `amplitude` is in normalized units
 * along the pitch length; the width axis is shorter in metres, so the same
 * metre distance is a larger normalized step there.
 */
export function idleDriftOffset(
  playerIndex: number,
  clock: number,
  amplitude = 0.0062,
): { x: number; y: number } {
  if (amplitude <= 0) return { x: 0, y: 0 };
  const phaseA = playerIndex * 1.73 + 0.41;
  const phaseB = playerIndex * 2.39 + 1.87;
  // Two superimposed frequencies. A single sine reads as a metronome; the
  // faster overtone is what makes the sway look like a person shifting weight
  // rather than a marker on a spring, and it is also what keeps the drift's
  // own velocity above the "visually static" floor at the turning points.
  return {
    x: (Math.sin(clock * 0.036 + phaseA) + Math.sin(clock * 0.091 + phaseB) * 0.35) * amplitude,
    y: (Math.cos(clock * 0.029 + phaseB) + Math.cos(clock * 0.083 + phaseA) * 0.35) * amplitude * 1.3,
  };
}

/**
 * Tactical AI: update all 22 players' smoothed positions toward their
 * desired tactical slot. Mutates `playerPos` in place.
 *
 * `overrideTarget` (when non-null) must be in normalized (0-1) coords.
 * It pulls forwards toward a goal-mouth attack on goal/penalty events.
 *
 * `motionClock` is the renderer's frame counter. It only drives the keep-alive
 * drift, so passing 0 (the default) reproduces the pre-drift behaviour exactly
 * and every existing caller stays valid.
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
  defensiveAction?: DirectedDefensiveAction,
  activePlayerIndices?: ReadonlySet<number>,
  phaseProgress = 0,
  tacticalAssignments?: TacticalAssignments,
  formations: PitchFormationLayouts = DEFAULT_FORMATIONS,
  motionClock = 0,
  releaseProgress = 1,
  stepScale = 1,
): void {
  const isAttHome = currentPhase.attackingHome;
  const defendingHome = !isAttHome;
  const defensiveRoles = tacticalAssignments?.defendingHome === defendingHome
    ? tacticalAssignments
    : buildTacticalAssignments(playerPos, defendingHome, ballNX, ballNY, activePlayerIndices, formations);
  for (let i = 0; i < 22; i++) {
    const isHomeTeam = i < 11;
    const formIdx = i % 11;
    const isHolder = (isHomeTeam ? ballHolderTeamSide === 'home' : ballHolderTeamSide === 'away') && formIdx === ballHolderIdx;
    const isReceiver = (isHomeTeam ? ballHolderTeamSide === 'home' : ballHolderTeamSide === 'away')
      && formIdx === currentPhase.receiverIdx
      && phaseState === 'passing';
    const teamHasBall = (isHomeTeam && isAttHome) || (!isHomeTeam && !isAttHome);

    const formation = formationForTeam(isHomeTeam, formations);
    const slot = getBaseSlot(formIdx, isHomeTeam, shift, formation);
    let targetX_n = slot.x;
    let targetY_n = slot.y;
    const setPieceTarget = setPiecePlayerTarget(
      i, isHomeTeam, slot.role, currentPhase, formation, releaseProgress,
    );

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
        ?? getBaseSlot(currentPhase.receiverIdx, isHomeTeam, shift, formation);
      targetX_n = destination.x;
      targetY_n = destination.y;
      playerPos[i].sprintT = Math.max(playerPos[i].sprintT, 0.7);
    } else if (setPieceTarget) {
      targetX_n = setPieceTarget.x;
      targetY_n = setPieceTarget.y;
    } else if (teamHasBall) {
      // The creator makes the run the chance needs. They receive nothing
      // during the build-up by design, so without this they hold their
      // formation slot while the move goes past them and the ball has to
      // come back twenty metres to reach them.
      if (currentPhase.creatorIdx !== undefined && formIdx === currentPhase.creatorIdx) {
        const attackDir = isHomeTeam ? 1 : -1;
        targetX_n = clamp(ballNX + attackDir * 0.1, 0.1, 0.93);
        targetY_n = clamp(lerp(slot.y, 0.5, 0.3), 0.12, 0.88);
        playerPos[i].sprintT = Math.max(playerPos[i].sprintT, 0.6);
      } else if (currentPhase.pattern) {
        const shape = computeAttackingShapeTarget({
          formIdx,
          isHomeTeam,
          shift,
          ballNX,
          ballNY,
          pattern: currentPhase.pattern,
          stage: currentPhase.stage,
          formation,
        });
        targetX_n = shape.x;
        targetY_n = shape.y;
        playerPos[i].sprintT = Math.max(playerPos[i].sprintT, shape.sprint);
      } else {
        const attackDir = isHomeTeam ? 1 : -1;
        const laneSide = slot.y < 0.5 ? -1 : slot.y > 0.5 ? 1 : 0;
        const advance = 0.035 + (slot.role === 'FW' ? 0.06 : slot.role === 'MF' ? 0.035 : slot.role === 'DF' ? 0.015 : 0);
        targetX_n = slot.x + advance * attackDir;
        if (slot.role === 'MF') {
          const supportDepth = Math.abs(slot.y - 0.5) < 0.14 ? 0.1 : 0.065;
          targetX_n = lerp(targetX_n, ballNX - attackDir * supportDepth, 0.44);
          targetY_n = lerp(slot.y, laneSide === 0 ? 0.5 : ballNY + laneSide * 0.13, 0.48);
        } else if (slot.role === 'FW') {
          const centralForward = Math.abs(slot.y - 0.5) < 0.18;
          targetX_n = lerp(targetX_n, ballNX + attackDir * (centralForward ? 0.13 : 0.1), 0.58);
          targetY_n = lerp(slot.y, centralForward ? 0.5 : ballNY + laneSide * 0.2, 0.48);
        }
      }
    } else {
      // One player presses, a second protects the route to goal, and the
      // remaining block shifts together instead of swarming the ball.
      const passDestination = currentPhase.targetOverride
        ?? getBaseSlot(
          currentPhase.receiverIdx,
          isAttHome,
          shift,
          formationForTeam(isAttHome, formations),
        );
      const pressureX = phaseState === 'passing' && currentPhase.kind === 'pass' ? passDestination.x : ballNX;
      const pressureY = phaseState === 'passing' && currentPhase.kind === 'pass' ? passDestination.y : ballNY;
      const defendingReleasedShot = currentPhase.kind === 'shot' && phaseState !== 'holding' && slot.role !== 'GK';
      if (defendingReleasedShot) {
        // A released shot pulls the block back, but it must not flatten the
        // team onto one line.
        //
        // The previous table (DF 0.085 / MF 0.17 / FW 0.28 measured from the
        // goal line, with every lane lerped toward the centre) measured a
        // 13.7 m x-span across all eleven defenders — narrower than the penalty
        // area — with four of them within 0.003 of the same x. That is a wall,
        // not a defence: no layers, no width, and no counter-attack outlet.
        //
        // Three depths with each role holding its own band, and the block
        // slides toward the ball's flank instead of collapsing through the
        // middle. Forwards stay near halfway; they are the outlet, not cover.
        const ownGoalX = isHomeTeam ? 0.03 : 0.97;
        const lineDepth = slot.role === 'DF' ? 0.105 : slot.role === 'MF' ? 0.255 : 0.42;
        targetX_n = ownGoalX + (isHomeTeam ? lineDepth : -lineDepth);
        const flankPull = slot.role === 'DF' ? 0.3 : slot.role === 'MF' ? 0.2 : 0.08;
        targetY_n = clamp(lerp(slot.y, ballNY, flankPull), 0.12, 0.88);
      } else if (i === defensiveRoles.presserIndex) {
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

        const markingTargetIndex = tacticalAssignments?.defendingHome === isHomeTeam
          ? tacticalAssignments.markingTargets[i]
          : selectMarkingTarget(playerPos, i, isHomeTeam, activePlayerIndices, formations);
        const markingTarget = markingTargetIndex === undefined ? undefined : playerPos[markingTargetIndex];
        const defendingDanger = isHomeTeam ? ballNX < 0.62 : ballNX > 0.38;
        if (markingTarget && defendingDanger && (slot.role === 'DF' || slot.role === 'MF')) {
          const goalSideGap = slot.role === 'DF' ? 0.038 : 0.06;
          const markX = markingTarget.x + (isHomeTeam ? -goalSideGap : goalSideGap);
          const markY = lerp(markingTarget.y, ballNY, slot.role === 'DF' ? 0.1 : 0.16);
          const xMarkingWeight = slot.role === 'DF' ? 0.38 : 0.32;
          const yMarkingWeight = slot.role === 'DF' ? 0.52 : 0.4;
          targetX_n = lerp(targetX_n, markX, xMarkingWeight);
          targetY_n = lerp(targetY_n, markY, yMarkingWeight);
        }
        targetY_n = lerp(targetY_n, slot.y, slot.role === 'DF' ? 0.2 : 0.1);
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
      const supportLaneY = forwardLaneForSlot(formIdx, formation);
      targetX_n = overrideTarget.x + (isHomeTeam ? -supportDepth : supportDepth);
      const laneVariation = (seededRand(laneSeed + 1) - 0.5) * 0.045;
      targetY_n = lerp(supportLaneY, overrideTarget.y, 0.34) + laneVariation;
    }

    if (defensiveAction?.playerIndex === i) {
      if (currentPhase.kind === 'shot') {
        const reaction = phaseState === 'holding'
          ? 1
          : clamp((phaseProgress - 0.08) / 0.7, 0, 1);
        const actionX = defensiveAction.target.x + (isHomeTeam ? 0.012 : -0.012);
        targetX_n = lerp(targetX_n, actionX, reaction);
        if (slot.role === 'GK') {
          // A keeper does not slide onto the ball. They set themselves across
          // the goal while it is travelling and dive the rest of the way, and
          // that dive is drawn from where they are standing. Converging all the
          // way to the target — which is what the outfield blocker below does,
          // and rightly — left the drawn save with nothing to cover.
          targetY_n = keeperSetPosition(playerPos[i].y, defensiveAction.target.y);
        } else {
          targetY_n = lerp(targetY_n, defensiveAction.target.y, reaction);
        }
        playerPos[i].sprintT = Math.max(playerPos[i].sprintT, reaction);
      } else if (currentPhase.kind === 'pass') {
        // Event actors read the attack before the final shot. Outfield
        // blockers recover into the shooting lane, while goalkeepers only
        // shade toward the likely corner and do not dive before release.
        const preparation = currentPhase.stage === 'create'
          ? 0.9
          : currentPhase.stage === 'progress' || currentPhase.stage === 'transition'
            ? 0.6
            : 0.35;
        if (slot.role === 'GK') {
          targetY_n = lerp(targetY_n, defensiveAction.target.y, preparation * 0.32);
        } else {
          const blockingX = defensiveAction.target.x + (isHomeTeam ? 0.075 : -0.075);
          targetX_n = lerp(targetX_n, blockingX, preparation);
          targetY_n = lerp(targetY_n, defensiveAction.target.y, Math.min(1, preparation * 1.08));
          playerPos[i].sprintT = Math.max(playerPos[i].sprintT, preparation * 0.8);
        }
      }
    }

    if (!teamHasBall && defensiveAction?.playerIndex !== i && !setPieceTarget) {
      const primaryDefender = i === defensiveRoles.presserIndex || i === defensiveRoles.coverIndex;
      const recoveringReleasedShot = currentPhase.kind === 'shot'
        && phaseState !== 'holding'
        && slot.role !== 'GK';
      const delayedProgress = clamp(
        phaseProgress - (primaryDefender || recoveringReleasedShot
          ? 0
          : defensiveReactionDelay(i, slot.role, currentPhase.stage)),
        0,
        1,
      );
      const reaction = computeDefensiveReactionProgress(
        currentPhase.stage,
        phaseState,
        delayedProgress,
      );
      const minimumRead = slot.role === 'GK' ? 1
        : recoveringReleasedShot ? 0.42
          : primaryDefender ? 0.2
          : slot.role === 'DF' ? 0.09
            : slot.role === 'MF' ? 0.07
              : 0.05;
      const reactionBlend = minimumRead + (1 - minimumRead) * reaction;
      targetX_n = lerp(playerPos[i].x, targetX_n, reactionBlend);
      targetY_n = lerp(playerPos[i].y, targetY_n, reactionBlend);
    }

    targetX_n = clamp(targetX_n, 0.03, 0.97);
    targetY_n = clamp(targetY_n, 0.05, 0.95);

    // Keep-alive drift. Only a player who has essentially arrived gets it, so
    // it never perturbs a real run. The carrier is excluded because they
    // already track the ball's touch cycle.
    //
    // Set-piece actors are deliberately included. An earlier pass spared them
    // on the grounds that a swaying defensive wall reads as a mistake, but that
    // left twenty outfield players frozen for the whole of a corner run-up —
    // by far the largest remaining block of motionless frames. A real wall
    // shuffles, adjusts its line and checks a shoulder; the amplitude here is
    // well under a metre, which is that and not a mistake.
    let driftActive = false;
    if (motionClock > 0 && !isHolder && !isReceiver) {
      const settleDistance = Math.hypot(targetX_n - playerPos[i].x, targetY_n - playerPos[i].y);
      if (settleDistance < IDLE_DRIFT_RADIUS) {
        const drift = idleDriftOffset(i, motionClock * stepScale);
        const blend = 1 - settleDistance / IDLE_DRIFT_RADIUS;
        targetX_n = clamp(targetX_n + drift.x * blend, 0.03, 0.97);
        targetY_n = clamp(targetY_n + drift.y * blend, 0.05, 0.95);
        driftActive = true;
      }
    }

    // Critically damped pursuit with speed and acceleration caps. Target
    // changes no longer produce overshoot or whole-team direction snapping.
    const p = playerPos[i];
    const dx = targetX_n - p.x;
    const dy = targetY_n - p.y;
    const distance = Math.hypot(dx, dy);
    const sprintBoost = 1 + p.sprintT * 0.55;
    // Urgency, not superhuman pace. These were 1.7 and 1.3, which on top of
    // the old speed table produced 63 m/s. A defender throwing themselves at a
    // block is at their own top speed, not above it.
    const directedRecoveryBoost = defensiveAction?.playerIndex === i && slot.role !== 'GK'
      ? currentPhase.kind === 'pass' ? 1.15 : 1.08
      : 1;
    // Jog pace per role, in normalized pitch-length units per 60fps frame.
    //
    // These were 0.00255-0.0038, which is 16-24 m/s: two and a half times a
    // sprinter, and six times one once the sprint and recovery boosts stack.
    // Measured over 2.0M player-frames, 36.6% of frames exceeded 11 m/s and
    // the 99th percentile was 34.5 m/s. The pitch is 105 m long, so a forward
    // crossed it in four seconds.
    //
    // A footballer jogs at 5-6 m/s and sprints at 9-10. The sprint boost below
    // supplies the difference, so these are deliberately jog values:
    // 0.00098 * 105 * 60 = 6.2 m/s for a forward, reaching 9.6 m/s at full
    // sprint. Acceleration is 4.4 m/s^2 rather than the old 174, which is why
    // a player now takes two seconds to reach top speed instead of 0.14.
    const baseMotion = slot.role === 'GK'
      ? { speed: 0.00054, acceleration: 0.0000079 }
      : slot.role === 'DF'
        ? { speed: 0.00089, acceleration: 0.0000106 }
        : slot.role === 'MF'
          ? { speed: 0.00094, acceleration: 0.0000111 }
          : { speed: 0.00098, acceleration: 0.0000116 };
    // Both are per-frame quantities, so a renderer running a 33 ms step must
    // move a player twice as far per call as one running a 16.7 ms step, or the
    // same player covers the same ground in half the wall-clock speed. The
    // rhythm counters were decoupled from the frame step in 4.71.0; without
    // this the ball would keep real time while the players around it slowed to
    // a jog, which is worse on a degraded machine than it was before.
    const roleMotion = {
      speed: baseMotion.speed * stepScale,
      acceleration: baseMotion.acceleration * stepScale,
    };
    const maxSpeed = roleMotion.speed * sprintBoost * directedRecoveryBoost;
    // Pace scales with the size of the move, exactly as it did before, but
    // never falls below a jog. The old controller was this line without the
    // floor: `Math.min(maxSpeed, distance * PURSUIT_GAIN)`. Keeping the slope
    // preserves every pace relationship the role table was tuned around — a
    // keeper's short step still reads as a keeper's short step — while the
    // floor is what removes the dead frames.
    const cruiseSpeed = clamp(
      distance * PURSUIT_GAIN,
      maxSpeed * MIN_CRUISE_FRACTION,
      maxSpeed,
    );
    // Nominal acceleration, before the turn penalty below. Deriving the braking
    // distance from the acceleration the player can actually deliver is what
    // keeps the profile honest: asking for a stop the cap cannot make would
    // just reintroduce overshoot. The scale on top of that is the difference
    // between braking as late as physics allows and easing in the way a runner
    // actually does.
    const nominalAcceleration = roleMotion.acceleration
      * sprintBoost
      * Math.min(1.4, directedRecoveryBoost);
    const brakeDistance = Math.max(
      0.0016,
      BRAKE_DISTANCE_SCALE * (cruiseSpeed * cruiseSpeed) / (2 * nominalAcceleration),
    );
    const desiredSpeed = pursuitSpeed(distance, cruiseSpeed, brakeDistance);
    const desiredVx = distance > 0.0001 ? dx / distance * desiredSpeed : 0;
    const desiredVy = distance > 0.0001 ? dy / distance * desiredSpeed : 0;
    const currentSpeed = Math.hypot(p.vx, p.vy);
    const alignment = currentSpeed > 0.0001 && desiredSpeed > 0.0001
      ? clamp((p.vx * desiredVx + p.vy * desiredVy) / (currentSpeed * desiredSpeed), -1, 1)
      : 1;
    const turnFactor = 0.68 + (alignment + 1) * 0.16;
    const maxAcceleration = nominalAcceleration * turnFactor;
    p.vx += clamp(desiredVx - p.vx, -maxAcceleration, maxAcceleration);
    p.vy += clamp(desiredVy - p.vy, -maxAcceleration, maxAcceleration);
    p.x += p.vx;
    p.y += p.vy;
    // The hard snap is what makes an arrival exact, and it is also the only
    // place a player's velocity is forced to zero. A drifting player must be
    // exempt: their target is moving by construction, so snapping to it would
    // cancel the keep-alive motion on exactly the frames it exists for.
    if (!driftActive && distance < 0.0015 && Math.hypot(p.vx, p.vy) < 0.0008) {
      p.x = targetX_n;
      p.y = targetY_n;
      p.vx = 0;
      p.vy = 0;
    }
    // The holder is deliberately NOT snapped to the release point here.
    //
    // This used to clamp the carrier inside a 0.025 radius of sourceOverride
    // the instant the ball left the foot. The shooter's run-up was far too
    // short to reach the shot origin, so the clamp is what moved them: 200 of
    // 200 shots teleported the shooter, by up to 19.9 m, on the single most
    // visible frame of the match. The target assignment above already keeps a
    // released passer walking back toward their release point, which is the
    // behaviour the clamp was protecting, without the snap.
    p.sprintT *= 0.95; // sprint decays
  }
}

// Pure ball + player position math. No canvas, no refs.
// Operates entirely in normalized (0-1) field coordinates.

import { clamp, dist, lerp, seededRand } from './math';
import { NORMALIZED_PITCH_SCREEN_ASPECT } from './geometry';
import { setPiecePlayerTarget } from './set-pieces';
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
  minimumScreenDistance = 0.022,
): void {
  const indices = [...activePlayerIndices].filter(index => playerPos[index] !== undefined);
  const pitchAspect = NORMALIZED_PITCH_SCREEN_ASPECT;

  for (let iteration = 0; iteration < 2; iteration++) {
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
  defensiveAction?: DirectedDefensiveAction,
  activePlayerIndices?: ReadonlySet<number>,
  phaseProgress = 0,
  tacticalAssignments?: TacticalAssignments,
  formations: PitchFormationLayouts = DEFAULT_FORMATIONS,
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
    const setPieceTarget = setPiecePlayerTarget(i, isHomeTeam, slot.role, currentPhase, formation);

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
      if (currentPhase.pattern) {
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
        const ownGoalX = isHomeTeam ? 0.03 : 0.97;
        const lineDepth = slot.role === 'DF' ? 0.085 : slot.role === 'MF' ? 0.17 : 0.28;
        targetX_n = ownGoalX + (isHomeTeam ? lineDepth : -lineDepth);
        targetY_n = slot.role === 'DF'
          ? lerp(slot.y, 0.5, 0.2)
          : slot.role === 'MF'
            ? lerp(slot.y, 0.5, 0.3)
            : lerp(slot.y, 0.5, 0.16);
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
        targetY_n = lerp(targetY_n, defensiveAction.target.y, reaction);
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

    // Critically damped pursuit with speed and acceleration caps. Target
    // changes no longer produce overshoot or whole-team direction snapping.
    const p = playerPos[i];
    const dx = targetX_n - p.x;
    const dy = targetY_n - p.y;
    const distance = Math.hypot(dx, dy);
    const sprintBoost = 1 + p.sprintT * 0.55;
    const directedRecoveryBoost = defensiveAction?.playerIndex === i && slot.role !== 'GK'
      ? currentPhase.kind === 'pass' ? 1.7 : 1.3
      : 1;
    const roleMotion = slot.role === 'GK'
      ? { speed: 0.00255, acceleration: 0.00028 }
      : slot.role === 'DF'
        ? { speed: 0.0034, acceleration: 0.00038 }
        : slot.role === 'MF'
          ? { speed: 0.00365, acceleration: 0.00043 }
          : { speed: 0.0038, acceleration: 0.00046 };
    const maxSpeed = roleMotion.speed * sprintBoost * directedRecoveryBoost;
    const desiredSpeed = Math.min(maxSpeed, distance * 0.11);
    const desiredVx = distance > 0.0001 ? dx / distance * desiredSpeed : 0;
    const desiredVy = distance > 0.0001 ? dy / distance * desiredSpeed : 0;
    const currentSpeed = Math.hypot(p.vx, p.vy);
    const alignment = currentSpeed > 0.0001 && desiredSpeed > 0.0001
      ? clamp((p.vx * desiredVx + p.vy * desiredVy) / (currentSpeed * desiredSpeed), -1, 1)
      : 1;
    const turnFactor = 0.68 + (alignment + 1) * 0.16;
    const maxAcceleration = roleMotion.acceleration
      * sprintBoost
      * Math.min(1.4, directedRecoveryBoost)
      * turnFactor;
    p.vx += clamp(desiredVx - p.vx, -maxAcceleration, maxAcceleration);
    p.vy += clamp(desiredVy - p.vy, -maxAcceleration, maxAcceleration);
    p.x += p.vx;
    p.y += p.vy;
    if (distance < 0.0015 && Math.hypot(p.vx, p.vy) < 0.0008) {
      p.x = targetX_n;
      p.y = targetY_n;
      p.vx = 0;
      p.vy = 0;
    }
    if (isHolder && phaseState !== 'holding' && currentPhase.sourceOverride) {
      p.x = clamp(p.x, currentPhase.sourceOverride.x - 0.025, currentPhase.sourceOverride.x + 0.025);
      p.y = clamp(p.y, currentPhase.sourceOverride.y - 0.025, currentPhase.sourceOverride.y + 0.025);
    }
    p.sprintT *= 0.95; // sprint decays
  }
}

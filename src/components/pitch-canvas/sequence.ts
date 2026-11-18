// Pass-sequence generator. Pure: same seed → same output; no canvas / refs.
import { clamp, seededRand } from './math';
import { generateSetPieceSequence } from './set-pieces';
import type { CoachFormation, MatchApproach } from '../../types/coach';
import {
  BASE_FORMATION,
  getTacticalFormationSlots,
  type FormationSlot,
  type PassPhase,
  type PresentationChanceStyle,
  type PresentationPlayPattern,
  type PresentationPlayStage,
  type PresentationRestart,
  type PresentationSetPiece,
} from './types';

export interface SequenceOptions {
  attackingHome?: boolean;
  forceShot?: boolean;
  setPiece?: PresentationSetPiece;
  setPieceSide?: 'left' | 'right' | 'central';
  setPieceDelivery?: 'near_post' | 'far_post' | 'central' | 'cutback' | 'direct';
  shooterIdx?: number;
  creatorIdx?: number;
  startingPlayerIdx?: number;
  sourceOverride?: { x: number; y: number };
  homePossessionShare?: number;
  transition?: boolean;
  chanceStyle?: PresentationChanceStyle;
  restart?: PresentationRestart;
  homeFormation?: CoachFormation;
  awayFormation?: CoachFormation;
  homeApproach?: MatchApproach;
  awayApproach?: MatchApproach;
  /**
   * Live normalized positions of all 22 players: 0-10 home, 11-21 away.
   *
   * A directed attack has to be built from where players actually are, not
   * from their formation slots. The tactical shape moves players a long way
   * during a possession, so a receiver picked by slot can be twenty metres
   * from the ball when the pass is played to them. Measured over 200 attacks,
   * 95.7% of passes demanded the receiver move faster than 11 m/s, median
   * 37 m/s, which is why the pitch looked like it was on fast-forward.
   *
   * When omitted the generator falls back to formation slots, which keeps
   * every existing caller and test valid.
   */
  playerPositions?: ReadonlyArray<{ x: number; y: number }>;
}

export function restartReleaseDelay(restart: PresentationRestart): number {
  if (restart === 'kickoff') return 30;
  if (restart === 'goal_kick') return 24;
  if (restart === 'keeper_release') return 22;
  // A throw-in needs the taker to walk to the touchline and the box to form,
  // which is longer than a clearance but nowhere near a goal kick.
  if (restart === 'throw_in') return 20;
  if (restart === 'clearance') return 12;
  return 7;
}

interface OpenPlayPlan {
  pattern: PresentationPlayPattern;
  route: number[];
  targets: Array<{ x: number; y: number }>;
}

function mirrorPoint(
  point: { x: number; y: number },
  attackingHome: boolean,
): { x: number; y: number } {
  return { x: attackingHome ? point.x : 1 - point.x, y: point.y };
}

function compactRoute(route: number[]): number[] {
  return route.filter((slot, index) => index === 0 || slot !== route[index - 1]);
}

function selectPattern(
  playStyle: number,
  startingPlayerIdx: number | undefined,
  transition: boolean,
  formation: FormationSlot[],
  approach: MatchApproach,
): PresentationPlayPattern {
  if (transition) return 'counter';
  const startingRole = startingPlayerIdx === undefined ? undefined : formation[startingPlayerIdx]?.role;
  const weights: Record<MatchApproach, Array<[PresentationPlayPattern, number]>> = {
    balanced: [
      ['build_up', 0.2], ['wing_overload', 0.22], ['central_combination', 0.2],
      ['switch_play', 0.22], ['recycle', 0.16],
    ],
    pressing: [
      ['build_up', 0.12], ['wing_overload', 0.24], ['central_combination', 0.2],
      ['switch_play', 0.14], ['recycle', 0.1], ['counter', 0.2],
    ],
    control: [
      ['build_up', 0.25], ['wing_overload', 0.13], ['central_combination', 0.23],
      ['switch_play', 0.23], ['recycle', 0.16],
    ],
    counter: [
      ['build_up', 0.07], ['wing_overload', 0.18], ['central_combination', 0.08],
      ['switch_play', 0.12], ['recycle', 0.11], ['counter', 0.44],
    ],
    low_block: [
      ['build_up', 0.08], ['wing_overload', 0.16], ['central_combination', 0.1],
      ['switch_play', 0.18], ['recycle', 0.2], ['counter', 0.28],
    ],
  };
  let cursor = playStyle;
  let selected: PresentationPlayPattern = 'recycle';
  for (const [pattern, weight] of weights[approach]) {
    cursor -= weight;
    if (cursor <= 0) {
      selected = pattern;
      break;
    }
  }
  // A forward receiving the final pass of a prior episode should not always
  // trigger the same four-player reset. They can set a runner, switch the
  // point of attack, or protect possession according to the coach's intent.
  if (startingRole === 'FW' && selected === 'build_up') return 'recycle';
  return selected;
}

function nearestSlot(
  formation: FormationSlot[],
  roles: FormationSlot['role'][],
  targetY: number,
  excluded: number[] = [],
): number {
  const candidates = formation
    .map((slot, index) => ({ slot, index }))
    .filter(entry => roles.includes(entry.slot.role) && !excluded.includes(entry.index))
    .sort((left, right) => Math.abs(left.slot.y - targetY) - Math.abs(right.slot.y - targetY)
      || right.slot.x - left.slot.x
      || left.index - right.index);
  return candidates[0]?.index ?? 6;
}

function roleIndices(formation: FormationSlot[], role: FormationSlot['role']): number[] {
  return formation.flatMap((slot, index) => slot.role === role ? [index] : []);
}

function depthSlot(
  formation: FormationSlot[],
  role: FormationSlot['role'],
  mode: 'deep' | 'advanced',
  targetY = 0.5,
  excluded: number[] = [],
): number {
  return formation
    .map((slot, index) => ({ slot, index }))
    .filter(entry => entry.slot.role === role && !excluded.includes(entry.index))
    .sort((left, right) => (
      (mode === 'advanced' ? right.slot.x - left.slot.x : left.slot.x - right.slot.x)
      || Math.abs(left.slot.y - targetY) - Math.abs(right.slot.y - targetY)
      || left.index - right.index
    ))[0]?.index ?? nearestSlot(formation, [role], targetY, excluded);
}

function routeForPattern(
  pattern: PresentationPlayPattern,
  startingPlayerIdx: number | undefined,
  upperFlank: boolean,
  formation: FormationSlot[],
  formationName: CoachFormation,
  variant: number,
): number[] {
  const flankY = upperFlank ? 0.12 : 0.88;
  const oppositeY = 1 - flankY;
  const fullback = nearestSlot(formation, ['DF'], flankY);
  const centerBack = nearestSlot(formation, ['DF'], upperFlank ? 0.38 : 0.62, [fullback]);
  const midfielder = nearestSlot(formation, ['MF'], upperFlank ? 0.3 : 0.7);
  const otherMidfielder = nearestSlot(formation, ['MF'], upperFlank ? 0.7 : 0.3, [midfielder]);
  const centralMidfielder = nearestSlot(formation, ['MF'], 0.5);
  const forwards = roleIndices(formation, 'FW');
  const striker = nearestSlot(formation, ['FW'], 0.5);
  const wideRoles: FormationSlot['role'][] = forwards.length >= 3 ? ['FW'] : ['MF'];
  const winger = nearestSlot(formation, wideRoles, flankY);
  const oppositeWinger = nearestSlot(formation, wideRoles, oppositeY, [winger]);
  const oppositeFullback = nearestSlot(formation, ['DF'], oppositeY, [fullback]);
  const holdingMidfielder = depthSlot(formation, 'MF', 'deep', 0.5);
  const attackingMidfielder = depthSlot(formation, 'MF', 'advanced', 0.5, [holdingMidfielder]);
  const wideMidfielder = nearestSlot(formation, ['MF'], flankY);
  const oppositeWideMidfielder = nearestSlot(formation, ['MF'], oppositeY, [wideMidfielder]);
  const secondForward = forwards.length >= 2
    ? nearestSlot(formation, ['FW'], oppositeY, [striker])
    : oppositeWinger;
  const isTwoForwardShape = formationName === '4-4-2';

  if (startingPlayerIdx !== undefined) {
    const role = formation[startingPlayerIdx]?.role;
    if (pattern === 'counter') {
      return compactRoute(role === 'FW'
        ? [startingPlayerIdx, startingPlayerIdx === striker ? secondForward : striker]
        : [startingPlayerIdx, variant === 0 ? winger : attackingMidfielder, isTwoForwardShape ? secondForward : striker]);
    }
    if (role === 'FW') {
      if (pattern === 'wing_overload') return compactRoute([startingPlayerIdx, wideMidfielder, fullback, oppositeWinger]);
      if (pattern === 'central_combination') return compactRoute([startingPlayerIdx, attackingMidfielder, isTwoForwardShape ? secondForward : oppositeWinger]);
      if (pattern === 'switch_play') return compactRoute([startingPlayerIdx, midfielder, oppositeWideMidfielder, oppositeWinger]);
      return compactRoute([startingPlayerIdx, holdingMidfielder, centerBack, otherMidfielder, oppositeWinger]);
    }
    if (role === 'MF') {
      if (pattern === 'switch_play') return compactRoute([startingPlayerIdx, centerBack, oppositeFullback, oppositeWinger]);
      if (pattern === 'recycle') return compactRoute([startingPlayerIdx, centerBack, oppositeFullback, oppositeWideMidfielder]);
      if (pattern === 'central_combination') return compactRoute([startingPlayerIdx, attackingMidfielder, striker, secondForward]);
      return compactRoute([startingPlayerIdx, variant === 0 ? winger : fullback, striker]);
    }
    if (role === 'GK') return compactRoute([startingPlayerIdx, centerBack, holdingMidfielder, variant === 0 ? winger : wideMidfielder]);
    if (pattern === 'switch_play') return compactRoute([startingPlayerIdx, holdingMidfielder, oppositeFullback, oppositeWinger]);
    if (pattern === 'wing_overload') return compactRoute([startingPlayerIdx, wideMidfielder, fullback, winger]);
    return compactRoute([startingPlayerIdx, holdingMidfielder, attackingMidfielder, striker]);
  }

  switch (pattern) {
    case 'build_up':
      return compactRoute(variant === 0
        ? [centerBack, holdingMidfielder, midfielder, winger]
        : variant === 1
          ? [centerBack, nearestSlot(formation, ['DF'], oppositeY, [centerBack]), fullback, wideMidfielder]
          : [centerBack, otherMidfielder, attackingMidfielder, striker]);
    case 'wing_overload':
      return compactRoute(variant === 0
        ? [centerBack, midfielder, fullback, winger]
        : variant === 1
          ? [holdingMidfielder, winger, fullback, striker]
          : [fullback, wideMidfielder, attackingMidfielder, isTwoForwardShape ? secondForward : striker]);
    case 'central_combination':
      return compactRoute(variant === 0
        ? [centerBack, holdingMidfielder, attackingMidfielder, striker]
        : variant === 1
          ? [otherMidfielder, attackingMidfielder, striker, secondForward]
          : [holdingMidfielder, midfielder, winger, striker]);
    case 'switch_play':
      return compactRoute(variant === 0
        ? [fullback, centerBack, holdingMidfielder, oppositeWideMidfielder, oppositeWinger]
        : variant === 1
          ? [midfielder, centerBack, oppositeFullback, oppositeWinger]
          : [winger, midfielder, centralMidfielder, oppositeWideMidfielder]);
    case 'counter':
      return compactRoute(variant === 0
        ? [centralMidfielder, winger, striker]
        : variant === 1
          ? [centerBack, wideMidfielder, striker]
          : [midfielder, striker, secondForward]);
    case 'recycle':
      return compactRoute(variant === 0
        ? [winger, midfielder, centerBack, oppositeFullback]
        : variant === 1
          ? [wideMidfielder, holdingMidfielder, centerBack, fullback, winger]
          : [striker, attackingMidfielder, otherMidfielder, oppositeWinger]);
  }
}

function targetForPattern(
  pattern: PresentationPlayPattern,
  step: number,
  stepCount: number,
  receiverIdx: number,
  source: { x: number; y: number },
  attackingHome: boolean,
  upperFlank: boolean,
  seedValue: number,
  formation: FormationSlot[],
  variant: number,
): { x: number; y: number } {
  const t = (step + 1) / Math.max(1, stepCount);
  const sourceProgress = attackingHome ? source.x : 1 - source.x;
  const flankY = upperFlank ? 0.18 : 0.82;
  const oppositeY = 1 - flankY;
  const receiverY = formation[receiverIdx]?.y ?? 0.5;
  let progress: number;
  let y: number;

  switch (pattern) {
    case 'build_up': {
      const start = Math.max(0.24, Math.min(sourceProgress + 0.04, 0.42));
      progress = variant === 1 && step === 0
        ? Math.max(0.18, sourceProgress - 0.035)
        : start + ((variant === 2 ? 0.72 : 0.68) - start) * t;
      y = receiverY * 0.76 + flankY * 0.24;
      break;
    }
    case 'wing_overload': {
      const start = Math.max(0.32, Math.min(sourceProgress, 0.5));
      const overlapBoost = variant === 1 && step >= stepCount - 2 ? 0.05 : 0;
      progress = start + (0.78 - start) * t + overlapBoost;
      y = flankY * (variant === 2 ? 0.58 : 0.72) + receiverY * (variant === 2 ? 0.42 : 0.28);
      break;
    }
    case 'central_combination': {
      const start = Math.max(0.34, Math.min(sourceProgress, 0.5));
      progress = start + (0.79 - start) * t;
      const halfSpace = upperFlank ? 0.42 : 0.58;
      y = (variant === 0 ? 0.5 : halfSpace) * 0.66 + receiverY * 0.34;
      break;
    }
    case 'switch_play': {
      const start = Math.max(0.28, Math.min(sourceProgress - 0.03, 0.48));
      progress = step === 0
        ? Math.max(0.2, sourceProgress - (variant === 1 ? 0.075 : 0.04))
        : start + ((variant === 2 ? 0.74 : 0.7) - start) * t;
      y = source.y + (oppositeY - source.y) * t;
      break;
    }
    case 'counter': {
      const start = Math.max(0.4, sourceProgress);
      progress = start + (0.84 - start) * t;
      y = source.y + (receiverY - source.y) * Math.min(1, t * 0.78);
      break;
    }
    case 'recycle': {
      const deepest = Math.max(0.27, Math.min(0.42, sourceProgress - 0.16));
      progress = step === 0
        ? Math.max(deepest + 0.08, sourceProgress - 0.1)
        : step === 1
          ? deepest
          : deepest + (0.61 - deepest) * ((step - 1) / Math.max(1, stepCount - 1));
      y = step < 2
        ? source.y + (0.5 - source.y) * t
        : 0.5 + (oppositeY - 0.5) * ((step - 1) / Math.max(1, stepCount - 1));
      break;
    }
  }

  const jitter = (seedValue - 0.5) * 0.018;
  return mirrorPoint({
    x: Math.min(0.9, Math.max(0.08, progress + jitter)),
    y: Math.min(0.9, Math.max(0.1, y + jitter * 0.7)),
  }, attackingHome);
}

function stageForPass(
  pattern: PresentationPlayPattern,
  passIndex: number,
  passCount: number,
): PresentationPlayStage {
  if (pattern === 'counter' && passIndex === 0) return 'transition';
  if (passIndex === 0) return 'build';
  if (passIndex === passCount - 1) return 'create';
  return 'progress';
}

function buildOpenPlayPlan(
  seed: number,
  attackingHome: boolean,
  playStyle: number,
  startingPlayerIdx: number | undefined,
  sourceOverride: { x: number; y: number } | undefined,
  transition: boolean,
  formation: FormationSlot[],
  formationName: CoachFormation,
  approach: MatchApproach,
): OpenPlayPlan {
  const upperFlank = seededRand(seed * 13 + 19) < 0.5;
  const variant = Math.floor(seededRand(seed * 29 + 37) * 3);
  const pattern = selectPattern(playStyle, startingPlayerIdx, transition, formation, approach);
  const route = routeForPattern(pattern, startingPlayerIdx, upperFlank, formation, formationName, variant);
  const source = sourceOverride ?? (() => {
    const slot = formation[route[0]] ?? formation[nearestSlot(formation, ['MF'], 0.5)];
    return { x: attackingHome ? slot.x : 1 - slot.x, y: slot.y };
  })();
  const targets = route.slice(1).map((receiverIdx, step) => targetForPattern(
    pattern,
    step,
    route.length - 1,
    receiverIdx,
    source,
    attackingHome,
    upperFlank,
    seededRand(seed * 17 + step + 71),
    formation,
    variant,
  ));
  return { pattern, route, targets };
}

export function buildPassTarget(
  receiverIdx: number,
  attackingHome: boolean,
  seedValue: number,
  longBall: boolean,
  formation: FormationSlot[] = BASE_FORMATION,
): { x: number; y: number } {
  const slot = formation[receiverIdx] ?? formation[nearestSlot(formation, ['MF'], 0.5)];
  const attackDirection = attackingHome ? 1 : -1;
  const baseX = attackingHome ? slot.x : 1 - slot.x;
  const roleAdvance = slot.role === 'FW' ? 0.045 : slot.role === 'MF' ? 0.026 : slot.role === 'DF' ? 0.012 : 0;
  const forwardRun = roleAdvance + (longBall ? 0.022 : 0) + (seedValue - 0.5) * 0.018;
  const lateralSeed = seededRand(receiverIdx * 193 + Math.round(seedValue * 10_000));
  const lateralRange = slot.role === 'FW' ? 0.055 : slot.role === 'MF' ? 0.04 : 0.025;
  return {
    x: Math.min(0.94, Math.max(0.06, baseX + attackDirection * forwardRun)),
    y: Math.min(0.91, Math.max(0.09, slot.y + (lateralSeed - 0.5) * lateralRange)),
  };
}

/**
 * The highest an open-play pass of each kind is allowed to climb, as a
 * fraction of the renderer's maximum lift.
 *
 * Height is a property of what a pass is for, not of how far it goes. A
 * switch of play is a diagonal that has to clear a midfield and really is
 * lofted; a long ball from the back is the highest pass in the game; a
 * counter is a ball threaded forward into space and stays on the deck.
 *
 * Deciding height from distance alone — which is what this replaced — drew a
 * 45 m counter and a 45 m switch identically, and because the old rule was a
 * step at 0.34 rather than a ramp, a pass that grew by a metre went from ankle
 * height to more than twice a player's height between one frame and the next.
 * Measured over 11,314 generated phases, 31-47% of passes crossed that step and
 * the worst of them peaked at 2.32 player heights — during a counter, which is
 * the one passage a viewer is actually watching.
 */
const PATTERN_ARC_CEILING: Readonly<Record<PresentationPlayPattern, number>> = {
  switch_play: 0.95,
  build_up: 0.9,
  wing_overload: 0.7,
  recycle: 0.3,
  central_combination: 0.28,
  counter: 0.24,
};

/** Arc every pass starts from: the ball rolls, it does not hop. */
const ARC_FLOOR = 0.055;

/**
 * Distance at which a pass starts to leave the grass, and how long the ramp is.
 *
 * Tuned against the distances the generator actually produces: the median pass
 * is 17-24 m and only the back-to-front balls reach 60-70 m, so the ramp has to
 * be short enough that a 39 m switch of play reads as lofted while a 20 m
 * combination stays flat.
 */
const ARC_RAMP_START = 0.14;
const ARC_RAMP_SPAN = 0.26;

/**
 * Arc for an open-play pass.
 *
 * Squaring the reach is what keeps medium passes on the grass and lets only
 * genuinely long ones climb. A linear ramp still floated a 25 m ball
 * noticeably; this one leaves it at ankle height.
 */
export function passArc(
  travel: number,
  pattern: PresentationPlayPattern | undefined,
  roll: number,
): number {
  const reach = clamp((travel - ARC_RAMP_START) / ARC_RAMP_SPAN, 0, 1);
  const ceiling = PATTERN_ARC_CEILING[pattern ?? 'recycle'] ?? 0.3;
  return (ARC_FLOOR + reach * reach * (ceiling - ARC_FLOOR)) * (0.82 + roll * 0.36);
}

/**
 * Flight time for an open-play pass.
 *
 * Ramped for the same reason the arc is. The old code had two fixed bands
 * either side of the same threshold, so a pass that grew by a metre could take
 * 60% longer to arrive — a ball that changes speed in a jump reads as a cut.
 */
function openPlayDuration(travelMeters: number, roll: number): number {
  // The speed comes from the pass itself rather than from a flat tempo, for
  // the same reason the arc does: a six-metre touch and a forty-metre switch
  // are not the same ball. The ceiling is 2.6 s, which is what a ball sent the
  // length of the pitch actually spends in the air.
  const speed = passSpeedMps(travelMeters, OPEN_PLAY_PASS_CEILING_MPS);
  return clamp(travelMeters / speed * 60, 24, 156) * (0.92 + roll * 0.16);
}

/**
 * Flight time for a pass inside a move that is going somewhere.
 *
 * Open play is a team looking for a way through, and it is paced like one:
 * 42-80 frames of flight and 26-56 of hold. A move that ends in a shot is the
 * opposite. The receiver is already moving, the pass is weighted, and the
 * touch is short. At the open-play tempo an eight-pass move ran past 24
 * seconds, which is longer than the passage it exists to depict.
 */
/** A pass that is only a touch: the ball is rolled a few metres. */
const TOUCH_SPEED_MPS = 11;
/** How quickly a pass firms up towards its ceiling as it gets longer. */
const SPEED_RAMP_METERS = 20;
/** A firm pass inside a move that is going somewhere. */
const DIRECTED_PASS_CEILING_MPS = 28;
/** The ball that creates the chance is struck harder than any other pass. */
const DELIVERY_CEILING_MPS = 31;
/** Ordinary circulation: a shade calmer than a move that ends in a shot. */
const OPEN_PLAY_PASS_CEILING_MPS = 27;
/** A cross is lofted, so it covers the same ground slower than a driven ball. */
const CROSS_CEILING_MPS = 22;
/** A struck shot leaves the boot at roughly 28 m/s; a header is slower. */
const STRIKE_SPEED_MPS = 28;
const HEADER_SPEED_MPS = 19;

/**
 * How fast a pass is actually struck.
 *
 * Speed is a property of the pass, not of the passage it happens in. A
 * four-metre lay-off is rolled; a thirty-metre switch is driven; a ball that has
 * to cover half the pitch is hit as hard as a player can hit it.
 *
 * One flat speed for a whole move is what made a goalscoring move read as slow
 * motion. Every one of its passes ran at 17 m/s — a training-ground tempo —
 * while the ordinary circulation around it ran at 30, so the least urgent
 * football on the pitch was the fastest thing on it. That inversion is what a
 * viewer feels before they can name it.
 *
 * The curve rises towards the ceiling and never reaches it, so a pass keeps
 * firming up with distance and there is no step anywhere to read as a cut.
 */
function passSpeedMps(travelMeters: number, ceilingMps: number): number {
  const reach = 1 - Math.exp(-travelMeters / SPEED_RAMP_METERS);
  return TOUCH_SPEED_MPS + (ceilingMps - TOUCH_SPEED_MPS) * reach;
}

/**
 * Pass flight time from the distance the ball actually travels.
 *
 * The old curve was hand-tuned against the two-pass route and returned 25-45
 * frames no matter how far the ball went, so a 30 m ball and a 5 m touch took
 * the same time. Now that the route is built from live positions the distances
 * vary a lot, and the flight has to follow them or the receiver is asked to
 * arrive somewhere the ball has not reached yet.
 *
 * 17 m/s is a firm ground pass; a cross is slower because it is lofted. The
 * floor keeps a short touch from landing on the frame it is played. The
 * ceiling is 2.2 s, which is what a ball switched the length of the pitch
 * actually spends in the air; at 96 frames the same ball crossed the pitch
 * at fifty metres a second.
 */
function passFlightFrames(travelMeters: number, speedMps: number, roll: number): number {
  return clamp(travelMeters / speedMps * 60, 15, 132) * (0.92 + roll * 0.16);
}

/**
 * How many build-up passes a goalscoring move is built from.
 *
 * The directed route used to be three players — whoever was on the ball,
 * the creator, the shooter — so every goal in the broadcast arrived after
 * two passes and about a second of football. Nothing in the simulation
 * records how a chance was constructed, so the length of the approach is a
 * presentation choice, and a real goalscoring move is eight to twelve
 * touches: circulation, a switch, the final third, then the ball that
 * creates the shot.
 */
const DIRECTED_APPROACH_MIN = 6;
const DIRECTED_APPROACH_SPREAD = 3;

/** Closest outfield slot to a point on the pitch, in the attacking frame. */
function nearestSlotToPoint(
  formation: FormationSlot[],
  point: { x: number; y: number },
  attackingHome: boolean,
  excluded: number[],
): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let index = 0; index < formation.length; index++) {
    const slot = formation[index];
    if (slot.role === 'GK' || excluded.includes(index)) continue;
    const x = attackingHome ? slot.x : 1 - slot.x;
    // Lateral distance is weighted down: a pass across the pitch to the
    // other flank is a longer ball than a pass down the line, and the
    // generator is allowed to prefer the player who is actually free.
    const distance = Math.hypot(x - point.x, (slot.y - point.y) * 0.8);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best >= 0 ? best : nearestSlot(formation, ['MF'], point.y, excluded);
}

/**
 * Where a player actually is, in the attacking frame, or null when the
 * caller did not supply live positions.
 */
function livePositionFor(
  positions: ReadonlyArray<{ x: number; y: number }> | undefined,
  slotIndex: number,
  attackingHome: boolean,
): { x: number; y: number } | null {
  if (!positions) return null;
  const entry = positions[attackingHome ? slotIndex : 11 + slotIndex];
  return entry ? { x: entry.x, y: entry.y } : null;
}

/**
 * How far behind the ball a build-up receiver may be, as a fraction of the
 * pitch length. 0.03 is about three metres: enough for a player who has
 * drifted to receive a ball laid back to them, not enough for a move to
 * spend nine passes circulating among its own defenders.
 */
const RECYCLE_TOLERANCE = 0.03;

/** A point's progress toward the goal the attacker is aiming at, 0..1. */
function attackProgress(x: number, attackingHome: boolean): number {
  return attackingHome ? x : 1 - x;
}

/**
 * Closest live outfield player to a point, among those at or ahead of the
 * ball.
 *
 * Without the forward requirement the receiver is simply whoever is nearest
 * the waypoint, and while the team is still in its own half that is a
 * defender. The ball is aimed at the receiver's feet, so it follows them
 * back down the pitch: measured over 200 attacks the move spent its whole
 * nine passes between 16 m and 54 m, never advancing, and then struck a shot
 * from 76 m with the ball last seen at 37 m.
 *
 * If nobody qualifies the most advanced available player is taken instead,
 * so the move always progresses even when the shape has not pushed up yet.
 */
function nearestLiveSlotAhead(
  formation: FormationSlot[],
  positions: ReadonlyArray<{ x: number; y: number }> | undefined,
  point: { x: number; y: number },
  attackingHome: boolean,
  excluded: number[],
  ballProgress: number,
): number {
  if (!positions) return nearestSlotToPoint(formation, point, attackingHome, excluded);
  const floor = ballProgress - RECYCLE_TOLERANCE;
  let best = -1;
  let bestDistance = Infinity;
  let fallback = -1;
  let fallbackProgress = -Infinity;
  for (let index = 0; index < formation.length; index++) {
    if (formation[index].role === 'GK' || excluded.includes(index)) continue;
    const live = livePositionFor(positions, index, attackingHome);
    if (!live) continue;
    const progress = attackProgress(live.x, attackingHome);
    const distance = Math.hypot(live.x - point.x, (live.y - point.y) * 0.8);
    if (progress >= floor && distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
    if (progress > fallbackProgress) {
      fallbackProgress = progress;
      fallback = index;
    }
  }
  if (best >= 0) return best;
  if (fallback >= 0) return fallback;
  return nearestSlotToPoint(formation, point, attackingHome, excluded);
}

/**
 * How far ahead of a receiver a pass may be played, in normalized pitch
 * length. 0.024 is 2.5 m along a 105 m pitch.
 *
 * A receiver accelerating from a standing start covers barely a metre during
 * a pass, so the ball has to arrive roughly at their feet. Leading them by
 * more than this is what produced the sprinting: the target was reachable
 * only at a speed no footballer has.
 */
const MAX_PASS_LEAD = 0.024;

/**
 * How far a build-up pass may reasonably travel, in metres.
 *
 * A receiver further away than this is not the man the move is looking for,
 * however close they stand to the waypoint. Picking them anyway turned a
 * nine-pass move into a sequence of forty-metre lumps.
 */
const MAX_SANE_PASS_METERS = 38;

/**
 * Play the ball at a receiver's feet rather than at a spot on a curve.
 *
 * The waypoint still decides who receives it — that is what carries the
 * attack upfield — but the ball is aimed at where that player actually is,
 * led by at most a couple of metres in the direction they should be going.
 */
function reachableTarget(
  live: { x: number; y: number } | null,
  waypoint: { x: number; y: number },
  maxLead = MAX_PASS_LEAD,
): { x: number; y: number } {
  if (!live) return waypoint;
  const dx = waypoint.x - live.x;
  const dy = waypoint.y - live.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= maxLead) {
    return { x: clamp(waypoint.x, 0.06, 0.94), y: clamp(waypoint.y, 0.09, 0.91) };
  }
  const scale = maxLead / distance;
  return {
    x: clamp(live.x + dx * scale, 0.06, 0.94),
    y: clamp(live.y + dy * scale, 0.09, 0.91),
  };
}

/**
 * How far a shooter may be asked to travel to their own release point.
 * 0.05 is 5.25 m, which a forward covers during a delivery plus the hold.
 */
const SHOT_REACH = 0.05;


/**
 * Re-aim a pass at its receiver's live position, at the moment it is played.
 *
 * A directed route is planned once, when the possession begins, but the
 * players keep moving for the whole move. By the fifth pass the man the ball
 * was aimed at can be fifteen metres from where the plan assumed, and the
 * pass becomes one nobody could reach: measured over 200 attacks, 30.4% of
 * passes still demanded more than 11 m/s from the receiver.
 *
 * Re-aiming at the moment of release fixes that without touching who
 * receives the ball, who plays it, or the shape of the move. Only where the
 * ball is aimed moves, and only ever toward the player it was already going
 * to.
 */
export interface RetargetContext {
  /** Live positions of the attacking team's eleven players, slot order. */
  teammates?: ReadonlyArray<{ x: number; y: number }>;
  /** Where the ball is as the pass is played. */
  ball?: { x: number; y: number };
}

export function retargetPassToReceiver(
  phase: PassPhase,
  receiverPosition: { x: number; y: number } | null,
  context?: RetargetContext,
): PassPhase {
  if (!receiverPosition) return phase;
  if (phase.kind === 'pass' && phase.targetOverride) {
    // A build-up pass goes to whoever is actually forward now. The planned
    // receiver was chosen when the move was built, and by the time the ball
    // reaches them they have often dropped back behind it — which is what
    // made a nine-pass move spend itself in its own half. The two passes the
    // event names keep their receiver: those are facts, not choices.
    let receiver = receiverPosition;
    let receiverIdx = phase.receiverIdx;
    const teammates = context?.teammates;
    const ball = context?.ball;
    if (teammates && ball && !phase.lockedReceiver) {
      const ballProgress = attackProgress(ball.x, phase.attackingHome);
      const floor = ballProgress - RECYCLE_TOLERANCE;
      let bestIdx = -1;
      let bestDistance = Infinity;
      let farIdx = -1;
      let farDistance = Infinity;
      for (let index = 0; index < teammates.length; index++) {
        if (index === phase.passerIdx) continue;
        const mate = teammates[index];
        if (!mate) continue;
        if (attackProgress(mate.x, phase.attackingHome) < floor) continue;
        const distance = Math.hypot(mate.x - phase.targetOverride.x, (mate.y - phase.targetOverride.y) * 0.8);
        // A build-up is a sequence of passes, not a sequence of long balls.
        // The receiver nearest the waypoint is the right one to pick, but
        // only while they are somewhere a pass could actually reach;
        // otherwise the ball is lumped forty metres because that is where
        // the nearest forward happens to be standing.
        const reach = Math.hypot((mate.x - ball.x) * 105, (mate.y - ball.y) * 68);
        if (reach <= MAX_SANE_PASS_METERS) {
          if (distance < bestDistance) {
            bestDistance = distance;
            bestIdx = index;
          }
        } else if (distance < farDistance) {
          farDistance = distance;
          farIdx = index;
        }
      }
      if (bestIdx < 0) bestIdx = farIdx;
      if (bestIdx >= 0 && bestIdx !== receiverIdx) {
        receiverIdx = bestIdx;
        receiver = teammates[bestIdx];
      }
    }
    // Led forward, not toward wherever the plan last pointed. A receiver who
    // has dropped back since the move was planned must not drag the ball
    // back with them; the ball is played in front of them instead.
    const forwardLane = {
      x: phase.attackingHome
        ? Math.max(phase.targetOverride.x, receiver.x)
        : Math.min(phase.targetOverride.x, receiver.x),
      y: phase.targetOverride.y,
    };
    const adjusted = reachableTarget(receiver, forwardLane);
    if (
      adjusted.x === phase.targetOverride.x
      && adjusted.y === phase.targetOverride.y
      && receiverIdx === phase.receiverIdx
    ) return phase;
    // Re-aiming moves the ball further than the plan assumed, and the flight
    // time was derived from the planned distance. Measured on a real replay,
    // a pass planned at twelve metres was re-aimed fifty-eight metres away
    // and still flew in forty-two frames: eighty-two metres a second, which
    // is what made a move read as a blur instead of as passes.
    const releasePoint = phase.sourceOverride ?? ball;
    let duration = phase.duration;
    if (releasePoint) {
      const metres = Math.hypot(
        (adjusted.x - releasePoint.x) * 105,
        (adjusted.y - releasePoint.y) * 68,
      );
      // Derived again from the distance the ball now actually travels, in both
      // directions. Only ever lengthening was the mirror image of the bug it
      // fixed: a pass re-aimed at a receiver who had dropped back kept the
      // flight time of the longer planned ball and then crawled the last few
      // metres. Measured across 300 attacks, passes under ten metres ran at a
      // median of 3.5 m/s — a ball being pushed along the grass.
      duration = passFlightFrames(
        metres,
        passSpeedMps(metres, phase.speedCeilingMps ?? DELIVERY_CEILING_MPS),
        0.5,
      );
    }
    return { ...phase, targetOverride: adjusted, receiverIdx, duration };
  }
  if (phase.kind === 'shot' && phase.sourceOverride) {
    // The ball is struck from where the striker actually is. It used to be
    // pinned inside a shooting band, so a striker who had not made the run
    // had the ball struck seventeen metres in front of them: a shot leaving
    // from a spot on the pitch where nobody was standing. The shooter now
    // runs at the strike point for the whole move, so the band is not needed
    // to keep the chance worth taking, and holding it only invented a lie.
    const adjusted = reachableTarget(receiverPosition, phase.sourceOverride, SHOT_REACH);
    const heldPoint = {
      x: adjusted.x,
      y: clamp(adjusted.y, 0.14, 0.86),
    };
    if (heldPoint.x === phase.sourceOverride.x && heldPoint.y === phase.sourceOverride.y) return phase;
    // Flight time follows the origin that was actually chosen. The duration
    // was derived from the planned release point, so pulling the origin back
    // to the shooter left a 29 m shot arriving in the time a 12 m one needed.
    const travelMeters = Math.hypot(
      (phase.attackingHome ? 1 - heldPoint.x : heldPoint.x) * 105,
      (heldPoint.y - 0.5) * 68,
    );
    return {
      ...phase,
      sourceOverride: heldPoint,
      duration: passFlightFrames(
        travelMeters,
        phase.chanceStyle === 'cross' ? HEADER_SPEED_MPS : STRIKE_SPEED_MPS,
        0.5,
      ),
    };
  }
  return phase;
}

interface DirectedApproach {
  /** Receivers of the build-up passes, in order. */
  players: number[];
  /** Where each of those passes is played, aligned with `players`. */
  targets: Array<{ x: number; y: number }>;
}

/**
 * The passes that get the ball from wherever it is to the man who creates
 * the chance.
 *
 * Waypoints rather than a fixed chain, so the move can start deep or high
 * and still read as one attack. Progress runs along a quadratic through a
 * control point held at least 0.16 behind the chance: when the ball is
 * already in the final third the curve dips back into midfield before
 * coming forward again, which is what a side that wins it high and cannot
 * go straight through actually does.
 */
function buildDirectedApproach(
  formation: FormationSlot[],
  attackingHome: boolean,
  startIdx: number,
  source: { x: number; y: number },
  entry: { x: number; y: number },
  upperFlank: boolean,
  creator: number,
  shooter: number,
  roll: (n: number) => number,
  positions?: ReadonlyArray<{ x: number; y: number }>,
): DirectedApproach {
  const players: number[] = [];
  const targets: Array<{ x: number; y: number }> = [];
  const wanted = DIRECTED_APPROACH_MIN + Math.floor(roll(51) * DIRECTED_APPROACH_SPREAD);
  const flankY = upperFlank ? 0.17 : 0.83;
  const oppositeY = 1 - flankY;
  const controlX = Math.min(source.x, entry.x - 0.16);
  const shape = roll(52);
  const lateralAt = shape < 0.34
    ? (t: number) => (
      t < 0.42
        ? source.y + (oppositeY - source.y) * (t / 0.42)
        : t < 0.74
          ? oppositeY + (0.5 - oppositeY) * ((t - 0.42) / 0.32)
          : 0.5 + (entry.y - 0.5) * ((t - 0.74) / 0.26)
    )
    : shape < 0.68
      ? (t: number) => source.y + (flankY - source.y) * Math.min(1, t * 1.6)
      : (t: number) => 0.5 + (entry.y - 0.5) * t + Math.sin(t * Math.PI * 2) * 0.1;

  let previous = startIdx;
  const recent: number[] = [startIdx];
  let guard = 0;
  // The ball cannot go backwards, so the floor for the next receiver rises
  // with every pass completed.
  let ballProgress = attackProgress(source.x, attackingHome);
  while (players.length < wanted && guard++ < wanted * 4) {
    const step = players.length;
    const t = (step + 1) / (wanted + 1);
    // Deep circulation covers less ground than the run into the final
    // third, so progress is shaped rather than linear.
    const shaped = Math.pow(t, 1.22);
    const inverse = 1 - shaped;
    const jitter = (roll(60 + step) - 0.5) * 0.028;
    const point = {
      x: clamp(
        inverse * inverse * source.x
          + 2 * inverse * shaped * controlX
          + shaped * shaped * entry.x
          + jitter,
        0.06,
        0.94,
      ),
      y: clamp(lateralAt(t) + jitter * 0.6, 0.09, 0.91),
    };
    // The last two receivers stay out of the build-up so the chance itself
    // keeps the two players the event names, and the previous passer is
    // excluded so nobody plays a pass to themselves.
    const receiver = nearestLiveSlotAhead(
      formation,
      positions,
      point,
      attackingHome,
      [creator, shooter, previous, ...recent.slice(-2)],
      ballProgress,
    );
    if (receiver === previous) break;
    players.push(receiver);
    // The waypoint chose the receiver and the lane; the ball is aimed at
    // their feet, led forward. Leading toward the waypoint without the
    // forward floor let a waypoint that had dipped behind the receiver pull
    // the ball back down the pitch.
    const live = livePositionFor(positions, receiver, attackingHome);
    const forwardLane = live
      ? {
        x: attackingHome ? Math.max(point.x, live.x) : Math.min(point.x, live.x),
        y: point.y,
      }
      : point;
    const target = reachableTarget(live, forwardLane);
    targets.push(target);
    ballProgress = Math.max(ballProgress, attackProgress(target.x, attackingHome));
    recent.push(receiver);
    previous = receiver;
  }
  return { players, targets };
}

/** Where the creator receives the ball for each shape of chance. */
function chanceEntryPoint(
  chanceStyle: PresentationChanceStyle,
  upperFlank: boolean,
  isHome: boolean,
  source: { x: number; y: number },
  shotOrigin: { x: number; y: number },
  roll: (n: number) => number,
): { x: number; y: number } {
  if (chanceStyle === 'cross') {
    return mirrorPoint({ x: 0.76 + roll(21) * 0.05, y: upperFlank ? 0.13 : 0.87 }, isHome);
  }
  if (chanceStyle === 'cutback') {
    return mirrorPoint({ x: 0.87 + roll(22) * 0.035, y: upperFlank ? 0.18 : 0.82 }, isHome);
  }
  if (chanceStyle === 'through_ball') {
    return mirrorPoint({ x: 0.66 + roll(23) * 0.06, y: 0.42 + (roll(24) - 0.5) * 0.16 }, isHome);
  }
  return {
    x: source.x + (shotOrigin.x - source.x) * 0.72,
    y: source.y + (shotOrigin.y - source.y) * 0.52,
  };
}

/**
 * Generate a possession sequence with realistic flow and occasional interceptions.
 */
export function generateSequence(seed: number, options: SequenceOptions = {}): { phases: PassPhase[]; endsInShot: boolean } {
  const r = (n: number) => seededRand(seed * 7 + n);
  const homePossessionShare = Math.min(0.75, Math.max(0.25, options.homePossessionShare ?? 0.5));
  const isHome = options.attackingHome ?? r(0) < homePossessionShare;
  const formationName = (isHome ? options.homeFormation : options.awayFormation) ?? '4-3-3';
  const approach = (isHome ? options.homeApproach : options.awayApproach) ?? 'balanced';
  const formation = getTacticalFormationSlots(
    formationName,
    approach,
  );
  const playStyle = r(1);
  // A shot on the canvas must have an authoritative event behind it. Ordinary
  // possession therefore develops, switches, or recycles instead of creating
  // a visual shot that can never affect the score.
  const endsInShot = options.forceShot ?? false;
  const willIntercept = !endsInShot && r(3) < 0.18; // pass gets stolen

  if (options.setPiece) {
    return generateSetPieceSequence(seed, {
      attackingHome: isHome,
      setPiece: options.setPiece,
      side: options.setPieceSide,
      delivery: options.setPieceDelivery,
      forceShot: options.forceShot ?? false,
      shooterIdx: options.shooterIdx,
      creatorIdx: options.creatorIdx,
      formation,
    });
  }

  let route: number[];
  let pattern: PresentationPlayPattern;
  let passTargets: Array<{ x: number; y: number }>;
  let directedShotOrigin: { x: number; y: number } | undefined;
  let directedShotFlight: number | undefined;
  let directedCreatorIdx: number | undefined;
  let chanceStyle: PresentationChanceStyle | undefined;
  if (options.forceShot) {
    const forwards = roleIndices(formation, 'FW');
    const midfielders = roleIndices(formation, 'MF');
    const shooter = options.shooterIdx ?? forwards[Math.floor(r(19) * forwards.length)] ?? nearestSlot(formation, ['MF'], 0.5);
    const defaultCreator = midfielders[Math.floor(r(4) * midfielders.length)] ?? nearestSlot(formation, ['DF'], 0.5);
    const creator = options.creatorIdx !== undefined && options.creatorIdx !== shooter
      ? options.creatorIdx
      : defaultCreator === shooter ? (defaultCreator + 1) % 11 : defaultCreator;
    const shooterY = formation[shooter]?.y ?? 0.5;
    const styleRoll = r(15);
    chanceStyle = options.chanceStyle ?? (
      styleRoll < 0.24 ? 'cutback'
        : styleRoll < 0.48 ? 'cross'
          : styleRoll < 0.75 ? 'through_ball'
            : 'central'
    );
    const upperFlank = r(16) < 0.5;
    const shotProgress = chanceStyle === 'through_ball' || chanceStyle === 'cross'
      ? 0.85 + r(17) * 0.04
      : chanceStyle === 'cutback'
        ? 0.8 + r(17) * 0.045
        : 0.82 + r(17) * 0.05;
    const shotY = chanceStyle === 'central'
      ? Math.min(0.68, Math.max(0.32, shooterY + (r(18) - 0.5) * 0.1))
      : 0.42 + r(18) * 0.16;
    directedCreatorIdx = creator;
    const creatorLive = livePositionFor(options.playerPositions, creator, isHome);
    // The shot origin has to be somewhere the shooter can actually get to.
    //
    // It used to be a fixed spot in the box, chosen with no reference to where
    // the shooter was standing. The run-up was twenty frames, far too short to
    // cover the gap, and the release clamp then snapped them the rest of the
    // way in a single frame — the 19.9 m teleport. The origin is now pulled
    // back to within a sprint of the shooter and kept inside a range that is
    // still a shot worth taking.
    // The shot origin is NOT constrained by where the shooter is standing
    // when the move is planned. At that moment they are still in their
    // formation slot, fifty metres out; getting them into the box is the
    // whole point of the eight passes that follow. Pulling the origin back
    // to them here made every shot in the game a 39.9 m effort, and the
    // release-time retarget then dragged it out to seventy.
    //
    // Reachability is handled at the moment of release instead, where the
    // shooter has actually made the run.
    const rawOrigin = mirrorPoint({ x: shotProgress, y: shotY }, isHome);
    directedShotOrigin = {
      x: rawOrigin.x,
      y: clamp(rawOrigin.y, 0.14, 0.86),
    };
    const source = options.sourceOverride ?? (() => {
      const slot = formation[options.startingPlayerIdx ?? nearestSlot(formation, ['MF'], 0.5)];
      return { x: isHome ? slot.x : 1 - slot.x, y: slot.y };
    })();
    const startIdx = options.startingPlayerIdx
      ?? nearestSlotToPoint(formation, source, isHome, [creator, shooter]);
    const rawEntry = chanceEntryPoint(
      chanceStyle,
      upperFlank,
      isHome,
      source,
      directedShotOrigin,
      r,
    );
    // Same reachability rule for the creator: they have one pass plus its hold
    // to arrive, which is worth a little more ground than a build-up touch.
    const chanceEntry = reachableTarget(creatorLive, rawEntry, 0.05);
    // The move is the build-up plus the two passes the event names: the
    // creator receiving where the chance is made, then the ball the shooter
    // finishes. Everything before that is how the ball got there, which is
    // the half of the goal the two-pass route never drew.
    const approachPlan = buildDirectedApproach(
      formation,
      isHome,
      startIdx,
      source,
      chanceEntry,
      upperFlank,
      creator,
      shooter,
      r,
      options.playerPositions,
    );
    route = [startIdx, ...approachPlan.players, creator, shooter];
    passTargets = [...approachPlan.targets, chanceEntry, directedShotOrigin];
    // Shot flight follows the real distance too. It used to be a flat 26-40
    // frames whether the ball was travelling seven metres or thirty, which
    // put a struck shot at 76-154 m/s — three to five times a real one, and
    // fast enough to cross the screen in a couple of frames.
    const shotTravelMeters = Math.hypot(
      (isHome ? 1 - directedShotOrigin.x : directedShotOrigin.x) * 105,
      (directedShotOrigin.y - 0.5) * 68,
    );
    directedShotFlight = passFlightFrames(
      shotTravelMeters,
      chanceStyle === 'cross' ? HEADER_SPEED_MPS : STRIKE_SPEED_MPS,
      r(31),
    );
    const directedShotProgress = isHome ? directedShotOrigin.x : 1 - directedShotOrigin.x;
    const sourceProgress = isHome ? source.x : 1 - source.x;
    pattern = options.transition
      ? 'counter'
      : chanceStyle === 'cross' || chanceStyle === 'cutback'
        ? 'wing_overload'
        : chanceStyle === 'through_ball' || directedShotProgress - sourceProgress > 0.35
          ? 'counter'
          : 'central_combination';
  } else {
    const plan = buildOpenPlayPlan(
      seed,
      isHome,
      playStyle,
      options.startingPlayerIdx,
      options.sourceOverride,
      options.transition ?? false,
      formation,
      formationName,
      approach,
    );
    route = plan.route;
    pattern = plan.pattern;
    passTargets = plan.targets;
  }

  // Whoever the route ends with is the player who strikes the chance. They
  // need to know that from the first phase so they can make the run.
  const directedShooterIdx = options.forceShot && directedShotOrigin
    ? route[route.length - 1]
    : undefined;

  const phases: PassPhase[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    const target = passTargets[i] ?? buildPassTarget(route[i + 1], isHome, r(i + 41), false, formation);
    const previousTarget = i === 0
      ? options.sourceOverride
      : passTargets[i - 1];
    const source = previousTarget ?? (() => {
      const slot = formation[route[i]] ?? formation[nearestSlot(formation, ['MF'], 0.5)];
      return { x: isHome ? slot.x : 1 - slot.x, y: slot.y };
    })();
    const travel = Math.hypot(target.x - source.x, target.y - source.y);
    // The pitch is 105 m by 68 m, so the two normalized axes are not the same
    // distance. Flight time needs real metres, not a mixed-unit hypotenuse.
    const travelMeters = Math.hypot(
      (target.x - source.x) * 105,
      (target.y - source.y) * 68,
    );
    const isLastPass = i === route.length - 2;
    const directedDelivery = Boolean(options.forceShot && isLastPass && chanceStyle);
    // The pass that sets the chance up: the creator receiving in the area
    // the chance is built from. Longer than a build-up touch, shorter than
    // the delivery itself.
    const directedSetup = Boolean(options.forceShot && chanceStyle && i === route.length - 3);
    const directedDuration = passFlightFrames(
      travelMeters,
      passSpeedMps(
        travelMeters,
        chanceStyle === 'cross' ? CROSS_CEILING_MPS : DELIVERY_CEILING_MPS,
      ),
      r(i + 10),
    );
    // Only the delivery keeps a hand-tuned arc. Every other pass in the
    // move goes through the same distance ramp as open play, so a short
    // build-up touch stays on the grass and a switch of play lifts.
    const directedArc = chanceStyle === 'cross'
      ? 0.62 + r(i + 13) * 0.22
      : chanceStyle === 'through_ball'
        ? 0.08 + r(i + 13) * 0.12
        : chanceStyle === 'cutback'
          ? r(i + 13) * 0.06
          : 0.04 + r(i + 13) * 0.12;
    phases.push({
      passerIdx: route[i],
      receiverIdx: route[i + 1],
      ...(directedCreatorIdx !== undefined ? { creatorIdx: directedCreatorIdx } : {}),
      // The shooter runs at the strike point for the whole move, not just for
      // the last pass. Without this they only start moving when the final ball
      // is played, which is half a second from thirty metres out.
      ...(directedShooterIdx !== undefined
        ? { shooterIdx: directedShooterIdx, shotOrigin: directedShotOrigin }
        : {}),
      // The last two passes are the chance itself: the creator receiving where
      // the event says, then the ball the shooter finishes. Neither may be
      // redirected to whoever happens to be free.
      ...(directedDelivery || directedSetup ? { lockedReceiver: true } : {}),
      attackingHome: isHome,
      kind: 'pass',
      pattern,
      stage: stageForPass(pattern, i, route.length - 1),
      chanceStyle,
      speedCeilingMps: options.forceShot
        ? directedDelivery
          ? (chanceStyle === 'cross' ? CROSS_CEILING_MPS : DELIVERY_CEILING_MPS)
          : DIRECTED_PASS_CEILING_MPS
        : OPEN_PLAY_PASS_CEILING_MPS,
      duration: options.forceShot
        ? directedDelivery
          ? directedDuration
          : passFlightFrames(
              travelMeters,
              passSpeedMps(travelMeters, DIRECTED_PASS_CEILING_MPS),
              directedSetup ? r(i + 10) : r(i + 11),
            )
        : openPlayDuration(travelMeters, r(i + 11)),
      hold: options.forceShot
        ? directedDelivery
          ? 16 + r(i + 12) * 8
          : directedSetup
            ? 13 + r(i + 12) * 8
            : 9 + r(i + 12) * 7
        : isLastPass ? 18 + r(i + 12) * 18 : 26 + r(i + 12) * 30,
      arc: directedDelivery ? directedArc : passArc(travel, pattern, r(i + 13)),
      intercepted: willIntercept && i === route.length - 2, // last pass gets stolen
      ...(i === 0 && options.startingPlayerIdx !== undefined && {
        releaseDelayFrames: options.restart
          ? restartReleaseDelay(options.restart)
          : options.transition ? 18 : 12,
      }),
      ...(i === 0 && options.restart ? { restart: options.restart } : {}),
      ...(i === 0 && options.sourceOverride ? { sourceOverride: options.sourceOverride } : {}),
      targetOverride: target,
    });
  }

  if (endsInShot) {
    const shooterIdx = route[route.length - 1];
    phases.push({
      passerIdx: shooterIdx,
      receiverIdx: shooterIdx,
      lockedReceiver: true,
      attackingHome: isHome,
      kind: 'shot',
      pattern,
      stage: 'finish',
      chanceStyle,
      duration: options.forceShot
        ? directedShotFlight ?? (chanceStyle === 'cross' ? 26 + r(31) * 7 : 31 + r(31) * 9)
        : 32 + r(31) * 12,
      hold: options.forceShot ? 20 + r(32) * 8 : 16 + r(32) * 8,
      arc: 0.04 + r(33) * 0.16,
      swerve: (r(34) - 0.5) * (options.forceShot ? 0.9 : 0.65),
      intercepted: false,
      // A striker takes a touch and sets themselves before striking. Fourteen
      // frames is a quarter of a second, which is the ball leaving the foot
      // the instant it arrives.
      releaseDelayFrames: options.forceShot ? 26 + r(35) * 10 : 10,
      ...(directedShotOrigin ? { sourceOverride: directedShotOrigin } : {}),
    });
  }
  return { phases, endsInShot };
}

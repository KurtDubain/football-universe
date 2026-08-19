// Pass-sequence generator. Pure: same seed → same output; no canvas / refs.
import { seededRand } from './math';
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
}

export function restartReleaseDelay(restart: PresentationRestart): number {
  if (restart === 'kickoff') return 30;
  if (restart === 'goal_kick') return 24;
  if (restart === 'keeper_release') return 22;
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
  let chanceStyle: PresentationChanceStyle | undefined;
  if (options.forceShot) {
    const forwards = roleIndices(formation, 'FW');
    const midfielders = roleIndices(formation, 'MF');
    const shooter = options.shooterIdx ?? forwards[Math.floor(r(19) * forwards.length)] ?? nearestSlot(formation, ['MF'], 0.5);
    const defaultCreator = midfielders[Math.floor(r(4) * midfielders.length)] ?? nearestSlot(formation, ['DF'], 0.5);
    const creator = options.creatorIdx !== undefined && options.creatorIdx !== shooter
      ? options.creatorIdx
      : defaultCreator === shooter ? (defaultCreator + 1) % 11 : defaultCreator;
    route = [options.startingPlayerIdx, creator, shooter]
      .filter((slot): slot is number => slot !== undefined)
      .filter((slot, index, slots) => index === 0 || slot !== slots[index - 1]);
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
    directedShotOrigin = mirrorPoint({ x: shotProgress, y: shotY }, isHome);
    const source = options.sourceOverride ?? (() => {
      const slot = formation[route[0]] ?? formation[nearestSlot(formation, ['MF'], 0.5)];
      return { x: isHome ? slot.x : 1 - slot.x, y: slot.y };
    })();
    const directedShotProgress = isHome ? directedShotOrigin.x : 1 - directedShotOrigin.x;
    const sourceProgress = isHome ? source.x : 1 - source.x;
    pattern = options.transition
      ? 'counter'
      : chanceStyle === 'cross' || chanceStyle === 'cutback'
        ? 'wing_overload'
        : chanceStyle === 'through_ball' || directedShotProgress - sourceProgress > 0.35
          ? 'counter'
          : 'central_combination';
    passTargets = route.slice(1).map((receiverIdx, index) => {
      const t = (index + 1) / Math.max(1, route.length - 1);
      if (index === route.length - 2) return directedShotOrigin!;
      if (chanceStyle === 'cross') {
        return mirrorPoint({
          x: 0.76 + r(21 + index) * 0.05,
          y: upperFlank ? 0.13 : 0.87,
        }, isHome);
      }
      if (chanceStyle === 'cutback') {
        return mirrorPoint({
          x: 0.87 + r(21 + index) * 0.035,
          y: upperFlank ? 0.18 : 0.82,
        }, isHome);
      }
      if (chanceStyle === 'through_ball') {
        return mirrorPoint({
          x: 0.66 + r(21 + index) * 0.06,
          y: 0.42 + (r(24 + index) - 0.5) * 0.16,
        }, isHome);
      }
      const receiverY = formation[receiverIdx]?.y ?? directedShotOrigin!.y;
      return {
        x: source.x + (directedShotOrigin!.x - source.x) * t,
        y: source.y + (directedShotOrigin!.y - source.y) * t * 0.72 + (receiverY - 0.5) * 0.06,
      };
    });
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
    const longBall = Math.hypot(target.x - source.x, target.y - source.y) > 0.34;
    const isLastPass = i === route.length - 2;
    const directedDelivery = Boolean(options.forceShot && isLastPass && chanceStyle);
    const directedDuration = chanceStyle === 'cross'
      ? 44 + r(i + 10) * 8
      : chanceStyle === 'through_ball'
        ? 34 + r(i + 10) * 7
        : chanceStyle === 'cutback'
          ? 27 + r(i + 10) * 6
          : 30 + r(i + 10) * 7;
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
      attackingHome: isHome,
      kind: 'pass',
      pattern,
      stage: stageForPass(pattern, i, route.length - 1),
      chanceStyle,
      duration: options.forceShot
        ? directedDelivery ? directedDuration : (longBall ? 34 + r(i + 10) * 7 : 27 + r(i + 11) * 7)
        : longBall ? 70 + r(i + 10) * 25 : 42 + r(i + 11) * 20,
      hold: options.forceShot
        ? 7 + r(i + 12) * 4
        : isLastPass ? 18 + r(i + 12) * 18 : 26 + r(i + 12) * 30,
      arc: directedDelivery ? directedArc : longBall ? 0.55 + r(i + 13) * 0.4 : r(i + 13) * 0.18,
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
      attackingHome: isHome,
      kind: 'shot',
      pattern,
      stage: 'finish',
      chanceStyle,
      duration: options.forceShot
        ? chanceStyle === 'cross' ? 26 + r(31) * 7 : 31 + r(31) * 9
        : 32 + r(31) * 12,
      hold: options.forceShot ? 20 + r(32) * 8 : 16 + r(32) * 8,
      arc: 0.04 + r(33) * 0.16,
      swerve: (r(34) - 0.5) * (options.forceShot ? 0.9 : 0.65),
      intercepted: false,
      releaseDelayFrames: options.forceShot ? 14 : 10,
      ...(directedShotOrigin ? { sourceOverride: directedShotOrigin } : {}),
    });
  }
  return { phases, endsInShot };
}

// Pass-sequence generator. Pure: same seed → same output; no canvas / refs.
import { seededRand } from './math';
import { generateSetPieceSequence } from './set-pieces';
import {
  BASE_FORMATION,
  type PassPhase,
  type PresentationPlayPattern,
  type PresentationPlayStage,
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
): PresentationPlayPattern {
  if (transition) return 'counter';
  const startingRole = startingPlayerIdx === undefined ? undefined : BASE_FORMATION[startingPlayerIdx]?.role;
  if (startingRole === 'FW') return 'recycle';
  if (playStyle < 0.2) return 'build_up';
  if (playStyle < 0.42) return 'wing_overload';
  if (playStyle < 0.62) return 'central_combination';
  if (playStyle < 0.84) return 'switch_play';
  return 'recycle';
}

function routeForPattern(
  pattern: PresentationPlayPattern,
  startingPlayerIdx: number | undefined,
  upperFlank: boolean,
): number[] {
  const fullback = upperFlank ? 1 : 4;
  const centerBack = upperFlank ? 2 : 3;
  const midfielder = upperFlank ? 5 : 7;
  const otherMidfielder = upperFlank ? 7 : 5;
  const winger = upperFlank ? 8 : 10;
  const oppositeWinger = upperFlank ? 10 : 8;

  if (startingPlayerIdx !== undefined) {
    const role = BASE_FORMATION[startingPlayerIdx]?.role;
    if (pattern === 'counter') {
      return compactRoute(role === 'FW'
        ? [startingPlayerIdx, startingPlayerIdx === 9 ? winger : 9]
        : [startingPlayerIdx, winger, 9]);
    }
    if (role === 'FW') return compactRoute([startingPlayerIdx, midfielder, 6, oppositeWinger]);
    if (role === 'MF') {
      return compactRoute(pattern === 'switch_play'
        ? [startingPlayerIdx, otherMidfielder, oppositeWinger]
        : [startingPlayerIdx, winger, 9]);
    }
    return compactRoute([startingPlayerIdx, 6, midfielder, winger]);
  }

  switch (pattern) {
    case 'build_up': return [centerBack, 6, midfielder, winger];
    case 'wing_overload': return [centerBack, midfielder, fullback, winger];
    case 'central_combination': return [centerBack, 6, midfielder, 9];
    case 'switch_play': return [fullback, centerBack, 6, otherMidfielder, oppositeWinger];
    case 'counter': return [6, winger, 9];
    case 'recycle': return [winger, midfielder, centerBack, upperFlank ? 3 : 2, upperFlank ? 4 : 1];
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
): { x: number; y: number } {
  const t = (step + 1) / Math.max(1, stepCount);
  const sourceProgress = attackingHome ? source.x : 1 - source.x;
  const flankY = upperFlank ? 0.18 : 0.82;
  const oppositeY = 1 - flankY;
  const receiverY = BASE_FORMATION[receiverIdx]?.y ?? 0.5;
  let progress: number;
  let y: number;

  switch (pattern) {
    case 'build_up': {
      const start = Math.max(0.24, Math.min(sourceProgress + 0.04, 0.42));
      progress = start + (0.68 - start) * t;
      y = receiverY * 0.72 + flankY * 0.28;
      break;
    }
    case 'wing_overload': {
      const start = Math.max(0.32, Math.min(sourceProgress, 0.5));
      progress = start + (0.78 - start) * t;
      y = flankY * 0.72 + receiverY * 0.28;
      break;
    }
    case 'central_combination': {
      const start = Math.max(0.34, Math.min(sourceProgress, 0.5));
      progress = start + (0.79 - start) * t;
      y = 0.5 * 0.72 + receiverY * 0.28;
      break;
    }
    case 'switch_play': {
      const start = Math.max(0.28, Math.min(sourceProgress - 0.03, 0.48));
      progress = start + (0.7 - start) * t;
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
): OpenPlayPlan {
  const upperFlank = seededRand(seed * 13 + 19) < 0.5;
  const pattern = selectPattern(playStyle, startingPlayerIdx, transition);
  const route = routeForPattern(pattern, startingPlayerIdx, upperFlank);
  const source = sourceOverride ?? (() => {
    const slot = BASE_FORMATION[route[0]] ?? BASE_FORMATION[6];
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
  ));
  return { pattern, route, targets };
}

export function buildPassTarget(
  receiverIdx: number,
  attackingHome: boolean,
  seedValue: number,
  longBall: boolean,
): { x: number; y: number } {
  const slot = BASE_FORMATION[receiverIdx] ?? BASE_FORMATION[6];
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
    });
  }

  let route: number[];
  let pattern: PresentationPlayPattern;
  let passTargets: Array<{ x: number; y: number }>;
  let directedShotOrigin: { x: number; y: number } | undefined;
  if (options.forceShot) {
    const shooter = options.shooterIdx ?? (8 + Math.floor(r(19) * 3));
    const defaultCreator = 5 + Math.floor(r(4) * 3);
    const creator = options.creatorIdx !== undefined && options.creatorIdx !== shooter
      ? options.creatorIdx
      : defaultCreator === shooter ? (defaultCreator + 1) % 11 : defaultCreator;
    route = [options.startingPlayerIdx, creator, shooter]
      .filter((slot): slot is number => slot !== undefined)
      .filter((slot, index, slots) => index === 0 || slot !== slots[index - 1]);
    const shooterY = BASE_FORMATION[shooter]?.y ?? 0.5;
    directedShotOrigin = {
      x: isHome ? 0.8 + r(17) * 0.07 : 0.2 - r(17) * 0.07,
      y: Math.min(0.78, Math.max(0.22, shooterY + (r(18) - 0.5) * 0.12)),
    };
    const source = options.sourceOverride ?? (() => {
      const slot = BASE_FORMATION[route[0]] ?? BASE_FORMATION[6];
      return { x: isHome ? slot.x : 1 - slot.x, y: slot.y };
    })();
    const shotProgress = isHome ? directedShotOrigin.x : 1 - directedShotOrigin.x;
    const sourceProgress = isHome ? source.x : 1 - source.x;
    pattern = Math.abs(directedShotOrigin.y - 0.5) > 0.16
      ? 'wing_overload'
      : shotProgress - sourceProgress > 0.35
        ? 'counter'
        : 'central_combination';
    passTargets = route.slice(1).map((receiverIdx, index) => {
      const t = (index + 1) / Math.max(1, route.length - 1);
      if (index === route.length - 2) return directedShotOrigin!;
      const receiverY = BASE_FORMATION[receiverIdx]?.y ?? directedShotOrigin!.y;
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
    );
    route = plan.route;
    pattern = plan.pattern;
    passTargets = plan.targets;
  }

  const phases: PassPhase[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    const target = passTargets[i] ?? buildPassTarget(route[i + 1], isHome, r(i + 41), false);
    const previousTarget = i === 0
      ? options.sourceOverride
      : passTargets[i - 1];
    const source = previousTarget ?? (() => {
      const slot = BASE_FORMATION[route[i]] ?? BASE_FORMATION[6];
      return { x: isHome ? slot.x : 1 - slot.x, y: slot.y };
    })();
    const longBall = Math.hypot(target.x - source.x, target.y - source.y) > 0.34;
    const isLastPass = i === route.length - 2;
    phases.push({
      passerIdx: route[i],
      receiverIdx: route[i + 1],
      attackingHome: isHome,
      kind: 'pass',
      pattern,
      stage: stageForPass(pattern, i, route.length - 1),
      duration: options.forceShot
        ? (longBall ? 24 + r(i + 10) * 8 : 18 + r(i + 11) * 6)
        : longBall ? 70 + r(i + 10) * 25 : 42 + r(i + 11) * 20,
      hold: options.forceShot
        ? 4 + r(i + 12) * 3
        : isLastPass ? 18 + r(i + 12) * 18 : 26 + r(i + 12) * 30,
      arc: longBall ? 0.55 + r(i + 13) * 0.4 : r(i + 13) * 0.18,
      intercepted: willIntercept && i === route.length - 2, // last pass gets stolen
      ...(i === 0 && options.startingPlayerIdx !== undefined && { releaseDelayFrames: 10 }),
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
      duration: options.forceShot ? 24 + r(31) * 6 : 28 + r(31) * 12,
      hold: 12 + r(32) * 8,
      arc: 0.04 + r(33) * 0.16,
      swerve: (r(34) - 0.5) * (options.forceShot ? 0.9 : 0.65),
      intercepted: false,
      ...(directedShotOrigin ? { sourceOverride: directedShotOrigin } : {}),
    });
  }
  return { phases, endsInShot };
}

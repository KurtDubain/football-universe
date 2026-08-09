// Pass-sequence generator. Pure: same seed → same output; no canvas / refs.
import { seededRand } from './math';
import { generateSetPieceSequence } from './set-pieces';
import { BASE_FORMATION, type PassPhase, type PresentationSetPiece } from './types';

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
}

function turnoverRoute(startingPlayerIdx: number, seedValue: number): number[] {
  const role = BASE_FORMATION[startingPlayerIdx]?.role;
  if (role === 'GK' || role === 'DF') {
    return [startingPlayerIdx, 5 + Math.floor(seedValue * 3), 8 + Math.floor(seededRand(startingPlayerIdx + 91) * 3)];
  }
  if (role === 'MF') return [startingPlayerIdx, 8 + Math.floor(seedValue * 3)];
  return [startingPlayerIdx, startingPlayerIdx === 9 ? 8 : 9];
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
  const endsInShot = options.forceShot ?? r(2) < 0.30;
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
  let directedShotOrigin: { x: number; y: number } | undefined;
  if (options.forceShot && options.shooterIdx !== undefined) {
    const defaultCreator = 5 + Math.floor(r(4) * 3);
    const creator = options.creatorIdx !== undefined && options.creatorIdx !== options.shooterIdx
      ? options.creatorIdx
      : defaultCreator === options.shooterIdx ? (defaultCreator + 1) % 11 : defaultCreator;
    route = [options.startingPlayerIdx, creator, options.shooterIdx]
      .filter((slot): slot is number => slot !== undefined)
      .filter((slot, index, slots) => index === 0 || slot !== slots[index - 1]);
    const shooterY = BASE_FORMATION[options.shooterIdx]?.y ?? 0.5;
    directedShotOrigin = {
      x: isHome ? 0.8 + r(17) * 0.07 : 0.2 - r(17) * 0.07,
      y: Math.min(0.78, Math.max(0.22, shooterY + (r(18) - 0.5) * 0.12)),
    };
  } else if (options.startingPlayerIdx !== undefined) {
    route = turnoverRoute(options.startingPlayerIdx, r(4));
  } else if (options.forceShot) {
    const directedRoutes = [[5, 8], [6, 9], [7, 10]];
    route = directedRoutes[Math.floor(r(4) * directedRoutes.length)];
  } else if (playStyle < 0.18) {
    route = isHome ? [0, 2, 6, 9, 10] : [0, 3, 7, 10, 9];
  } else if (playStyle < 0.36) {
    route = isHome ? [3, 7, 10] : [2, 6, 9];
  } else if (playStyle < 0.54) {
    route = isHome ? [1, 5, 8, 9] : [4, 8, 5, 10];
  } else if (playStyle < 0.72) {
    route = isHome ? [6, 7, 5, 9] : [7, 6, 8, 10];
  } else if (playStyle < 0.88) {
    route = isHome ? [3, 2, 6, 5, 7] : [2, 3, 7, 6, 8];
  } else {
    // Long ball forward
    route = isHome ? [0, 9] : [0, 10];
  }

  const phases: PassPhase[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    const distance = Math.abs(route[i + 1] - route[i]);
    const longBall = distance >= 4 || r(i + 5) < 0.15;
    const isLastPass = i === route.length - 2;
    const naturalTarget = buildPassTarget(route[i + 1], isHome, r(i + 41), longBall);
    phases.push({
      passerIdx: route[i],
      receiverIdx: route[i + 1],
      attackingHome: isHome,
      kind: 'pass',
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
      targetOverride: isLastPass && directedShotOrigin ? directedShotOrigin : naturalTarget,
    });
  }

  if (endsInShot) {
    const shooterIdx = route[route.length - 1];
    phases.push({
      passerIdx: shooterIdx,
      receiverIdx: shooterIdx,
      attackingHome: isHome,
      kind: 'shot',
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

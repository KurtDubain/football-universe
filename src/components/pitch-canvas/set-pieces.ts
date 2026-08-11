import { seededRand } from './math';
import { BASE_FORMATION, type FormationSlot, type PassPhase, type PresentationSetPiece, type Role } from './types';

export interface SetPieceSequenceOptions {
  attackingHome: boolean;
  setPiece: PresentationSetPiece;
  side?: 'left' | 'right' | 'central';
  delivery?: 'near_post' | 'far_post' | 'central' | 'cutback' | 'direct';
  forceShot: boolean;
  shooterIdx?: number;
  creatorIdx?: number;
  formation?: FormationSlot[];
}

function closestSlot(formation: FormationSlot[], role: Role, targetY: number): number {
  return formation
    .map((slot, index) => ({ slot, index }))
    .filter(entry => entry.slot.role === role)
    .sort((left, right) => Math.abs(left.slot.y - targetY) - Math.abs(right.slot.y - targetY)
      || left.index - right.index)[0]?.index ?? 6;
}

export function generateSetPieceSequence(
  seed: number,
  options: SetPieceSequenceOptions,
): { phases: PassPhase[]; endsInShot: boolean } {
  const r = (salt: number) => seededRand(seed * 11 + salt);
  const formation = options.formation ?? BASE_FORMATION;
  const attackDirection = options.attackingHome ? 1 : -1;
  const goalX = options.attackingHome ? 0.985 : 0.015;

  if (options.setPiece === 'penalty') {
    const shooterIdx = options.shooterIdx ?? closestSlot(formation, 'FW', 0.5);
    return {
      endsInShot: true,
      phases: [{
        passerIdx: shooterIdx,
        receiverIdx: shooterIdx,
        attackingHome: options.attackingHome,
        kind: 'shot',
        duration: 72,
        releaseDelayFrames: 48,
        hold: 20,
        arc: 0.05,
        swerve: (r(34) - 0.5) * 0.25,
        intercepted: false,
        setPiece: 'penalty',
        sourceOverride: { x: options.attackingHome ? 0.88 : 0.12, y: 0.5 },
      }],
    };
  }

  const side = options.side === 'central' || !options.side
    ? (r(1) < 0.5 ? 'left' : 'right')
    : options.side;

  if (options.setPiece === 'direct_free_kick') {
    const takerIdx = options.shooterIdx ?? options.creatorIdx ?? closestSlot(formation, 'MF', 0.5);
    const source = {
      x: options.attackingHome ? 0.76 + r(2) * 0.06 : 0.24 - r(2) * 0.06,
      y: 0.42 + r(3) * 0.16,
    };
    const blockedTarget = {
      x: source.x + attackDirection * 0.11,
      y: source.y + (r(4) - 0.5) * 0.06,
    };
    return {
      endsInShot: options.forceShot,
      phases: [{
        passerIdx: takerIdx,
        receiverIdx: takerIdx,
        attackingHome: options.attackingHome,
        kind: options.forceShot ? 'shot' : 'pass',
        duration: options.forceShot ? 112 : 104,
        releaseDelayFrames: 84,
        hold: options.forceShot ? 20 : 26,
        arc: options.forceShot ? 0.2 : 0.35,
        swerve: options.forceShot ? (r(5) - 0.5) * 1.1 : undefined,
        intercepted: false,
        setPiece: 'direct_free_kick',
        sourceOverride: source,
        ...(!options.forceShot && { targetOverride: blockedTarget }),
      }],
    };
  }

  const isCorner = options.setPiece === 'corner';
  const fallbackTaker = closestSlot(formation, 'MF', side === 'left' ? 0.22 : 0.78);
  const takerIdx = options.creatorIdx ?? fallbackTaker;
  const shooterIdx = options.shooterIdx ?? closestSlot(formation, 'FW', 0.42 + r(6) * 0.16);
  const sourceX = isCorner
    ? (options.attackingHome ? 0.965 : 0.035)
    : (options.attackingHome ? 0.72 + r(7) * 0.05 : 0.28 - r(7) * 0.05);
  const sourceY = side === 'left' ? (isCorner ? 0.055 : 0.18) : (isCorner ? 0.945 : 0.82);
  const delivery = options.delivery ?? 'central';
  const targetY = delivery === 'near_post'
    ? (side === 'left' ? 0.39 : 0.61)
    : delivery === 'far_post'
      ? (side === 'left' ? 0.62 : 0.38)
      : delivery === 'cutback'
        ? 0.5 + (r(8) - 0.5) * 0.12
        : 0.46 + r(8) * 0.08;
  const deliveryTarget = {
    x: options.attackingHome ? (delivery === 'cutback' ? 0.82 : 0.89) : (delivery === 'cutback' ? 0.18 : 0.11),
    y: targetY,
  };
  const deliveryPhase: PassPhase = {
    passerIdx: takerIdx,
    receiverIdx: shooterIdx,
    attackingHome: options.attackingHome,
    kind: 'pass',
    duration: isCorner ? 102 : 92,
    releaseDelayFrames: isCorner ? 70 : 62,
    hold: options.forceShot ? 8 : 24,
    arc: isCorner ? 0.92 : 0.76,
    intercepted: false,
    setPiece: options.setPiece,
    sourceOverride: { x: sourceX, y: sourceY },
    targetOverride: deliveryTarget,
  };
  if (!options.forceShot) return { phases: [deliveryPhase], endsInShot: false };

  return {
    endsInShot: true,
    phases: [
      deliveryPhase,
      {
        passerIdx: shooterIdx,
        receiverIdx: shooterIdx,
        attackingHome: options.attackingHome,
        kind: 'shot',
        duration: 30,
        releaseDelayFrames: 6,
        hold: 18,
        arc: 0.08 + r(9) * 0.14,
        swerve: (r(10) - 0.5) * 0.45,
        intercepted: false,
        setPiece: options.setPiece,
        sourceOverride: deliveryTarget,
        targetOverride: { x: goalX, y: 0.43 + r(11) * 0.14 },
      },
    ],
  };
}

export function setPiecePlayerTarget(
  playerIndex: number,
  isHomeTeam: boolean,
  role: Role,
  phase: PassPhase,
  formation: FormationSlot[] = BASE_FORMATION,
): { x: number; y: number } | undefined {
  if (!phase.setPiece) return undefined;
  const formIdx = playerIndex % 11;
  const attackingTeam = isHomeTeam === phase.attackingHome;
  const attackDirection = phase.attackingHome ? 1 : -1;
  const ownGoalX = isHomeTeam ? 0.03 : 0.97;
  const attackGoalX = phase.attackingHome ? 0.97 : 0.03;
  const source = phase.sourceOverride ?? formation[phase.passerIdx];
  const roleIndices = formation.flatMap((slot, index) => slot.role === role ? [index] : []);
  const roleRank = Math.max(0, roleIndices.indexOf(formIdx));

  if (phase.setPiece === 'penalty') {
    if (attackingTeam) {
      if (formIdx === phase.passerIdx) return source;
      return { x: 0.5 - attackDirection * 0.07, y: formation[formIdx].y };
    }
    if (role === 'GK') return { x: ownGoalX, y: 0.5 };
    return { x: 0.5 + attackDirection * 0.07, y: formation[formIdx].y };
  }

  if (phase.setPiece === 'direct_free_kick') {
    if (attackingTeam) {
      if (formIdx === phase.passerIdx) return source;
      if (role === 'FW') return { x: source.x - attackDirection * 0.04, y: formation[formIdx].y };
      return undefined;
    }
    if (role === 'GK') return { x: ownGoalX, y: 0.5 + (source.y - 0.5) * 0.18 };
    if (role === 'DF') {
      const wallRank = Math.max(0, Math.min(3, roleRank));
      return {
        x: source.x + attackDirection * 0.075,
        y: source.y + (wallRank - 1.5) * 0.035,
      };
    }
    return undefined;
  }

  if (attackingTeam) {
    if (formIdx === phase.passerIdx) return source;
    if (role === 'GK') return undefined;
    if (role === 'DF') return {
      x: attackGoalX - attackDirection * (0.34 + (formIdx % 2) * 0.05),
      y: formation[formIdx].y,
    };
    const lane = 0.28 + ((formIdx * 7) % 5) * 0.11;
    return {
      x: attackGoalX - attackDirection * (0.07 + ((formIdx * 7) % 3) * 0.025),
      y: Math.max(0.24, Math.min(0.76, lane)),
    };
  }

  if (role === 'GK') return { x: ownGoalX, y: 0.5 };
  if (role === 'FW') return {
    x: ownGoalX + (isHomeTeam ? 0.3 : -0.3),
    y: formation[formIdx].y,
  };
  const laneRank = roleRank;
  const laneCount = Math.max(1, roleIndices.length);
  return {
    x: ownGoalX + (isHomeTeam ? 0.07 + (laneRank % 2) * 0.025 : -0.07 - (laneRank % 2) * 0.025),
    y: Math.max(0.24, Math.min(0.76, 0.28 + (laneRank / Math.max(1, laneCount - 1)) * 0.44)),
  };
}

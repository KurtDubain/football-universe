// Shared types, formation coordinates, and bounded presentation transforms for
// the PitchCanvas pipeline. Authoritative match effects live in the engine.

import type {
  PresentationChanceStyle,
  PresentationPlayStage,
  PresentationRestart,
  PresentationSetPiece,
} from '../../types/match-presentation';
import type { CoachFormation, MatchApproach } from '../../types/coach';

export type {
  MatchPresentationAtmosphere,
  MatchPresentationCue,
  PresentationChanceStyle,
  PresentationPlayStage,
  PresentationRestart,
  PresentationSetPiece,
} from '../../types/match-presentation';

export type Role = 'GK' | 'DF' | 'MF' | 'FW';
export type PresentationPlayPattern =
  | 'build_up'
  | 'wing_overload'
  | 'central_combination'
  | 'switch_play'
  | 'counter'
  | 'recycle';

export interface FormationSlot {
  x: number;
  y: number;
  role: Role;
}

// Rendering coordinates are intentionally owned by the Canvas layer. The
// enum and role counts match the authoritative match formation, while these
// normalized points only describe how that shape reads on a top-down pitch.
export const FORMATION_LAYOUTS: Record<CoachFormation, FormationSlot[]> = {
  '4-3-3': [
    { x: 0.07, y: 0.5, role: 'GK' },
    { x: 0.22, y: 0.13, role: 'DF' }, { x: 0.20, y: 0.37, role: 'DF' },
    { x: 0.20, y: 0.63, role: 'DF' }, { x: 0.22, y: 0.87, role: 'DF' },
    { x: 0.37, y: 0.24, role: 'MF' }, { x: 0.34, y: 0.50, role: 'MF' },
    { x: 0.37, y: 0.76, role: 'MF' },
    { x: 0.52, y: 0.18, role: 'FW' }, { x: 0.55, y: 0.50, role: 'FW' },
    { x: 0.52, y: 0.82, role: 'FW' },
  ],
  '4-2-3-1': [
    { x: 0.07, y: 0.5, role: 'GK' },
    { x: 0.22, y: 0.13, role: 'DF' }, { x: 0.20, y: 0.37, role: 'DF' },
    { x: 0.20, y: 0.63, role: 'DF' }, { x: 0.22, y: 0.87, role: 'DF' },
    { x: 0.33, y: 0.35, role: 'MF' }, { x: 0.33, y: 0.65, role: 'MF' },
    { x: 0.46, y: 0.16, role: 'MF' }, { x: 0.44, y: 0.50, role: 'MF' },
    { x: 0.46, y: 0.84, role: 'MF' },
    { x: 0.57, y: 0.50, role: 'FW' },
  ],
  '4-4-2': [
    { x: 0.07, y: 0.5, role: 'GK' },
    { x: 0.22, y: 0.13, role: 'DF' }, { x: 0.20, y: 0.37, role: 'DF' },
    { x: 0.20, y: 0.63, role: 'DF' }, { x: 0.22, y: 0.87, role: 'DF' },
    { x: 0.37, y: 0.14, role: 'MF' }, { x: 0.35, y: 0.39, role: 'MF' },
    { x: 0.35, y: 0.61, role: 'MF' }, { x: 0.37, y: 0.86, role: 'MF' },
    { x: 0.54, y: 0.36, role: 'FW' }, { x: 0.54, y: 0.64, role: 'FW' },
  ],
  '5-4-1': [
    { x: 0.07, y: 0.5, role: 'GK' },
    { x: 0.21, y: 0.09, role: 'DF' }, { x: 0.19, y: 0.30, role: 'DF' },
    { x: 0.18, y: 0.50, role: 'DF' }, { x: 0.19, y: 0.70, role: 'DF' },
    { x: 0.21, y: 0.91, role: 'DF' },
    { x: 0.36, y: 0.14, role: 'MF' }, { x: 0.34, y: 0.39, role: 'MF' },
    { x: 0.34, y: 0.61, role: 'MF' }, { x: 0.36, y: 0.86, role: 'MF' },
    { x: 0.54, y: 0.50, role: 'FW' },
  ],
};

export function getFormationSlots(formation: CoachFormation = '4-3-3'): FormationSlot[] {
  return FORMATION_LAYOUTS[formation] ?? FORMATION_LAYOUTS['4-3-3'];
}

/** Presentation-only posture derived from the frozen authoritative approach. */
export function getTacticalFormationSlots(
  formation: CoachFormation = '4-3-3',
  approach: MatchApproach = 'balanced',
): FormationSlot[] {
  const base = getFormationSlots(formation);
  if (approach === 'balanced') return base;
  return base.map(slot => {
    if (slot.role === 'GK') return slot;
    const depth = approach === 'pressing'
      ? slot.role === 'FW' ? 0.026 : slot.role === 'MF' ? 0.03 : 0.018
      : approach === 'control'
        ? slot.role === 'MF' ? 0.022 : 0.008
        : approach === 'counter'
          ? slot.role === 'FW' ? 0.012 : slot.role === 'MF' ? -0.024 : -0.016
          : slot.role === 'FW' ? -0.014 : slot.role === 'MF' ? -0.036 : -0.028;
    const widthScale = approach === 'pressing'
      ? 1.04
      : approach === 'low_block'
        ? 0.88
        : approach === 'counter'
          ? 0.94
          : 0.98;
    return {
      ...slot,
      x: Math.max(0.05, Math.min(0.62, slot.x + depth)),
      y: Math.max(0.07, Math.min(0.93, 0.5 + (slot.y - 0.5) * widthScale)),
    };
  });
}

/** Legacy/default shape retained for focused helpers and historical replays. */
export const BASE_FORMATION = FORMATION_LAYOUTS['4-3-3'];

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  angularVel: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  initialSize: number;
  gravity: number;
  drag: number;        // velocity decay per frame (0 = none, 0.05 = strong)
  shape: 'circle' | 'rect' | 'streak';
  bounces: number;     // remaining bounces off the floor
  bounceY: number;     // floor y in canvas pixels
  blend: 'normal' | 'add'; // additive blend for sparks/glow
}

export interface PassPhase {
  passerIdx: number;
  receiverIdx: number;
  attackingHome: boolean;
  kind: 'pass' | 'shot';
  duration: number;
  hold: number;
  arc: number;
  /** Signed top-down bend applied during flight; visual only. */
  swerve?: number;
  /** Frames spent in a stable setup before the ball is released. */
  releaseDelayFrames?: number;
  setPiece?: PresentationSetPiece;
  pattern?: PresentationPlayPattern;
  stage?: PresentationPlayStage;
  chanceStyle?: PresentationChanceStyle;
  restart?: PresentationRestart;
  intercepted: boolean; // pass gets stolen halfway through
  sourceOverride?: { x: number; y: number };
  targetOverride?: { x: number; y: number };
}

// Per-player live position (smoothed) — used by physics + renderer.
export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  sprintT: number;
}

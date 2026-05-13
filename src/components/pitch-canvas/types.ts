// Pure type definitions + constants for the PitchCanvas pipeline.
// No logic — only data shapes shared across the pitch-canvas modules.

export type Role = 'GK' | 'DF' | 'MF' | 'FW';

// 4-4-2 formation positions (normalized 0-1, x is depth, y is width)
export const BASE_FORMATION: { x: number; y: number; role: Role }[] = [
  { x: 0.07, y: 0.5, role: 'GK' },
  { x: 0.22, y: 0.13, role: 'DF' }, { x: 0.20, y: 0.37, role: 'DF' },
  { x: 0.20, y: 0.63, role: 'DF' }, { x: 0.22, y: 0.87, role: 'DF' },
  { x: 0.38, y: 0.15, role: 'MF' }, { x: 0.35, y: 0.40, role: 'MF' },
  { x: 0.35, y: 0.60, role: 'MF' }, { x: 0.38, y: 0.85, role: 'MF' },
  { x: 0.50, y: 0.35, role: 'FW' }, { x: 0.50, y: 0.65, role: 'FW' },
];

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
  duration: number;
  hold: number;
  arc: number;
  intercepted: boolean; // pass gets stolen halfway through
}

// Per-player live position (smoothed) — used by physics + renderer.
export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  sprintT: number;
}

/**
 * Club crest geometry, shared by the React badge and the canvas renderer.
 *
 * The badge ships as SVG, and canvas `Path2D` accepts SVG path data verbatim,
 * so one set of strings drives both. That is the entire reason this module
 * exists: the crest painted on the centre circle has to be the same crest the
 * team list shows, and two hand-maintained copies would drift within a week.
 *
 * Nothing here touches the DOM. React renders these strings as `<path d>`,
 * the pitch canvas feeds them to `Path2D`.
 */

/** Every coordinate below is in this square. */
export const BADGE_VIEWBOX = 40;

/** The six outline shapes a crest can take. */
export const BADGE_FRAME_PATHS: readonly string[] = [
  'M20 2 36 9v14c0 8-5.7 13.2-16 15C9.7 36.2 4 31 4 23V9Z',
  'M20 2 34 6.5 37 20 31 34 20 39 9 34 3 20 6 6.5Z',
  'M20 2 34 7v18c0 6.5-5.3 11.2-14 14-8.7-2.8-14-7.5-14-14V7Z',
  'M20 2 35 11l-2 18-13 10L7 29 5 11Z',
  'M20 2 32 5l6 11-4 16-14 7L6 32 2 16 8 5Z',
  'M20 2c9.4 0 17 6.5 17 15.3C37 28.8 29.6 36 20 39 10.4 36 3 28.8 3 17.3 3 8.5 10.6 2 20 2Z',
];

export interface BadgePatternShape {
  d: string;
  tone: 'light' | 'dark';
  opacity: number;
}

/** Background treatment inside the outline, in the club's own two tones. */
export const BADGE_PATTERN_SHAPES: readonly (readonly BadgePatternShape[])[] = [
  [
    { d: 'M8 0h7v40H8Z', tone: 'light', opacity: 0.24 },
    { d: 'M25 0h7v40h-7Z', tone: 'dark', opacity: 0.28 },
  ],
  [
    { d: 'M0 7h40v7H0Z', tone: 'light', opacity: 0.2 },
    { d: 'M0 21h40v7H0Z', tone: 'light', opacity: 0.2 },
  ],
  [
    { d: 'M-8 5 9-5l39 27-17 10Z', tone: 'light', opacity: 0.2 },
    { d: 'm-8 22 17-10 39 27-17 10Z', tone: 'dark', opacity: 0.22 },
  ],
  [
    { d: 'M20-2 42 20 20 42-2 20Z', tone: 'light', opacity: 0.18 },
    { d: 'M30 18a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z', tone: 'dark', opacity: 0.2 },
  ],
];

/** The device on the crest. Stroked, never filled. */
export const BADGE_SYMBOL_PATHS: readonly (readonly string[])[] = [
  ['m20 7 2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7Z'],
  ['m20 7 7 8-7 8-7-8Z'],
  ['m12 20 8-12 8 12m-13-4h10'],
  ['M13 21V11h14v10', 'm13 11 3-4 4 4 4-4 3 4'],
  ['M11 19c3-6 6-8 9-8s6 2 9 8', 'M14 19c2-3 4-4 6-4s4 1 6 4'],
  ['M14 21V9h12v12M11 13h18', 'M18 9V6h4v3'],
  ['m10 20 7-10 4 6 3-4 6 8'],
  ['M10 11c4 0 4 4 8 4s4-4 8-4 4 4 8 4', 'M8 19c4 0 4-4 8-4'],
  [
    'M25 14a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
    'M20 5v3m0 12v3m9-9h-3m-12 0h-3m15.4-6.4-2.1 2.1m-8.6 8.6-2.1 2.1',
  ],
  ['m23 5-9 11h6l-3 8 10-12h-6Z'],
  ['M27 14a7 7 0 1 1-14 0 7 7 0 0 1 14 0', 'm20 7 4 5-2 6h-4l-2-6Z'],
  ['M11 8h18M13 12h14M15 16h10', 'M20 6v16'],
];

/** The band the two-letter label sits on. */
export const BADGE_NAMEPLATE_PATH = 'M8 24.5h24v8.2c-3 3.1-7 5.2-12 6.3-5-1.1-9-3.2-12-6.3Z';
/** Diagonal sash laid over the field of the crest. */
export const BADGE_SASH_PATH = 'M-2 34 42 9v9L-2 43Z';

export interface TeamBadgeParts {
  seed: number;
  frame: string;
  frameIndex: number;
  symbolIndex: number;
  patternIndex: number;
  label: string;
}

/** FNV-1a. Stable across runs, which is the only property a crest needs. */
export function hashTeamId(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Everything that makes one club's crest different from another's.
 *
 * Given the same team id this returns the same crest forever, which is what
 * lets a canvas repaint it every frame without storing anything.
 */
export function teamBadgeParts(teamId: string | undefined, shortName: string): TeamBadgeParts {
  const seed = hashTeamId(teamId || shortName);
  const frameIndex = seed % BADGE_FRAME_PATHS.length;
  const symbolIndex = (seed >>> 3) % BADGE_SYMBOL_PATHS.length;
  const patternIndex = (seed >>> 7) % BADGE_PATTERN_SHAPES.length;
  return {
    seed,
    frame: BADGE_FRAME_PATHS[frameIndex],
    frameIndex,
    symbolIndex,
    patternIndex,
    label: shortName.slice(0, 2),
  };
}

/** Blend a colour toward white (positive) or black (negative). */
export function badgeShade(input: string, amount: number): string {
  const match = input.match(/^#([\da-f]{6})$/i);
  if (!match) return amount < 0 ? '#111820' : '#dce5ec';
  const value = Number.parseInt(match[1], 16);
  const target = amount < 0 ? 0 : 255;
  const ratio = Math.abs(amount);
  const channel = (shift: number) =>
    Math.round(((value >> shift) & 255) * (1 - ratio) + target * ratio);
  return 'rgb(' + channel(16) + ',' + channel(8) + ',' + channel(0) + ')';
}
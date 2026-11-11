/**
 * Presentation cue gating.
 *
 * These checks used to live inline in the render loop, where the contact cue
 * compared the advancing phase frame against an integer frame index with ===.
 * That only works when the motion rate is exactly 1: at 0.72 (live) and 0.58
 * (immersive) the accumulated frame steps straight over the integer, so the
 * cue never fired in those modes. A threshold plus an explicit "already
 * emitted" flag is correct at every rate.
 *
 * The scene is typed as unknown so this module stays free of the renderer's
 * types; callers only need to distinguish "there is a scene" from "there is
 * not".
 */

export interface SetupCueInput {
  scene: unknown | null;
  isSetPiece: boolean;
  phaseIndex: number;
  isHolding: boolean;
}

/** True while a set piece is still being prepared in the first phase. */
export function shouldEmitSetupCue(input: SetupCueInput): boolean {
  return input.scene !== null
    && input.isSetPiece
    && input.phaseIndex === 0
    && !input.isHolding;
}

export interface ContactFrameInput {
  kind: 'pass' | 'shot';
  releaseDelayFrames?: number;
}

/** Frames of wind-up before the ball leaves the player. */
export function releaseDelayFramesFor(phase: ContactFrameInput): number {
  return phase.releaseDelayFrames ?? (phase.kind === 'shot' ? 8 : 0);
}

/** The frame at which the ball is struck. Always at least one frame. */
export function contactFrameFor(phase: ContactFrameInput): number {
  return Math.max(1, releaseDelayFramesFor(phase));
}

export interface ContactCueInput {
  scene: unknown | null;
  isHolding: boolean;
  phaseFrame: number;
  contactFrame: number;
  isShotOrSetPiece: boolean;
  alreadyEmitted: boolean;
}

/** True on the first frame at or past contact, and never again after that. */
export function shouldEmitContactCue(input: ContactCueInput): boolean {
  if (input.alreadyEmitted) return false;
  if (input.scene === null) return false;
  if (input.isHolding) return false;
  if (!input.isShotOrSetPiece) return false;
  return input.phaseFrame >= input.contactFrame;
}

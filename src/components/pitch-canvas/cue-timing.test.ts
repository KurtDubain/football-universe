import { describe, expect, it } from 'vitest';
import {
  contactFrameFor,
  releaseDelayFramesFor,
  shouldEmitContactCue,
  shouldEmitSetupCue,
} from './cue-timing';
import { playbackMotionRate, type PlaybackMode } from '../match-live/playback-mode';

const SLOW_MODES: PlaybackMode[] = ['live', 'immersive'];
const ALL_MODES: PlaybackMode[] = ['highlights', 'live', 'immersive'];

describe('presentation cue timing', () => {
  it('emits the setup cue only while a set piece is being prepared', () => {
    const base = { scene: {}, isSetPiece: true, phaseIndex: 0, isHolding: false };
    expect(shouldEmitSetupCue(base)).toBe(true);
    expect(shouldEmitSetupCue({ ...base, scene: null })).toBe(false);
    expect(shouldEmitSetupCue({ ...base, isSetPiece: false })).toBe(false);
    expect(shouldEmitSetupCue({ ...base, phaseIndex: 1 })).toBe(false);
    expect(shouldEmitSetupCue({ ...base, isHolding: true })).toBe(false);
  });

  it('derives an integer contact frame from the release delay', () => {
    expect(contactFrameFor({ kind: 'shot' })).toBe(8);
    expect(contactFrameFor({ kind: 'pass' })).toBe(1);
    expect(contactFrameFor({ kind: 'shot', releaseDelayFrames: 0 })).toBe(1);
    expect(contactFrameFor({ kind: 'shot', releaseDelayFrames: 12 })).toBe(12);
  });

  it('keeps the raw release delay separate from the clamped contact frame', () => {
    expect(releaseDelayFramesFor({ kind: 'shot' })).toBe(8);
    expect(releaseDelayFramesFor({ kind: 'pass' })).toBe(0);
    expect(releaseDelayFramesFor({ kind: 'pass', releaseDelayFrames: 5 })).toBe(5);
    expect(releaseDelayFramesFor({ kind: 'shot', releaseDelayFrames: 0 })).toBe(0);
  });

  it('fires the contact cue exactly once at every playback motion rate', () => {
    for (const mode of ALL_MODES) {
      const rate = playbackMotionRate(mode);
      const contactFrame = contactFrameFor({ kind: 'shot' });
      let phaseFrame = 0;
      let emitted = 0;
      let alreadyEmitted = false;

      // Walk the same accumulation the render loop performs.
      for (let frame = 0; frame < 200; frame++) {
        phaseFrame += rate;
        const fire = shouldEmitContactCue({
          scene: {},
          isHolding: false,
          phaseFrame,
          contactFrame,
          isShotOrSetPiece: true,
          alreadyEmitted,
        });
        if (fire) {
          emitted++;
          alreadyEmitted = true;
        }
      }

      expect(emitted, `mode ${mode} at rate ${rate}`).toBe(1);
    }
  });

  it('documents that the old equality check could not fire in the slow modes', () => {
    const contactFrame = contactFrameFor({ kind: 'shot' });
    for (const mode of SLOW_MODES) {
      const rate = playbackMotionRate(mode);
      let phaseFrame = 0;
      let hitEquality = false;
      for (let frame = 0; frame < 200; frame++) {
        phaseFrame += rate;
        if (phaseFrame === contactFrame) hitEquality = true;
      }
      expect(hitEquality, `mode ${mode} should step over ${contactFrame}`).toBe(false);
    }
  });

  it('never fires while holding, without a scene, or for plain passes', () => {
    const base = {
      scene: {},
      isHolding: false,
      phaseFrame: 50,
      contactFrame: 8,
      isShotOrSetPiece: true,
      alreadyEmitted: false,
    };
    expect(shouldEmitContactCue(base)).toBe(true);
    expect(shouldEmitContactCue({ ...base, isHolding: true })).toBe(false);
    expect(shouldEmitContactCue({ ...base, scene: null })).toBe(false);
    expect(shouldEmitContactCue({ ...base, isShotOrSetPiece: false })).toBe(false);
    expect(shouldEmitContactCue({ ...base, alreadyEmitted: true })).toBe(false);
    expect(shouldEmitContactCue({ ...base, phaseFrame: 7 })).toBe(false);
  });
});

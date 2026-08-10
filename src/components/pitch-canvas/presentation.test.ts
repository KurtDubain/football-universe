import { describe, expect, it } from 'vitest';
import { presentationAtmosphereForPhase } from './presentation';
import type { PassPhase } from './types';

function phase(patch: Partial<PassPhase> = {}): PassPhase {
  return {
    passerIdx: 6,
    receiverIdx: 9,
    attackingHome: true,
    kind: 'pass',
    duration: 40,
    hold: 20,
    arc: 0,
    intercepted: false,
    pattern: 'build_up',
    stage: 'build',
    ...patch,
  };
}

describe('match presentation atmosphere', () => {
  it('rises as possession reaches a dangerous attacking phase', () => {
    const build = presentationAtmosphereForPhase(phase(), 0.35, true);
    const create = presentationAtmosphereForPhase(phase({ stage: 'create' }), 0.78, true);
    const shot = presentationAtmosphereForPhase(phase({ kind: 'shot', stage: 'finish' }), 0.84, true);

    expect(create.danger).toBeGreaterThan(build.danger);
    expect(shot.danger).toBe(1);
  });

  it('mirrors territory for away attacks and keeps penalties at maximum tension', () => {
    const awayDanger = presentationAtmosphereForPhase(phase({ attackingHome: false }), 0.18, true);
    const penalty = presentationAtmosphereForPhase(phase({
      attackingHome: false,
      kind: 'shot',
      stage: 'finish',
      setPiece: 'penalty',
    }), 0.12, false);

    expect(awayDanger.danger).toBeGreaterThan(0.4);
    expect(penalty.danger).toBe(1);
  });
});

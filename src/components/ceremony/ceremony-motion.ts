// How a ceremony moves through time.
//
// Every ceremony here is a printed page, not a particle burst: it leads in
// quietly, sets its lines one after another, then comes to rest. These numbers
// are the only place that rhythm is written down, so the overlay, its tests
// and the reduced-motion fallback cannot drift apart.

import { CEREMONY_DURATION, CEREMONY_HOLDS, type CeremonyKind } from './ceremony-types';

export interface CeremonyTiming {
  /** Quiet milliseconds before the page starts turning. */
  lead: number;
  /** Milliseconds between consecutive typeset lines. */
  stagger: number;
  /** Milliseconds from the last line landing to the page being fully at rest. */
  tail: number;
  /**
   * Milliseconds after settle before the overlay dismisses itself.
   *
   * null means the ceremony holds: it is a page of the annual and waits to be
   * turned by the viewer.
   */
  autoDismiss: number | null;
}

/**
 * Reduced motion keeps the beat and drops the travel.
 *
 * A viewer who asked for less motion still has to read the page, so the
 * ceremony is flattened rather than skipped. It never becomes a flash of
 * content they cannot follow.
 */
const REDUCED_TAIL_SCALE = 0.34;

const BASE: Readonly<Record<CeremonyKind, Omit<CeremonyTiming, 'autoDismiss'>>> = {
  cup_stamp: { lead: 180, stagger: 0, tail: 620 },
  season_opening: { lead: 260, stagger: 130, tail: 720 },
  season_closing: { lead: 300, stagger: 150, tail: 860 },
  world_cup_opening: { lead: 420, stagger: 90, tail: 1100 },
  world_cup_closing: { lead: 460, stagger: 110, tail: 1200 },
};

/** Milliseconds from mount to the page being fully at rest. */
export function ceremonySettle(timing: CeremonyTiming, lineCount: number): number {
  const steps = Math.max(0, lineCount - 1);
  return timing.lead + timing.stagger * steps + timing.tail;
}

/**
 * The timing for one ceremony.
 *
 * A ceremony that does not hold always occupies exactly its budgeted
 * duration, reduced motion included: less movement is not less time, and a
 * stamp that vanished early would read as a glitch rather than as restraint.
 */
export function ceremonyTiming(kind: CeremonyKind, reducedMotion: boolean): CeremonyTiming {
  const base = BASE[kind];
  const timing: CeremonyTiming = {
    lead: reducedMotion ? 0 : base.lead,
    stagger: reducedMotion ? 0 : base.stagger,
    tail: reducedMotion ? Math.round(base.tail * REDUCED_TAIL_SCALE) : base.tail,
    autoDismiss: null,
  };
  if (CEREMONY_HOLDS[kind]) return timing;
  const settle = ceremonySettle(timing, 1);
  return { ...timing, autoDismiss: Math.max(320, CEREMONY_DURATION[kind] - settle) };
}

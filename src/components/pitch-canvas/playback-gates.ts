// The two gates that decide whether a directed scene is still playing.
//
// They read the same minute and the same event, and they must never both be
// true. `shouldHoldClock` stops the playback clock from advancing;
// `isWaitingForEvent` pins the sequence on its hold frame. If both hold at
// once, neither side can clear the other: the clock stops, the phase stops,
// and the goal scene sits there for ever.
//
// That is exactly what shipped in v4.65.0 and v4.66.0. The clock gate used
// `>=` on the event minute and the wait gate used `<=` on the same minute, so
// at `minute === eventMinute` both were true. It was recorded as a known
// defect rather than fixed, which is why the invariant lives here as a test
// instead of as a comment next to a comparison operator.

export interface ClockHoldInput {
  /** The playback clock is running at all. */
  active: boolean;
  /** A directed scene is loaded. */
  hasScene: boolean;
  /** Minute the loaded scene's event belongs to. */
  eventMinute: number;
  /** Current playback minute. */
  minute: number;
  /** A directed phase is mid-flight. */
  hasActivePhase: boolean;
  /** A shot result or goal celebration is still playing. */
  resultBusy: boolean;
}

/** Whether the playback clock should stop advancing. */
export function shouldHoldClock(input: ClockHoldInput): boolean {
  if (!input.active || !input.hasScene) return false;
  if (!input.hasActivePhase && !input.resultBusy) return false;
  return input.minute >= input.eventMinute;
}

export interface EventWaitInput {
  /** The phase after the current one is a shot. */
  nextPhaseIsShot: boolean;
  /** A directed scene is loaded. */
  hasScene: boolean;
  /** Minute the loaded scene's event belongs to. */
  eventMinute: number;
  /** Current playback minute. */
  minute: number;
  /** The impact for this scene has already fired. */
  impactFired: boolean;
}

/**
 * Whether the sequence should sit on its hold frame waiting for the event.
 *
 * Strictly before the event minute, never at it. `shouldHoldClock` already
 * owns the event minute itself, and a scene cannot be both waiting for an
 * event and holding the clock for it.
 */
export function isWaitingForEvent(input: EventWaitInput): boolean {
  if (!input.nextPhaseIsShot || !input.hasScene) return false;
  if (input.impactFired) return false;
  return input.minute < input.eventMinute;
}
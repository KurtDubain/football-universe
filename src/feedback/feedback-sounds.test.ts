import { describe, expect, it } from 'vitest';
import {
  FEEDBACK_CUE_TRIM,
  FEEDBACK_VOLUME_LIFT,
  feedbackVolumeLiftForCue,
} from './feedback-sounds';

describe('feedback cue mastering', () => {
  it('keeps routine controls audible while preserving stronger event and musical layers', () => {
    expect(feedbackVolumeLiftForCue('selection')).toBe(
      FEEDBACK_VOLUME_LIFT.ui * FEEDBACK_CUE_TRIM.selection,
    );
    expect(feedbackVolumeLiftForCue('goal')).toBe(FEEDBACK_VOLUME_LIFT.event);
    expect(feedbackVolumeLiftForCue('start')).toBe(FEEDBACK_VOLUME_LIFT.musical);
    expect(feedbackVolumeLiftForCue('selection')).toBeGreaterThan(FEEDBACK_VOLUME_LIFT.ui);
    expect(FEEDBACK_VOLUME_LIFT.ui).toBeGreaterThan(5);
    expect(FEEDBACK_VOLUME_LIFT.event).toBeGreaterThan(5);
    expect(FEEDBACK_VOLUME_LIFT.musical).toBeGreaterThan(5);
    expect(FEEDBACK_CUE_TRIM.advance).toBeLessThan(1);
    expect(FEEDBACK_CUE_TRIM.intervention).toBeLessThan(1);
  });
});

import { describe, expect, it } from 'vitest';
import { FEEDBACK_VOLUME_LIFT, feedbackVolumeLiftForCue } from './feedback-sounds';

describe('feedback cue mastering', () => {
  it('keeps routine controls audible while preserving stronger event and musical layers', () => {
    expect(feedbackVolumeLiftForCue('selection')).toBe(FEEDBACK_VOLUME_LIFT.ui);
    expect(feedbackVolumeLiftForCue('goal')).toBe(FEEDBACK_VOLUME_LIFT.event);
    expect(feedbackVolumeLiftForCue('start')).toBe(FEEDBACK_VOLUME_LIFT.musical);
    expect(FEEDBACK_VOLUME_LIFT.ui).toBeGreaterThanOrEqual(1.35);
    expect(FEEDBACK_VOLUME_LIFT.event).toBeGreaterThan(FEEDBACK_VOLUME_LIFT.ui);
    expect(FEEDBACK_VOLUME_LIFT.musical).toBeGreaterThan(FEEDBACK_VOLUME_LIFT.event);
  });
});

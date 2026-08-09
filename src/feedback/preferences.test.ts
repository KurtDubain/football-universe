// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_FEEDBACK_PREFERENCES,
  FEEDBACK_PREFERENCES_KEY,
  getFeedbackPreferences,
  parseFeedbackPreferences,
  setFeedbackPreferences,
} from './preferences';

describe('feedback preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    setFeedbackPreferences(DEFAULT_FEEDBACK_PREFERENCES);
  });

  it('recovers safe defaults from missing or malformed storage', () => {
    expect(parseFeedbackPreferences(null)).toEqual(DEFAULT_FEEDBACK_PREFERENCES);
    expect(parseFeedbackPreferences('{broken')).toEqual(DEFAULT_FEEDBACK_PREFERENCES);
    expect(parseFeedbackPreferences(JSON.stringify({ soundEnabled: false }))).toEqual({
      soundEnabled: false,
      soundProfile: 'balanced',
      hapticsEnabled: false,
    });
    expect(parseFeedbackPreferences(JSON.stringify({ soundProfile: 'stadium' })).soundProfile).toBe('stadium');
    expect(parseFeedbackPreferences(JSON.stringify({ soundProfile: 'maximum' })).soundProfile).toBe('balanced');
  });

  it('persists sound and haptic choices outside the game save', () => {
    setFeedbackPreferences({ soundEnabled: false, soundProfile: 'quiet', hapticsEnabled: true });
    expect(getFeedbackPreferences()).toEqual({ soundEnabled: false, soundProfile: 'quiet', hapticsEnabled: true });
    expect(JSON.parse(localStorage.getItem(FEEDBACK_PREFERENCES_KEY) ?? '{}')).toEqual({
      soundEnabled: false,
      soundProfile: 'quiet',
      hapticsEnabled: true,
    });
  });
});

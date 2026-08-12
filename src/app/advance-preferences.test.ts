// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  ADVANCE_PREFERENCES_KEY,
  DEFAULT_ADVANCE_PREFERENCES,
  getAdvancePreferences,
  parseAdvancePreferences,
  setAdvancePreferences,
} from './advance-preferences';

describe('advance preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    setAdvancePreferences(DEFAULT_ADVANCE_PREFERENCES);
  });

  it('defaults safely when storage is missing or malformed', () => {
    expect(parseAdvancePreferences(null)).toEqual(DEFAULT_ADVANCE_PREFERENCES);
    expect(parseAdvancePreferences('{broken')).toEqual(DEFAULT_ADVANCE_PREFERENCES);
    expect(parseAdvancePreferences(JSON.stringify({ stayOnCurrentView: 'yes' })))
      .toEqual(DEFAULT_ADVANCE_PREFERENCES);
  });

  it('persists the stay-on-current-view choice outside the game save', () => {
    setAdvancePreferences({ stayOnCurrentView: true });

    expect(getAdvancePreferences().stayOnCurrentView).toBe(true);
    expect(JSON.parse(localStorage.getItem(ADVANCE_PREFERENCES_KEY) ?? '{}'))
      .toEqual({ stayOnCurrentView: true });
  });
});

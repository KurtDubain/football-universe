import { describe, expect, it } from 'vitest';
import { SETTINGS_GUIDE_ITEMS } from './settings-guide';

describe('settings guide', () => {
  it('uses the shared icon language for every guide topic', () => {
    expect(SETTINGS_GUIDE_ITEMS.map(item => item.icon)).toEqual([
      'eye',
      'stadium',
      'trophy',
      'ball',
      'tie',
      'trend-up',
      'bolt',
      'fire',
    ]);
  });
});

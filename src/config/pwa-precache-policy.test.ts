import { describe, expect, it } from 'vitest';
import { missingInitialPrecacheFiles, shouldPrecacheUrl } from './pwa-precache-policy';

describe('platform-independent precache policy', () => {
  it('excludes page chunks but keeps differently cased shared chunks', () => {
    for (const name of ['Teams', 'Players', 'Coaches', 'History', 'League']) {
      expect(shouldPrecacheUrl(`assets/${name}-abc_123.js`)).toBe(false);
      expect(shouldPrecacheUrl(`assets/${name.toLowerCase()}-abc_123.js`)).toBe(true);
    }
    expect(shouldPrecacheUrl('assets/TeamSummary-abc.js')).toBe(true);
    expect(shouldPrecacheUrl('assets/Teams-support-abc.css')).toBe(true);
  });

  it('requires every initial JS dependency, with exact case', () => {
    const initial = ['assets/index-a.js', 'assets/teams-b.js'];
    expect(missingInitialPrecacheFiles(initial, ['/assets/index-a.js?revision=1', 'assets/Teams-b.js']))
      .toEqual(['assets/teams-b.js']);
    expect(missingInitialPrecacheFiles(initial, initial)).toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('route module resolver', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('maps static and detail routes to their lazy module', async () => {
    const { routeModuleKeyForPath } = await import('./route-modules');
    expect(routeModuleKeyForPath('/')).toBe('dashboard');
    expect(routeModuleKeyForPath('/league/1')).toBe('league');
    expect(routeModuleKeyForPath('/cup/world_cup')).toBe('cup');
    expect(routeModuleKeyForPath('/player/p-12')).toBe('playerDetail');
    expect(routeModuleKeyForPath('/settings')).toBe('settings');
    expect(routeModuleKeyForPath('/unknown')).toBeNull();
  });
});

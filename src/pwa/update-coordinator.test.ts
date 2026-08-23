import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canReloadForAppUpdate,
  claimDeploymentReload,
  clearDeploymentReloadClaim,
  createSafeUpdateCoordinator,
  deploymentReloadIdentity,
  parseRemoteAppVersion,
} from './update-coordinator';

describe('app update coordinator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts only a bounded non-empty remote version', () => {
    expect(parseRemoteAppVersion({ version: ' 4.38.0 ', buildId: ' abc123 ' })).toEqual({
      version: '4.38.0',
      buildId: 'abc123',
    });
    expect(parseRemoteAppVersion({ version: '4.38.0' })).toEqual({
      version: '4.38.0',
      buildId: null,
    });
    expect(parseRemoteAppVersion({ version: '' })).toBeNull();
    expect(parseRemoteAppVersion({ version: 438 })).toBeNull();
    expect(parseRemoteAppVersion(null)).toBeNull();
  });

  it('reloads only while visible, idle, and outside a blocking dialog', () => {
    expect(canReloadForAppUpdate({ visible: true, isAdvancing: false, hasBlockingDialog: false, isRouteLoading: false })).toBe(true);
    expect(canReloadForAppUpdate({ visible: false, isAdvancing: false, hasBlockingDialog: false, isRouteLoading: false })).toBe(false);
    expect(canReloadForAppUpdate({ visible: true, isAdvancing: true, hasBlockingDialog: false, isRouteLoading: false })).toBe(false);
    expect(canReloadForAppUpdate({ visible: true, isAdvancing: false, hasBlockingDialog: true, isRouteLoading: false })).toBe(false);
    expect(canReloadForAppUpdate({ visible: true, isAdvancing: false, hasBlockingDialog: false, isRouteLoading: true })).toBe(false);
  });

  it('claims at most one fallback reload for the same remote deployment', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const identity = deploymentReloadIdentity({ version: '4.57.0', buildId: 'deploy-57' });

    expect(identity).toBe('build:deploy-57');
    expect(claimDeploymentReload(storage, identity)).toBe(true);
    expect(claimDeploymentReload(storage, identity)).toBe(false);
    expect(claimDeploymentReload(storage, 'build:deploy-58')).toBe(true);

    clearDeploymentReloadClaim(storage);
    expect(claimDeploymentReload(storage, identity)).toBe(true);
  });

  it('waits through an unsafe operation and reloads once after it becomes safe', () => {
    vi.useFakeTimers();
    let safe = false;
    const reload = vi.fn();
    const coordinator = createSafeUpdateCoordinator({
      isSafeToReload: () => safe,
      reload,
      graceMs: 500,
      retryMs: 250,
    });

    coordinator.requestReload();
    coordinator.requestReload();
    vi.advanceTimersByTime(500);
    expect(reload).not.toHaveBeenCalled();
    expect(coordinator.isPending()).toBe(true);

    safe = true;
    coordinator.notifySafetyChanged();
    vi.runOnlyPendingTimers();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(coordinator.isPending()).toBe(false);

    coordinator.requestReload();
    vi.runAllTimers();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('can cancel a pending reload', () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const coordinator = createSafeUpdateCoordinator({
      isSafeToReload: () => true,
      reload,
    });

    coordinator.requestReload();
    coordinator.cancel();
    vi.runAllTimers();
    expect(reload).not.toHaveBeenCalled();
  });
});

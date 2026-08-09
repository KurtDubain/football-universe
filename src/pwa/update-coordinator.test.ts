import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canReloadForAppUpdate,
  createSafeUpdateCoordinator,
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
    expect(canReloadForAppUpdate({ visible: true, isAdvancing: false, hasBlockingDialog: false })).toBe(true);
    expect(canReloadForAppUpdate({ visible: false, isAdvancing: false, hasBlockingDialog: false })).toBe(false);
    expect(canReloadForAppUpdate({ visible: true, isAdvancing: true, hasBlockingDialog: false })).toBe(false);
    expect(canReloadForAppUpdate({ visible: true, isAdvancing: false, hasBlockingDialog: true })).toBe(false);
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

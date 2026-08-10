import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RouteResourceError,
  loadRouteModuleWithRecovery,
} from './route-resource-loader';

describe('recoverable route loading', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns a successfully loaded route module', async () => {
    const module = { default: () => null };

    await expect(loadRouteModuleWithRecovery(
      async () => module,
      { routeId: 'history', online: () => true },
    )).resolves.toBe(module);
  });

  it('turns a permanently pending import into a bounded timeout error', async () => {
    vi.useFakeTimers();
    const loading = loadRouteModuleWithRecovery(
      () => new Promise<never>(() => undefined),
      { routeId: 'history', timeoutMs: 50, maxRetries: 0, online: () => true },
    );
    const assertion = expect(loading).rejects.toMatchObject({
      name: 'RouteResourceError',
      routeId: 'history',
      code: 'timeout',
      attempts: 1,
    });

    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });

  it('retries one transient chunk failure and then succeeds', async () => {
    const module = { default: () => null };
    const importer = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce(module);

    await expect(loadRouteModuleWithRecovery(importer, {
      routeId: 'players',
      retryDelayMs: 0,
      online: () => true,
    })).resolves.toBe(module);
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it('limits repeated chunk failures to two total attempts', async () => {
    const importer = vi.fn().mockRejectedValue(new Error('ChunkLoadError: loading chunk failed'));

    await expect(loadRouteModuleWithRecovery(importer, {
      routeId: 'players',
      maxRetries: 20,
      retryDelayMs: 0,
      online: () => true,
    })).rejects.toMatchObject({
      code: 'chunk',
      attempts: 2,
    });
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it('does not retry while the browser is offline', async () => {
    const importer = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    try {
      await loadRouteModuleWithRecovery(importer, {
        routeId: 'cup',
        online: () => false,
      });
      throw new Error('Expected route loading to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(RouteResourceError);
      expect(error).toMatchObject({ code: 'offline', attempts: 1 });
    }
    expect(importer).toHaveBeenCalledOnce();
  });
});

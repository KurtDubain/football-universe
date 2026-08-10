export const ROUTE_LOAD_TIMEOUT_MS = 8_000;
export const ROUTE_LOAD_MAX_RETRIES = 1;
export const ROUTE_ERROR_STORAGE_KEY = 'football-universe-last-route-error';

export type RouteFailureCode = 'offline' | 'timeout' | 'chunk' | 'network' | 'unknown';

export class RouteResourceError extends Error {
  readonly routeId: string;
  readonly code: RouteFailureCode;
  readonly attempts: number;

  constructor(routeId: string, code: RouteFailureCode, attempts: number, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`页面资源加载失败（${routeId} / ${code}）：${reason}`, { cause });
    this.name = 'RouteResourceError';
    this.routeId = routeId;
    this.code = code;
    this.attempts = attempts;
  }
}

class RouteAttemptTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`页面资源在 ${timeoutMs}ms 内未完成加载`);
    this.name = 'RouteAttemptTimeoutError';
  }
}

export interface RouteLoadOptions {
  routeId: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  online?: () => boolean;
}

function classifyRouteFailure(error: unknown, online: () => boolean): RouteFailureCode {
  if (!online()) return 'offline';
  if (error instanceof RouteAttemptTimeoutError) return 'timeout';
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/ChunkLoadError|dynamically imported module|loading chunk|module script/i.test(message)) return 'chunk';
  if (/fetch|network|load failed|connection|ERR_/i.test(message)) return 'network';
  return 'unknown';
}

function wait(delayMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RouteAttemptTimeoutError(timeoutMs)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

function getRetryModuleUrl(error: unknown, attempt: number): string | null {
  if (typeof window === 'undefined') return null;
  const message = error instanceof Error ? error.message : String(error);
  const candidate = message.match(/https?:\/\/[^\s"'`]+\.js(?:\?[^\s"'`]*)?/i)?.[0];
  if (!candidate) return null;

  try {
    const url = new URL(candidate, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.endsWith('.js')) return null;
    url.searchParams.set('__route_retry', String(attempt));
    return url.href;
  } catch {
    return null;
  }
}

function importRetryModule<T>(url: string): Promise<T> {
  return import(/* @vite-ignore */ url) as Promise<T>;
}

export async function loadRouteModuleWithRecovery<T>(
  importer: () => Promise<T>,
  {
    routeId,
    timeoutMs = ROUTE_LOAD_TIMEOUT_MS,
    maxRetries = ROUTE_LOAD_MAX_RETRIES,
    retryDelayMs = 180,
    online = () => typeof navigator === 'undefined' || navigator.onLine,
  }: RouteLoadOptions,
): Promise<T> {
  const boundedRetries = Math.max(0, Math.min(1, Math.floor(maxRetries)));
  let attempts = 0;
  let lastError: unknown = new Error('页面资源未开始加载');
  let nextImporter = importer;

  while (attempts <= boundedRetries) {
    attempts += 1;
    try {
      return await withTimeout(nextImporter(), timeoutMs);
    } catch (error) {
      lastError = error;
      const code = classifyRouteFailure(error, online);
      if (attempts > boundedRetries || code === 'offline' || code === 'unknown') {
        throw new RouteResourceError(routeId, code, attempts, error);
      }
      const retryUrl = code === 'chunk' || code === 'network'
        ? getRetryModuleUrl(error, attempts + 1)
        : null;
      nextImporter = retryUrl ? () => importRetryModule<T>(retryUrl) : importer;
      await wait(retryDelayMs);
    }
  }

  throw new RouteResourceError(routeId, classifyRouteFailure(lastError, online), attempts, lastError);
}

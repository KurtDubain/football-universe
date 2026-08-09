export interface RemoteAppVersion {
  version: string;
  buildId: string | null;
}

export interface ReloadSafetySnapshot {
  visible: boolean;
  isAdvancing: boolean;
  hasBlockingDialog: boolean;
}

export function parseRemoteAppVersion(value: unknown): RemoteAppVersion | null {
  if (!value || typeof value !== 'object') return null;
  const version = Reflect.get(value, 'version');
  if (typeof version !== 'string') return null;

  const normalized = version.trim();
  if (!normalized || normalized.length > 64) return null;
  const rawBuildId = Reflect.get(value, 'buildId');
  const buildId = typeof rawBuildId === 'string' && rawBuildId.trim().length <= 128
    ? rawBuildId.trim() || null
    : null;
  return { version: normalized, buildId };
}

export function canReloadForAppUpdate(snapshot: ReloadSafetySnapshot): boolean {
  return snapshot.visible && !snapshot.isAdvancing && !snapshot.hasBlockingDialog;
}

interface UpdateCoordinatorOptions {
  isSafeToReload: () => boolean;
  reload: () => void;
  graceMs?: number;
  retryMs?: number;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface SafeUpdateCoordinator {
  requestReload: () => void;
  notifySafetyChanged: () => void;
  cancel: () => void;
  isPending: () => boolean;
}

export function createSafeUpdateCoordinator({
  isSafeToReload,
  reload,
  graceMs = 500,
  retryMs = 500,
  now = Date.now,
  schedule = setTimeout,
  cancelSchedule = clearTimeout,
}: UpdateCoordinatorOptions): SafeUpdateCoordinator {
  let pending = false;
  let reloadStarted = false;
  let readyAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer === null) return;
    cancelSchedule(timer);
    timer = null;
  };

  const queueAttempt = (delayMs: number) => {
    if (timer !== null || reloadStarted || !pending) return;
    timer = schedule(attemptReload, Math.max(0, delayMs));
  };

  const attemptReload = () => {
    timer = null;
    if (!pending || reloadStarted) return;

    const graceRemaining = readyAt - now();
    if (graceRemaining > 0) {
      queueAttempt(graceRemaining);
      return;
    }

    if (!isSafeToReload()) {
      queueAttempt(retryMs);
      return;
    }

    pending = false;
    reloadStarted = true;
    reload();
  };

  return {
    requestReload() {
      if (pending || reloadStarted) return;
      pending = true;
      readyAt = now() + graceMs;
      queueAttempt(graceMs);
    },
    notifySafetyChanged() {
      if (!pending || reloadStarted) return;
      clearTimer();
      queueAttempt(Math.max(0, readyAt - now()));
    },
    cancel() {
      pending = false;
      clearTimer();
    },
    isPending() {
      return pending;
    },
  };
}

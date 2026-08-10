import { useGameStore } from '../store/game-store';
import { APP_VERSION } from '../version';
import {
  canReloadForAppUpdate,
  createSafeUpdateCoordinator,
  parseRemoteAppVersion,
} from './update-coordinator';
import { ROUTE_RESOURCE_ERROR_EVENT, ROUTE_RESOURCE_SETTLED_EVENT } from './events';

const VERSION_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const VERSION_ENDPOINT = '/version.json';

interface AppUpdateAuditState {
  localVersion: string;
  localBuildId: string;
  registered: boolean;
  checkCount: number;
  updateRequests: number;
  completedUpdateRequests: number;
  lastRemoteVersion: string | null;
  lastRemoteBuildId: string | null;
  pendingReload: boolean;
}

declare global {
  interface Window {
    __appUpdateAudit?: {
      checkNow: () => Promise<boolean>;
      getState: () => AppUpdateAuditState;
    };
  }
}

function isSafeToReload(): boolean {
  return canReloadForAppUpdate({
    visible: document.visibilityState === 'visible',
    isAdvancing: useGameStore.getState().isAdvancing,
    hasBlockingDialog: Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')),
    isRouteLoading: Boolean(document.querySelector('[data-route-loading="true"]')),
  });
}

export function startAppUpdateMonitor(): () => void {
  if (!('serviceWorker' in navigator)) return () => undefined;

  let registration: ServiceWorkerRegistration | undefined;
  let checkPromise: Promise<boolean> | null = null;
  let checkCount = 0;
  let updateRequests = 0;
  let completedUpdateRequests = 0;
  let lastRemoteVersion: string | null = null;
  let lastRemoteBuildId: string | null = null;
  let expectingControllerChange = false;
  let removeRegistrationListener: (() => void) | null = null;

  const coordinator = createSafeUpdateCoordinator({
    isSafeToReload,
    reload: () => window.location.reload(),
  });

  const checkNow = (): Promise<boolean> => {
    if (!registration || !navigator.onLine) return Promise.resolve(false);
    if (checkPromise) return checkPromise;

    checkPromise = (async () => {
      checkCount += 1;
      try {
        const response = await fetch(`${VERSION_ENDPOINT}?t=${Date.now()}`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) return false;

        const remote = parseRemoteAppVersion(await response.json());
        if (!remote) return false;
        lastRemoteVersion = remote.version;
        lastRemoteBuildId = remote.buildId;
        const sameDeployment = remote.buildId
          ? remote.buildId === __APP_BUILD_ID__
          : remote.version === APP_VERSION;
        if (sameDeployment) return false;

        updateRequests += 1;
        await registration?.update();
        completedUpdateRequests += 1;
        return true;
      } catch {
        return false;
      } finally {
        checkPromise = null;
      }
    })();

    return checkPromise;
  };

  const watchedWorkers = new WeakSet<ServiceWorker>();
  const watchInstallingWorker = (worker: ServiceWorker, isUpdate: boolean) => {
    if (watchedWorkers.has(worker)) return;
    watchedWorkers.add(worker);

    const handleStateChange = () => {
      if (worker.state === 'activated') {
        worker.removeEventListener('statechange', handleStateChange);
        if (isUpdate) coordinator.requestReload();
      } else if (worker.state === 'redundant') {
        worker.removeEventListener('statechange', handleStateChange);
      }
    };
    worker.addEventListener('statechange', handleStateChange);
    handleStateChange();
  };

  const handleControllerChange = () => {
    if (expectingControllerChange) coordinator.requestReload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

  void navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(activeRegistration => {
    registration = activeRegistration;
    const handleUpdateFound = () => {
      const worker = activeRegistration.installing;
      if (!worker) return;
      const isUpdate = Boolean(navigator.serviceWorker.controller);
      if (isUpdate) expectingControllerChange = true;
      watchInstallingWorker(worker, isUpdate);
    };
    activeRegistration.addEventListener('updatefound', handleUpdateFound);
    removeRegistrationListener = () => {
      activeRegistration.removeEventListener('updatefound', handleUpdateFound);
    };

    if (activeRegistration.installing) handleUpdateFound();
    if (activeRegistration.waiting && navigator.serviceWorker.controller) {
      expectingControllerChange = true;
      coordinator.requestReload();
    }
    void checkNow();
  }).catch(error => {
    console.warn('[app-update] Service Worker registration failed.', error);
  });

  const handleForeground = () => {
    if (document.visibilityState !== 'visible') return;
    coordinator.notifySafetyChanged();
    void checkNow();
  };
  const handleFocus = () => {
    coordinator.notifySafetyChanged();
    void checkNow();
  };
  const handleOnline = () => {
    void checkNow();
  };
  const handleRouteResourceError = () => {
    void checkNow();
  };
  const handleRouteResourceSettled = () => {
    coordinator.notifySafetyChanged();
  };

  document.addEventListener('visibilitychange', handleForeground);
  window.addEventListener('focus', handleFocus);
  window.addEventListener('online', handleOnline);
  window.addEventListener(ROUTE_RESOURCE_ERROR_EVENT, handleRouteResourceError);
  window.addEventListener(ROUTE_RESOURCE_SETTLED_EVENT, handleRouteResourceSettled);
  const unsubscribeStore = useGameStore.subscribe((state, previousState) => {
    if (previousState.isAdvancing && !state.isAdvancing) coordinator.notifySafetyChanged();
  });
  const interval = window.setInterval(() => void checkNow(), VERSION_CHECK_INTERVAL_MS);

  const exposeAudit = (
    import.meta.env.VITE_ENABLE_AUDIT === 'true'
    && new URLSearchParams(window.location.search).has('audit')
  );
  if (exposeAudit) {
    window.__appUpdateAudit = {
      checkNow,
      getState: () => ({
        localVersion: APP_VERSION,
        localBuildId: __APP_BUILD_ID__,
        registered: Boolean(registration),
        checkCount,
        updateRequests,
        completedUpdateRequests,
        lastRemoteVersion,
        lastRemoteBuildId,
        pendingReload: coordinator.isPending(),
      }),
    };
  }

  return () => {
    coordinator.cancel();
    removeRegistrationListener?.();
    unsubscribeStore();
    window.clearInterval(interval);
    document.removeEventListener('visibilitychange', handleForeground);
    window.removeEventListener('focus', handleFocus);
    window.removeEventListener('online', handleOnline);
    window.removeEventListener(ROUTE_RESOURCE_ERROR_EVENT, handleRouteResourceError);
    window.removeEventListener(ROUTE_RESOURCE_SETTLED_EVENT, handleRouteResourceSettled);
    navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    if (exposeAudit) delete window.__appUpdateAudit;
  };
}

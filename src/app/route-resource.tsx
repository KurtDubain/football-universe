import { useEffect, useState, type ComponentType } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LoadingSkeleton } from '../components/ui';
import { ROUTE_RESOURCE_ERROR_EVENT, ROUTE_RESOURCE_SETTLED_EVENT } from '../pwa/events';
import {
  ROUTE_ERROR_STORAGE_KEY,
  RouteResourceError,
  loadRouteModuleWithRecovery,
} from './route-resource-loader';

export function RouteLoading({ fullPage = false }: { fullPage?: boolean }) {
  return <LoadingSkeleton fullPage={fullPage} className="route-loading" data-route-loading="true" />;
}

function recordRouteFailure(error: RouteResourceError): void {
  const detail = {
    routeId: error.routeId,
    code: error.code,
    attempts: error.attempts,
    message: error.message,
    failedAt: new Date().toISOString(),
  };
  try {
    sessionStorage.setItem(ROUTE_ERROR_STORAGE_KEY, JSON.stringify(detail));
  } catch {
    // Recovery controls remain available when session storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(ROUTE_RESOURCE_ERROR_EVENT, { detail }));
  console.warn('[route-resource]', detail);
}

function RouteFailurePanel({
  error,
  routeId,
  fullPage,
  onRetry,
  onHome,
}: {
  error: RouteResourceError;
  routeId: string;
  fullPage: boolean;
  onRetry: () => void;
  onHome: () => void;
}) {
  const offline = error.code === 'offline';
  return (
    <div className={fullPage ? 'flex min-h-[100dvh] items-center justify-center bg-[var(--surface-page)] px-4 py-8' : 'flex min-h-72 items-center justify-center py-6'}>
      <section
        role="alert"
        aria-labelledby="route-resource-error-title"
        data-testid="route-resource-error"
        className="w-full max-w-lg rounded-lg border border-amber-900/70 bg-[var(--surface-panel)] p-4 shadow-xl sm:p-5"
      >
        <p className="text-xs font-semibold text-amber-400">页面恢复</p>
        <h1 id="route-resource-error-title" className="mt-2 text-lg font-bold text-[var(--text-primary)]">
          {offline ? '当前离线，页面资源尚未缓存' : '当前页面资源没有加载成功'}
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
          {offline
            ? '已缓存的页面仍可离线使用。网络恢复后可重试当前页面，存档不会被清除。'
            : '应用已经自动重试一次，并检查是否存在新部署。你可以再次加载当前页面，或刷新到最新版本。'}
        </p>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <button type="button" onClick={onRetry} className="min-h-11 rounded bg-[var(--action)] px-3 text-sm font-semibold text-white hover:bg-[var(--action-hover)]">
            重试当前页面
          </button>
          <button type="button" onClick={onHome} className="min-h-11 rounded border border-[var(--border-strong)] px-3 text-sm font-semibold text-[var(--text-secondary)] hover:border-slate-500">
            返回主页
          </button>
          <button type="button" onClick={() => window.location.reload()} className="min-h-11 rounded border border-[var(--border-strong)] px-3 text-sm font-semibold text-[var(--text-secondary)] hover:border-slate-500">
            刷新应用
          </button>
        </div>

        <details className="mt-4 border-t border-[var(--border-subtle)] pt-2 text-xs text-[var(--text-muted)]">
          <summary className="min-h-11 cursor-pointer py-3">反馈信息</summary>
          <p className="break-words font-mono leading-5">{routeId} · {error.code} · {error.attempts} 次尝试</p>
        </details>
      </section>
    </div>
  );
}

type RouteModule = { default: ComponentType };
type RouteLoadState =
  | { status: 'loading' }
  | { status: 'ready'; component: ComponentType }
  | { status: 'error'; error: RouteResourceError };

export function RecoverableRoute({
  routeId,
  importer,
  fullPage = false,
}: {
  routeId: string;
  importer: () => Promise<RouteModule>;
  fullPage?: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [generation, setGeneration] = useState(0);
  const [loadState, setLoadState] = useState<RouteLoadState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    void loadRouteModuleWithRecovery(importer, { routeId }).then(module => {
      if (active) setLoadState({ status: 'ready', component: module.default });
    }).catch(error => {
      if (!active) return;
      const routeError = error instanceof RouteResourceError
        ? error
        : new RouteResourceError(routeId, 'unknown', 1, error);
      recordRouteFailure(routeError);
      setLoadState({ status: 'error', error: routeError });
    });
    return () => {
      active = false;
    };
  }, [generation, importer, routeId]);

  useEffect(() => {
    if (loadState.status === 'loading') return;
    const frame = window.requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent(ROUTE_RESOURCE_SETTLED_EVENT, {
        detail: { routeId, status: loadState.status },
      }));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loadState.status, routeId]);

  const goHome = () => {
    if (location.pathname === '/') {
      window.location.assign('/');
      return;
    }
    navigate('/');
  };

  if (loadState.status === 'loading') return <RouteLoading fullPage={fullPage} />;
  if (loadState.status === 'error') {
    return (
      <RouteFailurePanel
        error={loadState.error}
        routeId={routeId}
        fullPage={fullPage}
        onRetry={() => {
          setLoadState({ status: 'loading' });
          setGeneration(value => value + 1);
        }}
        onHome={goHome}
      />
    );
  }

  const LoadedRoute = loadState.component;
  return <LoadedRoute />;
}

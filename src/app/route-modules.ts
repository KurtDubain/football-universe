type RouteImporter = () => Promise<unknown>;

export const routeImporters = {
  dashboard: () => import('../pages/Dashboard'),
  calendar: () => import('../pages/Calendar'),
  league: () => import('../pages/League'),
  cup: () => import('../pages/Cup'),
  coaches: () => import('../pages/Coaches'),
  teamDetail: () => import('../pages/TeamDetail'),
  coachDetail: () => import('../pages/CoachDetail'),
  history: () => import('../pages/History'),
  compare: () => import('../pages/Compare'),
  chronicle: () => import('../pages/Chronicle'),
  legends: () => import('../pages/Legends'),
  teams: () => import('../pages/Teams'),
  players: () => import('../pages/Players'),
  playerDetail: () => import('../pages/PlayerDetail'),
  settings: () => import('../pages/Settings'),
  teamEditor: () => import('../pages/TeamEditor'),
  transfers: () => import('../pages/Transfers'),
  market: () => import('../pages/Market'),
  memorable: () => import('../pages/MemorableMatches'),
  search: () => import('../pages/AdvancedSearch'),
} satisfies Record<string, RouteImporter>;

export type RouteModuleKey = keyof typeof routeImporters;

const preloadCache = new Map<RouteModuleKey, Promise<unknown>>();

/**
 * Modules that have already finished loading, keyed by their importer.
 *
 * The preload cache only ever saved the network request: the route component
 * still started in its `loading` state and rendered a skeleton for at least one
 * frame even when the module was sitting in the browser's module cache. Keeping
 * the resolved value lets the route start in `ready` and skip the skeleton
 * entirely on a hover-preloaded navigation.
 */
const resolvedRouteModules = new WeakMap<RouteImporter, unknown>();

export function rememberResolvedRouteModule(importer: RouteImporter, module: unknown): void {
  resolvedRouteModules.set(importer, module);
}

export function peekResolvedRouteModule(importer: RouteImporter): unknown | null {
  return resolvedRouteModules.get(importer) ?? null;
}

export function routeModuleKeyForPath(pathname: string): RouteModuleKey | null {
  if (pathname === '/') return 'dashboard';
  if (pathname === '/calendar') return 'calendar';
  if (/^\/league\/[^/]+$/.test(pathname)) return 'league';
  if (/^\/cup\/[^/]+$/.test(pathname)) return 'cup';
  if (pathname === '/teams') return 'teams';
  if (pathname === '/coaches') return 'coaches';
  if (pathname === '/players') return 'players';
  if (/^\/player\/[^/]+$/.test(pathname)) return 'playerDetail';
  if (/^\/team\/[^/]+$/.test(pathname)) return 'teamDetail';
  if (/^\/coach\/[^/]+$/.test(pathname)) return 'coachDetail';
  if (pathname === '/history') return 'history';
  if (pathname === '/chronicle') return 'chronicle';
  if (pathname === '/legends') return 'legends';
  if (pathname === '/transfers') return 'transfers';
  if (pathname === '/market') return 'market';
  if (pathname === '/memorable') return 'memorable';
  if (pathname === '/search') return 'search';
  if (pathname === '/compare') return 'compare';
  if (pathname === '/team-editor') return 'teamEditor';
  if (pathname === '/settings') return 'settings';
  return null;
}

function shouldAvoidPrefetch(): boolean {
  if (typeof navigator === 'undefined') return false;
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  return Boolean(connection?.saveData || connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g');
}

export function preloadRouteForPath(pathname: string): Promise<unknown> | null {
  if (shouldAvoidPrefetch()) return null;
  const key = routeModuleKeyForPath(pathname);
  if (!key) return null;
  const existing = preloadCache.get(key);
  if (existing) return existing;
  const importer = routeImporters[key];
  const pending = importer().then((module) => {
    rememberResolvedRouteModule(importer, module);
    return module;
  }).catch((error) => {
    preloadCache.delete(key);
    throw error;
  });
  preloadCache.set(key, pending);
  return pending;
}

export function resetRoutePreloadCacheForTests(): void {
  preloadCache.clear();
}

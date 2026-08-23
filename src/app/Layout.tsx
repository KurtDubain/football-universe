import { type ReactNode, useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { getWindowTypeLabel, getWindowTypeColor, getTeamName } from '../utils/format';
import Logo from '../components/Logo';
import NewsTicker from '../components/NewsTicker';
import TournamentMusicDirector from '../components/TournamentMusicDirector';
import TournamentMusicNowPlaying from '../components/TournamentMusicNowPlaying';
import AchievementToast from '../components/AchievementToast';
import { APP_VERSION } from '../version';
import {
  setAdvancePreferences,
  useAdvancePreferences,
} from './advance-preferences';
import { SAVE_STORAGE_KEY } from '../store/save-schema';
import { conservativeUTF16Bytes, isSaveNearCapacity } from '../store/save-budget';
import MobileDrawer from '../components/MobileDrawer';
import FloatingAdvanceButton from '../components/FloatingAdvanceButton';
import { planNextKeyNode } from '../engine/observation/key-node';
import { Icon, type IconName } from '../components/Icon';
import {
  setFeedbackPreferences,
  useFeedbackPreferences,
} from '../feedback/preferences';
import {
  playGameFeedback,
  playUiFeedback,
  suspendGameAudio,
  unlockGameAudio,
} from '../feedback/game-feedback';
import { preloadRouteForPath } from './route-modules';

interface LayoutProps {
  children: ReactNode;
}

const routeScrollPositions = new Map<string, number>();
const ROUTE_SCROLL_STORAGE_PREFIX = 'football-route-scroll:';
const HISTORY_SCROLL_STATE_KEY = 'footballRouteScroll';
const MAX_ROUTE_SCROLL_MEMORY_ENTRIES = 160;

function setRouteScrollMemory(key: string, scrollTop: number): void {
  routeScrollPositions.delete(key);
  routeScrollPositions.set(key, scrollTop);
  while (routeScrollPositions.size > MAX_ROUTE_SCROLL_MEMORY_ENTRIES) {
    const oldestKey = routeScrollPositions.keys().next().value;
    if (oldestKey === undefined) break;
    routeScrollPositions.delete(oldestKey);
  }
}

function rememberRouteScroll(key: string, pathname: string, scrollTop: number): void {
  setRouteScrollMemory(`key:${key}`, scrollTop);
  setRouteScrollMemory(`path:${pathname}`, scrollTop);
  try {
    sessionStorage.setItem(`${ROUTE_SCROLL_STORAGE_PREFIX}${pathname}`, String(scrollTop));
  } catch {
    // In-memory restoration remains available when session storage is blocked.
  }
  try {
    if (window.location.pathname === pathname) {
      window.history.replaceState({
        ...window.history.state,
        [HISTORY_SCROLL_STATE_KEY]: { pathname, scrollTop },
      }, '');
    }
  } catch {
    // Router navigation remains functional if history state cannot be updated.
  }
}

function readRouteScroll(key: string, pathname: string): number {
  const historyScroll = window.history.state?.[HISTORY_SCROLL_STATE_KEY] as {
    pathname?: string;
    scrollTop?: number;
  } | undefined;
  if (historyScroll?.pathname === pathname && Number.isFinite(historyScroll.scrollTop)) {
    return Number(historyScroll.scrollTop);
  }
  try {
    const raw = sessionStorage.getItem(`${ROUTE_SCROLL_STORAGE_PREFIX}${pathname}`);
    if (raw !== null) {
      const stored = Number(raw);
      if (Number.isFinite(stored)) return stored;
    }
  } catch {
    // Fall through to in-memory history when session storage is blocked.
  }
  return routeScrollPositions.get(`key:${key}`) ?? routeScrollPositions.get(`path:${pathname}`) ?? 0;
}

const navSections: Array<{
  title: string;
  items: Array<{ to: string; label: string; icon: IconName; end?: boolean }>;
}> = [
  {
    title: '总览',
    items: [
      { to: '/', label: '主页', icon: 'eye', end: true },
      { to: '/calendar', label: '赛历', icon: 'chart' },
    ],
  },
  {
    title: '联赛',
    items: [
      { to: '/league/1', label: '顶级联赛', icon: 'crown' },
      { to: '/league/2', label: '甲级联赛', icon: 'medal' },
      { to: '/league/3', label: '乙级联赛', icon: 'leaf' },
    ],
  },
  {
    title: '杯赛',
    items: [
      { to: '/cup/league_cup', label: '联赛杯', icon: 'trophy' },
      { to: '/cup/super_cup', label: '超级杯', icon: 'star' },
    ],
  },
  {
    title: '管理',
    items: [
      { to: '/teams', label: '球队中心', icon: 'shield' },
      { to: '/compare', label: '球队对比', icon: 'chart' },
      { to: '/coaches', label: '教练中心', icon: 'tie' },
      { to: '/players', label: '球员中心', icon: 'ball' },
      { to: '/settings', label: '设置', icon: 'clipboard' },
    ],
  },
];

/**
 * Continental cup navigation entries — visible only in scheduled seasons when the
 * corresponding cup state is non-null. Each entry hides naturally when the
 * cup didn't run for that region this season (e.g. shrinking after a
 * mid-game team migration).
 */
const continentalCupNavItems: { to: string; label: string; key: 'mainland_cup' | 'southern_cup' | 'eastern_cup' }[] = [
  { to: '/cup/mainland_cup', label: '大陆杯', key: 'mainland_cup' },
  { to: '/cup/southern_cup', label: '南洲杯', key: 'southern_cup' },
  { to: '/cup/eastern_cup',  label: '东洲杯', key: 'eastern_cup' },
];

function getMobileReturnTarget(pathname: string): { to: string; label: string } | null {
  if (pathname === '/') return null;
  if (pathname.startsWith('/team/')) return { to: '/teams', label: '球队中心' };
  if (pathname.startsWith('/player/')) return { to: '/players', label: '球员中心' };
  if (pathname.startsWith('/coach/')) return { to: '/coaches', label: '教练中心' };
  if (pathname === '/team-editor') return { to: '/settings', label: '设置' };
  return { to: '/', label: '主页' };
}

export default function Layout({ children }: LayoutProps) {
  const world = useGameStore((s) => s.world);
  const lastWorldResponse = useGameStore((s) => s.lastWorldResponse);
  const isAdvancing = useGameStore((s) => s.isAdvancing);
  const advanceWindow = useGameStore((s) => s.advanceWindow);
  const batchAdvance = useGameStore((s) => s.batchAdvance);
  const advanceToNextKeyNode = useGameStore((s) => s.advanceToNextKeyNode);
  const skipCurrentSeason = useGameStore((s) => s.skipCurrentSeason);
  const advanceError = useGameStore((s) => s.advanceError);
  const dismissAdvanceError = useGameStore((s) => s.dismissAdvanceError);
  const getCurrentWindow = useGameStore((s) => s.getCurrentWindow);
  const resetGame = useGameStore((s) => s.resetGame);
  const favoriteTeamIds = useGameStore((s) => s.favoriteTeamIds);
  const starredFixtureIds = useGameStore((s) => s.starredFixtureIds);
  const feedbackPreferences = useFeedbackPreferences();
  const advancePreferences = useAdvancePreferences();
  const favoriteTeamNames = useMemo(
    () => favoriteTeamIds.flatMap(id => {
      const team = world?.teamBases[id];
      return team ? [team.name, team.shortName] : [];
    }).filter(Boolean),
    [favoriteTeamIds, world?.teamBases],
  );
  const featuredFixtureIds = useMemo(
    () => new Set(lastWorldResponse?.featuredResults.map(item => item.result.fixtureId) ?? []),
    [lastWorldResponse],
  );
  const location = useLocation();
  const navigate = useNavigate();
  const mobileReturnTarget = getMobileReturnTarget(location.pathname);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showFastMenu, setShowFastMenu] = useState(false);
  const [confirmSkipSeason, setConfirmSkipSeason] = useState(false);
  const [advanceLabel, setAdvanceLabel] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const routeScrollSaveTimerRef = useRef<number | null>(null);
  const routeRestoreRef = useRef({ identity: '', target: 0, active: false });
  const routeIdentity = `${location.key}:${location.pathname}`;
  if (routeRestoreRef.current.identity !== routeIdentity) {
    const target = readRouteScroll(location.key, location.pathname);
    routeRestoreRef.current = { identity: routeIdentity, target, active: target > 0 };
  }
  const [saveNearCapacity, setSaveNearCapacity] = useState(() => {
    try {
      return isSaveNearCapacity(conservativeUTF16Bytes(localStorage.getItem(SAVE_STORAGE_KEY)));
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const handleSaveError = () => setSaveError(true);
    window.addEventListener('football-save-error', handleSaveError);
    return () => window.removeEventListener('football-save-error', handleSaveError);
  }, []);

  useEffect(() => {
    const preloadFromEvent = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!target || target.origin !== window.location.origin || target.target === '_blank') return;
      if (event.type !== 'pointerover' && mainRef.current) {
        rememberRouteScroll(location.key, location.pathname, mainRef.current.scrollTop);
      }
      const pending = preloadRouteForPath(target.pathname);
      if (pending) void pending.catch(() => undefined);
    };
    document.addEventListener('pointerover', preloadFromEvent, { capture: true, passive: true });
    document.addEventListener('pointerdown', preloadFromEvent, { capture: true, passive: true });
    document.addEventListener('focusin', preloadFromEvent, { capture: true });
    return () => {
      document.removeEventListener('pointerover', preloadFromEvent, { capture: true });
      document.removeEventListener('pointerdown', preloadFromEvent, { capture: true });
      document.removeEventListener('focusin', preloadFromEvent, { capture: true });
    };
  }, [location.key, location.pathname]);

  useEffect(() => () => {
    if (routeScrollSaveTimerRef.current !== null) window.clearTimeout(routeScrollSaveTimerRef.current);
  }, []);

  useLayoutEffect(() => {
    const element = mainRef.current;
    if (!element) return;
    const targetScroll = routeRestoreRef.current.target;
    let observer: ResizeObserver | null = null;
    let restoreTimeout = 0;
    let restoreRetry = 0;
    const applyRestore = () => {
      element.scrollTop = targetScroll;
      if (targetScroll === 0 || Math.abs(element.scrollTop - targetScroll) <= 2) {
        routeRestoreRef.current.active = false;
        observer?.disconnect();
        if (restoreTimeout) window.clearTimeout(restoreTimeout);
        if (restoreRetry) window.clearTimeout(restoreRetry);
      }
    };
    applyRestore();
    if (targetScroll > 0 && Math.abs(element.scrollTop - targetScroll) > 2) {
      observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(applyRestore);
      observer?.observe(element);
      restoreTimeout = window.setTimeout(() => observer?.disconnect(), 600);
      restoreRetry = window.setTimeout(applyRestore, 80);
      window.requestAnimationFrame(applyRestore);
    }
    return () => {
      observer?.disconnect();
      if (restoreTimeout) window.clearTimeout(restoreTimeout);
      if (restoreRetry) window.clearTimeout(restoreRetry);
      rememberRouteScroll(location.key, location.pathname, element.scrollTop);
    };
  }, [location.key, location.pathname]);

  useEffect(() => {
    const handleSaveSize = (event: Event) => {
      const detail = (event as CustomEvent<{ name: string; bytes: number }>).detail;
      if (detail.name === SAVE_STORAGE_KEY) setSaveNearCapacity(isSaveNearCapacity(detail.bytes));
    };
    window.addEventListener('football-save-size', handleSaveSize);
    return () => window.removeEventListener('football-save-size', handleSaveSize);
  }, []);

  const currentWindow = getCurrentWindow();
  const nextKeyNode = useMemo(
    () => world ? planNextKeyNode(world, favoriteTeamIds, starredFixtureIds) : null,
    [favoriteTeamIds, starredFixtureIds, world],
  );
  const showLatestResponse = () => {
    if (advancePreferences.stayOnCurrentView) return;
    if (location.pathname !== '/') {
      navigate('/', { state: { showLatestResults: true } });
    }
  };
  const handleWindowAdvance = async () => {
    setAdvanceLabel('结算本轮');
    playUiFeedback('advance');
    try {
      const advanced = await advanceWindow();
      if (!advanced) playUiFeedback('reject');
      if (advanced) showLatestResponse();
    } finally {
      setAdvanceLabel(null);
    }
  };
  const handleBatchAdvance = async (count: number) => {
    setShowFastMenu(false);
    setAdvanceLabel(`结算 ${count} 轮`);
    playUiFeedback('advance');
    try {
      const advanced = await batchAdvance(count);
      if (!advanced) playUiFeedback('reject');
      if (advanced) showLatestResponse();
    } finally {
      setAdvanceLabel(null);
    }
  };
  const handleKeyNodeAdvance = async () => {
    setShowFastMenu(false);
    setAdvanceLabel('前往关键节点');
    playUiFeedback('advance');
    try {
      const advanced = await advanceToNextKeyNode();
      if (!advanced) playUiFeedback('reject');
      if (advanced) showLatestResponse();
    } finally {
      setAdvanceLabel(null);
    }
  };
  const handleSkipSeason = async () => {
    setShowFastMenu(false);
    setConfirmSkipSeason(false);
    setAdvanceLabel('结算本赛季');
    playUiFeedback('advance');
    try {
      const advanced = await skipCurrentSeason();
      if (!advanced) playUiFeedback('reject');
      if (advanced) showLatestResponse();
    } finally {
      setAdvanceLabel(null);
    }
  };
  const handleFloatingAdvance = handleWindowAdvance;
  const toggleGlobalSound = () => {
    const soundEnabled = !feedbackPreferences.soundEnabled;
    setFeedbackPreferences({ soundEnabled });
    if (soundEnabled) {
      unlockGameAudio();
      playGameFeedback('start');
    } else {
      suspendGameAudio();
    }
  };
  const isWorldCupYear = world?.seasonState.isWorldCupYear ?? false;
  const seasonNumber = world?.seasonState.seasonNumber ?? 1;
  const calendarLen = world?.seasonState.calendar.length ?? 0;
  const completedWindows = world?.seasonState.calendar.filter(w => w.completed).length ?? 0;

  const navContent = (
    <>
      <div className="season-nav-status px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="ui-eyebrow text-[10px] text-[var(--text-secondary)]">SEASON {String(seasonNumber).padStart(2, '0')}</span>
          {isWorldCupYear && (
            <span className="rounded-sm border border-emerald-600/45 bg-emerald-950/50 px-1.5 py-0.5 text-[11px] text-emerald-300">WC</span>
          )}
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden bg-black/35">
          <div
            className="h-full bg-[var(--action)] transition-all"
            style={{ width: `${calendarLen > 0 ? (completedWindows / calendarLen) * 100 : 0}%` }}
          />
        </div>
        <span className="mt-1 block text-[11px] text-[var(--text-disabled)]">{completedWindows}/{calendarLen} 窗口</span>
      </div>

      {/* Favorite teams (up to 3) */}
      {favoriteTeamIds.length > 0 && world && (
        <div className="px-4 py-2 border-b border-slate-700/60 space-y-1.5">
          {favoriteTeamIds.map((tid) => {
            const team = world.teamBases[tid];
            const ts = world.teamStates[tid];
            if (!team) return null;
            return (
              <NavLink
                key={tid}
                to={`/team/${tid}`}
                onClick={() => setMobileNavOpen(false)}
                className="mobile-nav-item block rounded-md px-1.5 py-1 transition-colors hover:bg-slate-700/40 focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
              >
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: team.color ?? '#666' }} />
                  <span className="truncate text-xs font-medium text-slate-200">
                    {getTeamName(tid, world.teamBases)}
                  </span>
                </div>
                {ts && (
                  <div className="mt-0.5 flex gap-2 text-[11px] text-slate-500">
                    <span>士气 {ts.morale}</span>
                    <span>势头 {ts.momentum > 0 ? '+' : ''}{ts.momentum}</span>
                  </div>
                )}
              </NavLink>
            );
          })}
        </div>
      )}

      <nav className="flex-1 py-2 overflow-y-auto">
        {navSections.map((section) => (
          <div key={section.title} className="mb-1">
            <div className="app-nav-section-label px-4 py-1.5">
              {section.title}
            </div>
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={'end' in item ? item.end : false}
                onClick={() => setMobileNavOpen(false)}
                className={({ isActive }) => `app-nav-link mobile-nav-item mx-2 ${isActive ? 'is-active' : ''}`}
              >
                <Icon name={item.icon} size={15} />
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}

        {isWorldCupYear && (
          <div className="mb-1">
            <NavLink
              to="/cup/world_cup"
              onClick={() => setMobileNavOpen(false)}
              className={({ isActive }) => `app-nav-link app-nav-link-world mobile-nav-item mx-2 ${isActive ? 'is-active' : ''}`}
            >
              <Icon name="stadium" size={15} />
              环球冠军杯
            </NavLink>
          </div>
        )}

        {/* Continental cups — scheduled seasons only, only render the regions that
            actually have a cup running this season. */}
        {(() => {
          const cc = world?.continentalCups;
          if (!cc) return null;
          const visible = continentalCupNavItems.filter(item => cc[item.key]);
          if (visible.length === 0) return null;
          return (
            <div className="mb-1">
              <div className="app-nav-section-label px-4 py-1.5 text-orange-400">洲际杯</div>
              {visible.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileNavOpen(false)}
                  className={({ isActive }) => `app-nav-link app-nav-link-continental mobile-nav-item mx-2 ${isActive ? 'is-active' : ''}`}
                >
                  <Icon name="trophy" size={15} />
                  {item.label}
                </NavLink>
              ))}
            </div>
          );
        })()}

        <div className="mb-1">
          <div className="app-nav-section-label px-4 py-1.5">记录</div>
          <NavLink
            to="/history"
            onClick={() => setMobileNavOpen(false)}
            className={({ isActive }) => `app-nav-link mobile-nav-item mx-2 ${isActive ? 'is-active' : ''}`}
          >
            <Icon name="trophy" size={15} />
            历史荣誉
          </NavLink>
          <NavLink
            to="/legends"
            onClick={() => setMobileNavOpen(false)}
            className={({ isActive }) => `app-nav-link mobile-nav-item mx-2 ${isActive ? 'is-active' : ''}`}
          >
            <Icon name="building" size={15} />
            传奇名人堂
          </NavLink>
          <NavLink
            to="/chronicle"
            onClick={() => setMobileNavOpen(false)}
            className={({ isActive }) => `app-nav-link mobile-nav-item mx-2 ${isActive ? 'is-active' : ''}`}
          >
            <Icon name="clipboard" size={15} />
            编年史
          </NavLink>
          <NavLink
            to="/transfers"
            onClick={() => setMobileNavOpen(false)}
            className={({ isActive }) => `app-nav-link mobile-nav-item mx-2 ${isActive ? 'is-active' : ''}`}
          >
            <Icon name="handshake" size={15} />
            转会窗口
          </NavLink>
          <NavLink
            to="/memorable"
            onClick={() => setMobileNavOpen(false)}
            className={({ isActive }) => `app-nav-link mobile-nav-item mx-2 ${isActive ? 'is-active' : ''}`}
          >
            <Icon name="fire" size={15} />
            经典战役
          </NavLink>
          <NavLink
            to="/search"
            onClick={() => setMobileNavOpen(false)}
            className={({ isActive }) => `app-nav-link mobile-nav-item mx-2 ${isActive ? 'is-active' : ''}`}
          >
            <Icon name="target" size={15} />
            高级搜索
          </NavLink>
        </div>
      </nav>

      <div className="p-3 border-t border-slate-700/60 space-y-2">
        <button
          onClick={() => {
            if (window.confirm('确定要重置当前游戏吗？此操作会清除当前存档。')) resetGame();
          }}
          className="mobile-nav-item w-full px-3 py-2 text-xs text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors cursor-pointer"
        >
          重置游戏
        </button>
        <p className="text-center text-[11px] text-slate-600">v{APP_VERSION} · by KurtDubain</p>
      </div>
    </>
  );

  return (
    <div data-testid="app-shell" className="h-[100dvh] bg-[var(--surface-page)] flex overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="app-sidebar hidden md:flex w-52 bg-[var(--surface-panel)] border-r border-[var(--border-subtle)] flex-col shrink-0 relative">
        <div className="app-brand-lockup p-3">
          <div className="flex items-center gap-2">
            <Logo size={30} />
            <div>
              <h1 className="text-sm font-bold text-[var(--text-primary)] leading-none">足球联赛宇宙</h1>
              <p className="ui-eyebrow mt-1 text-[9px] text-[var(--competition-gold)]">SEASON ARCHIVE</p>
            </div>
          </div>
        </div>
        {navContent}
      </aside>

      {/* Mobile nav overlay */}
      <MobileDrawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        labelledBy="mobile-navigation-title"
      >
        <div className="p-3 border-b border-slate-700/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo size={28} />
            <span id="mobile-navigation-title" className="text-sm font-bold text-slate-100">足球联赛宇宙</span>
          </div>
          <button
            onClick={() => setMobileNavOpen(false)}
            aria-label="关闭导航菜单"
            className="w-11 h-11 flex items-center justify-center text-slate-400 hover:text-slate-200 cursor-pointer"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"/></svg>
          </button>
        </div>
        {navContent}
      </MobileDrawer>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        <TournamentMusicDirector seasonNumber={seasonNumber} />
        {/* Top bar */}
        <header className="app-shell-header h-[48px] bg-[var(--surface-floating)] border-b border-[var(--border-subtle)] flex items-center justify-between px-3 sm:px-5 shrink-0 relative z-[70]">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileNavOpen(true)}
              aria-label="打开导航菜单"
              className="md:hidden h-[44px] w-[44px] flex items-center justify-center text-slate-400 hover:text-slate-200 cursor-pointer shrink-0"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd"/></svg>
            </button>
            {mobileReturnTarget && (
              <button
                type="button"
                data-testid="mobile-route-back"
                onClick={() => {
                  const canGoBack = Number(window.history.state?.idx ?? 0) > 0;
                  if (canGoBack) navigate(-1);
                  else navigate(mobileReturnTarget.to);
                }}
                aria-label="返回上一页"
                title={`返回上一页（直接访问时返回${mobileReturnTarget.label}）`}
                className="md:hidden flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-md text-xl text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
              >
                <span aria-hidden="true">←</span>
              </button>
            )}
            {currentWindow && (
              <>
                <span className={`hidden sm:inline-block px-2 py-0.5 rounded text-[11px] font-medium text-white shrink-0 ${getWindowTypeColor(currentWindow.type)}`}>
                  {getWindowTypeLabel(currentWindow.type)}
                </span>
                <span
                  title={currentWindow.label}
                  className={`text-sm text-slate-300 font-medium truncate ${mobileReturnTarget ? 'hidden sm:inline' : ''}`}
                >
                  {currentWindow.label}
                </span>
              </>
            )}
            {!currentWindow && (
              <span className={`text-sm text-slate-500 ${mobileReturnTarget ? 'hidden sm:inline' : ''}`}>赛季已结束</span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0 relative z-[65]">
            <button
              type="button"
              data-testid="global-sound-toggle"
              aria-label={feedbackPreferences.soundEnabled ? '关闭全局声音' : '开启全局声音'}
              aria-pressed={feedbackPreferences.soundEnabled}
              title={feedbackPreferences.soundEnabled ? '关闭全局声音' : '开启全局声音'}
              onClick={toggleGlobalSound}
              className="flex h-[44px] w-[44px] items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 sm:h-8 sm:w-8"
            >
              <Icon name={feedbackPreferences.soundEnabled ? 'volume' : 'volume-off'} size={17} />
            </button>
            {location.pathname !== '/' && (
              <button
                data-testid="header-advance"
                onClick={handleWindowAdvance}
                aria-busy={isAdvancing}
                disabled={isAdvancing || !currentWindow}
                className="ui-action-feedback h-[44px] min-w-[44px] rounded-l-md bg-[var(--action)] px-3 text-sm font-medium text-white transition-colors hover:bg-[var(--action-hover)] disabled:cursor-not-allowed disabled:bg-[var(--surface-raised)] disabled:text-[var(--text-disabled)] sm:h-auto sm:px-4 sm:py-1.5"
              >
                {isAdvancing ? (advanceLabel ?? '结算中') : currentWindow ? '推进' : '完成'}
              </button>
            )}
            {currentWindow && (
              <button
                onClick={() => {
                  setShowFastMenu(value => !value);
                  setConfirmSkipSeason(false);
                }}
                disabled={isAdvancing}
                aria-expanded={showFastMenu}
                aria-haspopup="menu"
                aria-label="打开快进菜单"
                title="推进选项"
                className={`inline-flex h-[44px] w-[44px] items-center justify-center text-white transition-colors disabled:bg-[var(--surface-raised)] disabled:text-[var(--text-disabled)] sm:h-8 sm:w-8 ${
                  location.pathname === '/'
                    ? 'rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:bg-[#263029] hover:text-white'
                    : 'rounded-r-md border-l border-white/20 bg-[var(--action)] hover:bg-[var(--action-hover)]'
                }`}
              >
                <Icon name="fast-forward" size={16} />
              </button>
            )}
            {showFastMenu && currentWindow && (
              <div
                data-testid="advance-menu"
                role="menu"
                className="advance-menu-sheet absolute right-0 top-full z-[60] mt-1 max-h-[calc(100dvh-4rem)] w-[min(19rem,calc(100vw-24px))] overflow-y-auto border border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-xl"
              >
                <div className="border-b border-slate-700/70 p-2">
                  <button
                    type="button"
                    data-testid="advance-next-key-node"
                    onClick={handleKeyNodeAdvance}
                    disabled={!nextKeyNode || nextKeyNode.blocked || isAdvancing}
                    className="press-scale min-h-11 w-full rounded-md bg-emerald-700 px-3 py-2 text-left text-xs font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                  >
                    {nextKeyNode?.blocked ? '当前就是关键节点' : '前往下一关键节点'}
                  </button>
                  {nextKeyNode ? (
                    <div className="px-1 pb-1 pt-2 text-[11px] leading-4">
                      <div className={nextKeyNode.blocked ? 'text-amber-300' : 'text-emerald-300'}>
                        {nextKeyNode.reasonLabel} · {nextKeyNode.windowLabel}
                      </div>
                      <div className="mt-0.5 text-slate-400">
                        {nextKeyNode.detail}
                      </div>
                      {!nextKeyNode.blocked && (
                        <div className="mt-0.5 text-slate-500">
                          将结算 {nextKeyNode.skipWindows} 个窗口，并在该节点前停下。
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="px-1 pb-1 pt-2 text-[11px] text-slate-500">当前赛历没有可前往的后续节点。</div>
                  )}
                </div>
                <div className="px-3 pb-1 pt-2 text-[11px] font-semibold text-slate-500">固定步数</div>
                <div className="grid grid-cols-2 px-2 pb-1">
                  <button
                    onClick={() => handleBatchAdvance(5)}
                    disabled={isAdvancing || nextKeyNode?.blocked}
                    className="press-scale min-h-11 cursor-pointer px-2 py-2 text-xs text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    推进 5 轮
                  </button>
                  <button
                    onClick={() => handleBatchAdvance(10)}
                    disabled={isAdvancing || nextKeyNode?.blocked}
                    className="press-scale min-h-11 cursor-pointer px-2 py-2 text-xs text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    推进 10 轮
                  </button>
                </div>
                <p className={`px-3 pb-2 text-[11px] leading-4 ${
                  nextKeyNode?.blocked ? 'text-amber-300/80' : 'text-slate-600'
                }`}>
                  {nextKeyNode?.blocked
                    ? '当前关键内容处理完成后，固定步数推进会重新开放。'
                    : '固定步数会连续结算，不会在中途关键节点前自动停下。'}
                </p>
                <div className="border-t border-slate-700/70 px-3 py-2.5">
                  <label className="flex min-h-11 cursor-pointer items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-slate-200">推进后停留当前视图</span>
                      <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">保留当前页面与标签，不自动返回战报。</span>
                    </span>
                    <input
                      data-testid="stay-on-current-view-toggle"
                      type="checkbox"
                      checked={advancePreferences.stayOnCurrentView}
                      onChange={event => setAdvancePreferences({ stayOnCurrentView: event.target.checked })}
                      className="h-5 w-5 shrink-0 accent-emerald-500"
                    />
                  </label>
                </div>
                <div className="border-t border-slate-700/70 p-2">
                  {!confirmSkipSeason ? (
                    <button
                      type="button"
                      data-testid="skip-current-season"
                      onClick={() => setConfirmSkipSeason(true)}
                      disabled={isAdvancing}
                      className="press-scale min-h-11 w-full rounded-md border border-amber-700/55 px-3 py-2 text-left text-xs font-semibold text-amber-200 hover:bg-amber-900/25 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      直接跳过当前赛季
                    </button>
                  ) : (
                    <div data-testid="skip-season-confirmation" className="border border-amber-700/45 bg-amber-950/20 p-2.5">
                      <p className="text-xs font-semibold text-amber-100">完整结算本赛季剩余内容？</p>
                      <p className="mt-1 text-[11px] leading-4 text-slate-400">比赛、转会、伤病、奖项与历史档案都会正常生成，并停在新赛季首个窗口。</p>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmSkipSeason(false)}
                          className="min-h-11 rounded border border-slate-600 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          data-testid="confirm-skip-current-season"
                          onClick={() => void handleSkipSeason()}
                          className="min-h-11 rounded bg-amber-700 text-xs font-semibold text-white hover:bg-amber-600"
                        >
                          确认结算
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          {isAdvancing && (
            <div className="advance-activity-track" role="status" aria-live="polite">
              <span className="sr-only">{advanceLabel ?? '正在结算比赛与更新数据'}</span>
            </div>
          )}
        </header>

        {/* News ticker at top */}
        <NewsTicker
          news={world?.newsLog ?? []}
          favoriteTeamNames={favoriteTeamNames}
          excludedFixtureIds={featuredFixtureIds}
        />
        <TournamentMusicNowPlaying />

        {saveNearCapacity && (
          <div role="status" className="px-3 sm:px-5 py-2 bg-amber-950/60 border-b border-amber-700/50 text-amber-100 text-xs flex items-center gap-2">
            <span className="flex-1">存档已接近浏览器容量上限，请及时导出备份或清理已完成比赛的详细回放。</span>
            <NavLink to="/settings" className="shrink-0 text-amber-300 hover:text-white underline">前往设置</NavLink>
            <button type="button" aria-label="关闭存档容量提示" onClick={() => setSaveNearCapacity(false)} className="w-8 h-8 shrink-0 text-amber-300 hover:text-white">×</button>
          </div>
        )}

        {/* Content */}
        <main
          ref={mainRef}
          onScroll={(event) => {
            const restoration = routeRestoreRef.current;
            if (restoration.active && Math.abs(event.currentTarget.scrollTop - restoration.target) > 2) return;
            restoration.active = false;
            if (routeScrollSaveTimerRef.current !== null) window.clearTimeout(routeScrollSaveTimerRef.current);
            const scrollTop = event.currentTarget.scrollTop;
            const routeKey = location.key;
            const pathname = location.pathname;
            routeScrollSaveTimerRef.current = window.setTimeout(
              () => rememberRouteScroll(routeKey, pathname, scrollTop),
              120,
            );
          }}
          onClickCapture={(event) => {
            if (event.target instanceof Element && event.target.closest('a[href]')) {
              if (routeScrollSaveTimerRef.current !== null) window.clearTimeout(routeScrollSaveTimerRef.current);
              rememberRouteScroll(location.key, location.pathname, event.currentTarget.scrollTop);
            }
          }}
          className="app-route-content app-workspace tabular-nums flex-1 overflow-auto p-3 sm:p-5 route-enter"
          key={location.key}
        >
          {children}
        </main>
      </div>

      {/* Floating advance button */}
      <FloatingAdvanceButton
        stageLabel={currentWindow ? getWindowTypeLabel(currentWindow.type) : undefined}
        accentClass={currentWindow ? getWindowTypeColor(currentWindow.type) : undefined}
        isAdvancing={isAdvancing}
        busyLabel={advanceLabel ?? undefined}
        disabled={isAdvancing || !currentWindow}
        onAdvance={handleFloatingAdvance}
      />

      {/* Achievement toast */}
      <AchievementToastContainer />
      {saveError && (
        <div role="alert" className="fixed left-3 right-3 bottom-3 sm:left-auto sm:w-96 z-[120] bg-red-950 border border-red-700 text-red-100 px-3 py-3 rounded-lg shadow-xl flex items-start gap-3">
          <span className="text-xs flex-1">存档写入失败，当前进度仍保留在本页内存中。请先释放浏览器存储空间，再继续操作。</span>
          <button aria-label="关闭存档错误提示" onClick={() => setSaveError(false)} className="w-8 h-8 shrink-0 text-red-300 hover:text-white">×</button>
        </div>
      )}
      {advanceError && (
        <div role="alert" className="fixed left-3 right-3 bottom-3 sm:left-auto sm:w-96 z-[121] bg-red-950 border border-red-700 text-red-100 px-3 py-3 rounded-lg shadow-xl flex items-start gap-3">
          <span className="text-xs flex-1">{advanceError}</span>
          <button
            type="button"
            aria-label="关闭推进错误提示"
            onClick={dismissAdvanceError}
            className="w-8 h-8 shrink-0 text-red-300 hover:text-white"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function AchievementToastContainer() {
  const newAchievements = useGameStore(s => s.newAchievements);
  const dismissAchievement = useGameStore(s => s.dismissAchievement);
  if (newAchievements.length === 0) return null;
  return (
    <AchievementToast
      achievement={newAchievements[0]}
      remainingCount={newAchievements.length - 1}
      onDismiss={dismissAchievement}
    />
  );
}

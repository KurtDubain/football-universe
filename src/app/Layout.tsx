import { type ReactNode, useState, useEffect, useMemo } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { getWindowTypeLabel, getWindowTypeColor, getTeamName } from '../utils/format';
import Logo from '../components/Logo';
import NewsTicker from '../components/NewsTicker';
import TournamentMusicDirector from '../components/TournamentMusicDirector';
import TournamentMusicNowPlaying from '../components/TournamentMusicNowPlaying';
import AchievementToast from '../components/AchievementToast';
import { APP_VERSION } from '../version';
import { SAVE_STORAGE_KEY } from '../store/save-schema';
import { conservativeUTF16Bytes, isSaveNearCapacity } from '../store/save-budget';
import MobileDrawer from '../components/MobileDrawer';
import FloatingAdvanceButton from '../components/FloatingAdvanceButton';
import { planNextKeyNode } from '../engine/observation/key-node';
import { Icon } from '../components/Icon';
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

interface LayoutProps {
  children: ReactNode;
}

const navSections = [
  {
    title: '总览',
    items: [
      { to: '/', label: '主页', end: true },
      { to: '/calendar', label: '赛历' },
    ],
  },
  {
    title: '联赛',
    items: [
      { to: '/league/1', label: '顶级联赛' },
      { to: '/league/2', label: '甲级联赛' },
      { to: '/league/3', label: '乙级联赛' },
    ],
  },
  {
    title: '杯赛',
    items: [
      { to: '/cup/league_cup', label: '联赛杯' },
      { to: '/cup/super_cup', label: '超级杯' },
    ],
  },
  {
    title: '管理',
    items: [
      { to: '/teams', label: '球队中心' },
      { to: '/compare', label: '球队对比' },
      { to: '/coaches', label: '教练中心' },
      { to: '/players', label: '球员中心' },
      { to: '/settings', label: '设置' },
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
  const advanceError = useGameStore((s) => s.advanceError);
  const dismissAdvanceError = useGameStore((s) => s.dismissAdvanceError);
  const getCurrentWindow = useGameStore((s) => s.getCurrentWindow);
  const resetGame = useGameStore((s) => s.resetGame);
  const favoriteTeamIds = useGameStore((s) => s.favoriteTeamIds);
  const starredFixtureIds = useGameStore((s) => s.starredFixtureIds);
  const feedbackPreferences = useFeedbackPreferences();
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
  const [saveError, setSaveError] = useState(false);
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
    if (location.pathname !== '/') {
      navigate('/', { state: { showLatestResults: true } });
    }
  };
  const handleWindowAdvance = async () => {
    playUiFeedback('advance');
    const advanced = await advanceWindow();
    if (!advanced) playUiFeedback('reject');
    if (advanced) showLatestResponse();
  };
  const handleBatchAdvance = async (count: number) => {
    setShowFastMenu(false);
    playUiFeedback('advance');
    const advanced = await batchAdvance(count);
    if (!advanced) playUiFeedback('reject');
    if (advanced) showLatestResponse();
  };
  const handleKeyNodeAdvance = async () => {
    setShowFastMenu(false);
    playUiFeedback('advance');
    const advanced = await advanceToNextKeyNode();
    if (!advanced) playUiFeedback('reject');
    if (advanced) showLatestResponse();
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
      <div className="px-4 py-3 border-b border-slate-700/60">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">第 {seasonNumber} 赛季</span>
          {isWorldCupYear && (
            <span className="rounded bg-sky-900/50 px-1.5 py-0.5 text-[11px] text-sky-400">WC</span>
          )}
        </div>
        <div className="mt-1.5 w-full h-1 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500/80 rounded-full transition-all"
            style={{ width: `${calendarLen > 0 ? (completedWindows / calendarLen) * 100 : 0}%` }}
          />
        </div>
        <span className="mt-0.5 block text-[11px] text-slate-600">{completedWindows}/{calendarLen}</span>
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
            <div className="px-4 py-1.5 text-[11px] font-semibold text-slate-500">
              {section.title}
            </div>
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={'end' in item ? item.end : false}
                onClick={() => setMobileNavOpen(false)}
                className={({ isActive }) =>
                  `mobile-nav-item mx-2 flex items-center px-3 py-2 rounded-lg text-sm transition-all ${
                    isActive
                      ? 'bg-blue-600/90 text-white font-medium shadow-sm'
                      : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
                  }`
                }
              >
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
              className={({ isActive }) =>
                `mobile-nav-item mx-2 flex items-center px-3 py-2 rounded-lg text-sm transition-all ${
                  isActive
                    ? 'bg-sky-600/90 text-white font-medium shadow-sm'
                    : 'text-sky-400 hover:bg-sky-900/30 hover:text-sky-300'
                }`
              }
            >
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
              <div className="px-4 py-1.5 text-[11px] font-semibold text-orange-500">洲际杯</div>
              {visible.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileNavOpen(false)}
                  className={({ isActive }) =>
                    `mobile-nav-item mx-2 flex items-center px-3 py-2 rounded-lg text-sm transition-all ${
                      isActive
                        ? 'bg-orange-600/90 text-white font-medium shadow-sm'
                        : 'text-orange-300 hover:bg-orange-900/30 hover:text-orange-200'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          );
        })()}

        <div className="mb-1">
          <div className="px-4 py-1.5 text-[11px] font-semibold text-slate-500">记录</div>
          <NavLink
            to="/history"
            onClick={() => setMobileNavOpen(false)}
            className={({ isActive }) =>
              `mobile-nav-item mx-2 flex items-center px-3 py-2 rounded-lg text-sm transition-all ${
                isActive
                  ? 'bg-blue-600/90 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
              }`
            }
          >
            历史荣誉
          </NavLink>
          <NavLink
            to="/legends"
            onClick={() => setMobileNavOpen(false)}
            className={({ isActive }) =>
              `mobile-nav-item mx-2 flex items-center px-3 py-2 rounded-lg text-sm transition-all ${
                isActive
                  ? 'bg-blue-600/90 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
              }`
            }
          >
            <span className="mr-1.5" aria-hidden>🏛️</span>传奇名人堂
          </NavLink>
          <NavLink
            to="/chronicle"
            onClick={() => setMobileNavOpen(false)}
            className={({ isActive }) =>
              `mobile-nav-item mx-2 flex items-center px-3 py-2 rounded-lg text-sm transition-all ${
                isActive
                  ? 'bg-blue-600/90 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
              }`
            }
          >
            编年史
          </NavLink>
          <NavLink
            to="/transfers"
            onClick={() => setMobileNavOpen(false)}
            className={({ isActive }) =>
              `mobile-nav-item mx-2 flex items-center px-3 py-2 rounded-lg text-sm transition-all ${
                isActive
                  ? 'bg-blue-600/90 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
              }`
            }
          >
            转会窗口
          </NavLink>
          <NavLink
            to="/memorable"
            onClick={() => setMobileNavOpen(false)}
            className={({ isActive }) =>
              `mobile-nav-item mx-2 flex items-center px-3 py-2 rounded-lg text-sm transition-all ${
                isActive
                  ? 'bg-blue-600/90 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
              }`
            }
          >
            经典战役
          </NavLink>
          <NavLink
            to="/search"
            onClick={() => setMobileNavOpen(false)}
            className={({ isActive }) =>
              `mobile-nav-item mx-2 flex items-center px-3 py-2 rounded-lg text-sm transition-all ${
                isActive
                  ? 'bg-blue-600/90 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
              }`
            }
          >
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
      <aside className="hidden md:flex w-52 bg-[var(--surface-panel)] border-r border-[var(--border-subtle)] flex-col shrink-0 relative">
        <div className="p-3 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <Logo size={30} />
            <div>
              <h1 className="text-sm font-bold text-slate-100 leading-none">足球联赛宇宙</h1>
              <p className="mt-0.5 text-[11px] text-slate-500">电子斗蛐蛐模拟器</p>
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
                onClick={() => navigate(mobileReturnTarget.to)}
                aria-label={`返回${mobileReturnTarget.label}`}
                title={`返回${mobileReturnTarget.label}`}
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
                {isAdvancing ? '...' : currentWindow ? '推进' : '完成'}
              </button>
            )}
            {currentWindow && (
              <button
                onClick={() => setShowFastMenu(!showFastMenu)}
                disabled={isAdvancing}
                aria-label="打开快进菜单"
                className={`h-[44px] w-[44px] bg-[var(--action)] text-sm text-white transition-colors hover:bg-[var(--action-hover)] disabled:bg-[var(--surface-raised)] sm:h-auto sm:w-auto sm:px-1.5 sm:py-1.5 ${
                  location.pathname === '/' ? 'rounded-md' : 'rounded-r-md border-l border-white/20'
                }`}
              >
                ▾
              </button>
            )}
            {showFastMenu && currentWindow && (
              <div
                data-testid="advance-menu"
                className="absolute right-0 top-full z-[60] mt-1 w-[min(19rem,calc(100vw-24px))] overflow-hidden rounded-lg border border-slate-700 bg-slate-800 shadow-xl"
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
                      <div className="mt-0.5 text-slate-500">
                        {nextKeyNode.blocked
                          ? nextKeyNode.detail
                          : `将结算 ${nextKeyNode.skipWindows} 个窗口，并在该节点前停下。`}
                      </div>
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
              </div>
            )}
          </div>
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
        <main className="app-route-content tabular-nums flex-1 overflow-auto p-3 sm:p-5 animate-fade-in" key={location.pathname}>
          {children}
        </main>
      </div>

      {/* Floating advance button */}
      <FloatingAdvanceButton
        stageLabel={currentWindow ? getWindowTypeLabel(currentWindow.type) : undefined}
        accentClass={currentWindow ? getWindowTypeColor(currentWindow.type) : undefined}
        isAdvancing={isAdvancing}
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

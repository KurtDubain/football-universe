import { type ReactNode, useState, useEffect, useMemo } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { getWindowTypeLabel, getWindowTypeColor, getTeamName } from '../utils/format';
import Logo from '../components/Logo';
import NewsTicker from '../components/NewsTicker';
import AchievementToast from '../components/AchievementToast';
import { APP_VERSION } from '../version';
import { SAVE_STORAGE_KEY } from '../store/save-schema';
import { conservativeUTF16Bytes, isSaveNearCapacity } from '../store/save-budget';
import MobileDrawer from '../components/MobileDrawer';
import FloatingAdvanceButton from '../components/FloatingAdvanceButton';

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

export default function Layout({ children }: LayoutProps) {
  const world = useGameStore((s) => s.world);
  const isAdvancing = useGameStore((s) => s.isAdvancing);
  const advanceWindow = useGameStore((s) => s.advanceWindow);
  const batchAdvance = useGameStore((s) => s.batchAdvance);
  const advanceUntil = useGameStore((s) => s.advanceUntil);
  const getCurrentWindow = useGameStore((s) => s.getCurrentWindow);
  const resetGame = useGameStore((s) => s.resetGame);
  const favoriteTeamIds = useGameStore((s) => s.favoriteTeamIds);
  const favoriteTeamNames = useMemo(
    () => favoriteTeamIds.flatMap(id => {
      const team = world?.teamBases[id];
      return team ? [team.name, team.shortName] : [];
    }).filter(Boolean),
    [favoriteTeamIds, world?.teamBases],
  );
  const location = useLocation();
  const navigate = useNavigate();
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
  const [showFloatingBtn, setShowFloatingBtn] = useState(() => {
    try { return localStorage.getItem('floating-btn') === '1'; } catch { return false; }
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

  useEffect(() => {
    try {
      localStorage.setItem('floating-btn', showFloatingBtn ? '1' : '0');
    } catch {
      window.dispatchEvent(new CustomEvent('football-save-error'));
    }
  }, [showFloatingBtn]);

  const currentWindow = getCurrentWindow();
  const handleFloatingAdvance = async () => {
    await advanceWindow();
    if (location.pathname !== '/') {
      navigate('/', { state: { showLatestResults: true } });
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
              <div key={tid}>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: team.color ?? '#666' }} />
                  <NavLink to={`/team/${tid}`} className="text-xs text-slate-200 hover:text-blue-400 truncate font-medium">
                    {getTeamName(tid, world.teamBases)}
                  </NavLink>
                </div>
                {ts && (
                  <div className="mt-0.5 flex gap-2 text-[11px] text-slate-500">
                    <span>士气 {ts.morale}</span>
                    <span>势头 {ts.momentum > 0 ? '+' : ''}{ts.momentum}</span>
                  </div>
                )}
              </div>
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
                  `block mx-2 px-3 py-2 rounded-lg text-sm transition-all ${
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
                `block mx-2 px-3 py-2 rounded-lg text-sm transition-all ${
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
                    `block mx-2 px-3 py-2 rounded-lg text-sm transition-all ${
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
              `block mx-2 px-3 py-2 rounded-lg text-sm transition-all ${
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
              `block mx-2 px-3 py-2 rounded-lg text-sm transition-all ${
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
              `block mx-2 px-3 py-2 rounded-lg text-sm transition-all ${
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
              `block mx-2 px-3 py-2 rounded-lg text-sm transition-all ${
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
              `block mx-2 px-3 py-2 rounded-lg text-sm transition-all ${
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
              `block mx-2 px-3 py-2 rounded-lg text-sm transition-all ${
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
          className="w-full px-3 py-2 text-xs text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors cursor-pointer"
        >
          重置游戏
        </button>
        <p className="text-center text-[11px] text-slate-600">v{APP_VERSION} · by KurtDubain</p>
      </div>
    </>
  );

  return (
    <div className="h-[100dvh] bg-[var(--surface-page)] flex overflow-hidden">
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
        {/* Top bar */}
        <header className="h-12 bg-[var(--surface-floating)] border-b border-[var(--border-subtle)] flex items-center justify-between px-3 sm:px-5 shrink-0 relative z-[70]">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileNavOpen(true)}
              aria-label="打开导航菜单"
              className="md:hidden w-11 h-11 flex items-center justify-center text-slate-400 hover:text-slate-200 cursor-pointer shrink-0"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd"/></svg>
            </button>
            {currentWindow && (
              <>
                <span className={`hidden sm:inline-block px-2 py-0.5 rounded text-[11px] font-medium text-white shrink-0 ${getWindowTypeColor(currentWindow.type)}`}>
                  {getWindowTypeLabel(currentWindow.type)}
                </span>
                <span className="text-sm text-slate-300 font-medium truncate">
                  {currentWindow.label}
                </span>
              </>
            )}
            {!currentWindow && (
              <span className="text-sm text-slate-500">赛季已结束</span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0 relative z-[65]">
            <button
              onClick={advanceWindow}
              disabled={isAdvancing || !currentWindow}
              className="h-11 sm:h-auto px-3 sm:px-4 sm:py-1.5 bg-[var(--action)] hover:bg-[var(--action-hover)] disabled:bg-[var(--surface-raised)] disabled:text-[var(--text-disabled)] disabled:cursor-not-allowed text-white text-sm font-medium rounded-l-md transition-colors cursor-pointer"
            >
              {isAdvancing ? '...' : currentWindow ? (location.pathname === '/' ? '开始模拟' : '推进') : '完成'}
            </button>
            {currentWindow && (
              <button
                onClick={() => setShowFastMenu(!showFastMenu)}
                disabled={isAdvancing}
                aria-label="打开快进菜单"
                className="w-11 h-11 sm:w-auto sm:h-auto sm:px-1.5 sm:py-1.5 bg-[var(--action)] hover:bg-[var(--action-hover)] disabled:bg-[var(--surface-raised)] text-white text-sm rounded-r-md transition-colors cursor-pointer border-l border-white/20"
              >
                ▾
              </button>
            )}
            {showFastMenu && currentWindow && (
              <div className="absolute right-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-[60] py-1 min-w-[120px] max-w-[calc(100vw-24px)]">
                <button onClick={() => { batchAdvance(5); setShowFastMenu(false); }} className="w-full min-h-11 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 text-left cursor-pointer">快进 5 步</button>
                <button onClick={() => { batchAdvance(10); setShowFastMenu(false); }} className="w-full min-h-11 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 text-left cursor-pointer">快进 10 步</button>
                <div className="border-t border-slate-700 my-0.5" />
                <button onClick={() => { advanceUntil('cup'); setShowFastMenu(false); }} className="w-full min-h-11 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 text-left cursor-pointer">快进到杯赛</button>
                <button onClick={() => { advanceUntil('season_end'); setShowFastMenu(false); }} className="w-full min-h-11 px-3 py-2 text-xs text-amber-400 hover:bg-slate-700 text-left cursor-pointer">快进到赛季末</button>
                <div className="border-t border-slate-700 my-0.5" />
                <button onClick={() => { setShowFloatingBtn(!showFloatingBtn); setShowFastMenu(false); }} className="w-full min-h-11 px-3 py-2 text-xs text-slate-400 hover:bg-slate-700 text-left cursor-pointer">{showFloatingBtn ? '隐藏悬浮按钮' : '显示悬浮按钮'}</button>
              </div>
            )}
          </div>
        </header>

        {/* News ticker at top */}
        <NewsTicker
          news={world?.newsLog ?? []}
          favoriteTeamNames={favoriteTeamNames}
        />

        {saveNearCapacity && (
          <div role="status" className="px-3 sm:px-5 py-2 bg-amber-950/60 border-b border-amber-700/50 text-amber-100 text-xs flex items-center gap-2">
            <span className="flex-1">存档已接近浏览器容量上限，请及时导出备份或清理已完成比赛的详细回放。</span>
            <NavLink to="/settings" className="shrink-0 text-amber-300 hover:text-white underline">前往设置</NavLink>
            <button type="button" aria-label="关闭存档容量提示" onClick={() => setSaveNearCapacity(false)} className="w-8 h-8 shrink-0 text-amber-300 hover:text-white">×</button>
          </div>
        )}

        {/* Content */}
        <main className={`flex-1 overflow-auto p-3 sm:p-5 animate-fade-in ${showFloatingBtn ? 'pb-20 sm:pb-20' : ''}`} key={location.pathname}>
          {children}
        </main>
      </div>

      {/* Floating advance button */}
      {showFloatingBtn && location.pathname !== '/' && (
        <FloatingAdvanceButton
          stageLabel={currentWindow ? getWindowTypeLabel(currentWindow.type) : undefined}
          accentClass={currentWindow ? getWindowTypeColor(currentWindow.type) : undefined}
          isAdvancing={isAdvancing}
          disabled={isAdvancing || !currentWindow}
          onAdvance={handleFloatingAdvance}
        />
      )}

      {/* Achievement toast */}
      <AchievementToastContainer />
      {saveError && (
        <div role="alert" className="fixed left-3 right-3 bottom-3 sm:left-auto sm:w-96 z-[120] bg-red-950 border border-red-700 text-red-100 px-3 py-3 rounded-lg shadow-xl flex items-start gap-3">
          <span className="text-xs flex-1">存档写入失败，当前进度仍保留在本页内存中。请先释放浏览器存储空间，再继续操作。</span>
          <button aria-label="关闭存档错误提示" onClick={() => setSaveError(false)} className="w-8 h-8 shrink-0 text-red-300 hover:text-white">×</button>
        </div>
      )}
    </div>
  );
}

function AchievementToastContainer() {
  const newAchievements = useGameStore(s => s.newAchievements);
  const dismissAchievement = useGameStore(s => s.dismissAchievement);
  if (newAchievements.length === 0) return null;
  return <AchievementToast achievement={newAchievements[0]} onDismiss={dismissAchievement} />;
}

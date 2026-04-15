import { type ReactNode, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { getWindowTypeLabel, getWindowTypeColor } from '../utils/format';
import Logo from '../components/Logo';

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
      { to: '/coaches', label: '教练中心' },
    ],
  },
];

export default function Layout({ children }: LayoutProps) {
  const world = useGameStore((s) => s.world);
  const isAdvancing = useGameStore((s) => s.isAdvancing);
  const advanceWindow = useGameStore((s) => s.advanceWindow);
  const getCurrentWindow = useGameStore((s) => s.getCurrentWindow);
  const resetGame = useGameStore((s) => s.resetGame);
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const currentWindow = getCurrentWindow();
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
            <span className="text-[10px] bg-sky-900/50 text-sky-400 px-1.5 py-0.5 rounded">WC</span>
          )}
        </div>
        <div className="mt-1.5 w-full h-1 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500/80 rounded-full transition-all"
            style={{ width: `${calendarLen > 0 ? (completedWindows / calendarLen) * 100 : 0}%` }}
          />
        </div>
        <span className="text-[10px] text-slate-600 mt-0.5 block">{completedWindows}/{calendarLen}</span>
      </div>

      <nav className="flex-1 py-2 overflow-y-auto">
        {navSections.map((section) => (
          <div key={section.title} className="mb-1">
            <div className="px-4 py-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
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

        <div className="mb-1">
          <div className="px-4 py-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">记录</div>
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
        </div>
      </nav>

      <div className="p-3 border-t border-slate-700/60 space-y-2">
        <button
          onClick={resetGame}
          className="w-full px-3 py-2 text-xs text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors cursor-pointer"
        >
          重置游戏
        </button>
        <p className="text-[9px] text-slate-600 text-center">by KurtDubain</p>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-900 flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-52 bg-slate-800/80 backdrop-blur border-r border-slate-700/60 flex-col shrink-0">
        <div className="p-3 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <Logo size={30} />
            <div>
              <h1 className="text-sm font-bold text-slate-100 leading-none">足球联赛宇宙</h1>
              <p className="text-[10px] text-slate-500 mt-0.5">电子斗蛐蛐模拟器</p>
            </div>
          </div>
        </div>
        {navContent}
      </aside>

      {/* Mobile nav overlay */}
      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="w-64 bg-slate-800 flex flex-col shadow-2xl">
            <div className="p-3 border-b border-slate-700/60 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Logo size={28} />
                <span className="text-sm font-bold text-slate-100">足球联赛宇宙</span>
              </div>
              <button onClick={() => setMobileNavOpen(false)} className="p-2 text-slate-400 hover:text-slate-200 cursor-pointer">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"/></svg>
              </button>
            </div>
            {navContent}
          </div>
          <div className="flex-1 bg-black/50" onClick={() => setMobileNavOpen(false)} />
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-12 bg-slate-800/60 backdrop-blur border-b border-slate-700/50 flex items-center justify-between px-3 sm:px-5 shrink-0">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileNavOpen(true)}
              className="md:hidden p-1.5 text-slate-400 hover:text-slate-200 cursor-pointer shrink-0"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd"/></svg>
            </button>
            {currentWindow && (
              <>
                <span className={`hidden sm:inline-block px-2 py-0.5 rounded text-[10px] font-medium text-white shrink-0 ${getWindowTypeColor(currentWindow.type)}`}>
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

          <button
            onClick={advanceWindow}
            disabled={isAdvancing || !currentWindow}
            className="px-3 sm:px-5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-all cursor-pointer shadow-sm shrink-0"
          >
            {isAdvancing ? '...' : currentWindow ? '推进' : '完成'}
          </button>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-3 sm:p-5" key={location.pathname}>
          {children}
        </main>
      </div>
    </div>
  );
}

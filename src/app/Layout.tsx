import { type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { getWindowTypeLabel, getWindowTypeColor } from '../utils/format';

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
];

export default function Layout({ children }: LayoutProps) {
  const world = useGameStore((s) => s.world);
  const isAdvancing = useGameStore((s) => s.isAdvancing);
  const advanceWindow = useGameStore((s) => s.advanceWindow);
  const getCurrentWindow = useGameStore((s) => s.getCurrentWindow);
  const resetGame = useGameStore((s) => s.resetGame);
  const location = useLocation();

  const currentWindow = getCurrentWindow();
  const isWorldCupYear = world?.seasonState.isWorldCupYear ?? false;
  const seasonNumber = world?.seasonState.seasonNumber ?? 1;
  const calendarLen = world?.seasonState.calendar.length ?? 0;
  const completedWindows = world?.seasonState.calendar.filter(w => w.completed).length ?? 0;

  return (
    <div className="min-h-screen bg-slate-900 flex">
      {/* ══ Sidebar ══ */}
      <aside className="w-56 bg-slate-800/80 backdrop-blur border-r border-slate-700/60 flex flex-col shrink-0">
        {/* Logo */}
        <div className="p-4 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <span className="text-xl">&#9917;</span>
            <div>
              <h1 className="text-sm font-bold text-slate-100 leading-none">足球联赛宇宙</h1>
              <p className="text-[10px] text-slate-500 mt-0.5">电子斗蛐蛐模拟器</p>
            </div>
          </div>
        </div>

        {/* Season info in sidebar */}
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

        {/* Nav sections */}
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
                  className={({ isActive }) =>
                    `block mx-2 px-3 py-1.5 rounded-lg text-sm transition-all ${
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

          {/* World Cup link */}
          {isWorldCupYear && (
            <div className="mb-1">
              <NavLink
                to="/cup/world_cup"
                className={({ isActive }) =>
                  `block mx-2 px-3 py-1.5 rounded-lg text-sm transition-all ${
                    isActive
                      ? 'bg-sky-600/90 text-white font-medium shadow-sm'
                      : 'text-sky-400 hover:bg-sky-900/30 hover:text-sky-300'
                  }`
                }
              >
                &#127942; 环球冠军杯
              </NavLink>
            </div>
          )}

          {/* History */}
          <div className="mb-1">
            <div className="px-4 py-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
              记录
            </div>
            <NavLink
              to="/history"
              className={({ isActive }) =>
                `block mx-2 px-3 py-1.5 rounded-lg text-sm transition-all ${
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

        {/* Footer */}
        <div className="p-3 border-t border-slate-700/60 space-y-1">
          <button
            onClick={resetGame}
            className="w-full px-3 py-1.5 text-xs text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors cursor-pointer"
          >
            重置游戏
          </button>
        </div>
      </aside>

      {/* ══ Main area ══ */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* ── Top bar ── */}
        <header className="h-12 bg-slate-800/60 backdrop-blur border-b border-slate-700/50 flex items-center justify-between px-5 shrink-0">
          <div className="flex items-center gap-3">
            {currentWindow && (
              <>
                <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium text-white ${getWindowTypeColor(currentWindow.type)}`}>
                  {getWindowTypeLabel(currentWindow.type)}
                </span>
                <span className="text-sm text-slate-300 font-medium">
                  {currentWindow.label}
                </span>
                <span className="text-xs text-slate-600">
                  {currentWindow.fixtures.length}场
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
            className="px-5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-all cursor-pointer shadow-sm"
          >
            {isAdvancing ? '模拟中...' : currentWindow ? '推进' : '已完成'}
          </button>
        </header>

        {/* ── Content ── */}
        <main className="flex-1 overflow-auto p-5" key={location.pathname}>
          {children}
        </main>
      </div>
    </div>
  );
}

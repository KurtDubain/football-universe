import { useState, useEffect, useMemo } from 'react';
import type { NewsItem } from '../engine/season/season-manager';

const priorityMap: Record<string, number> = {
  trophy: 10, upset: 8, coach_fired: 7, coach_hired: 6,
  promotion: 5, relegation: 5, streak: 4, match_result: 2,
};

const typeIcon: Record<string, string> = {
  trophy: '🏆', upset: '🔥', coach_fired: '📋', coach_hired: '✅',
  promotion: '⬆️', relegation: '⬇️', streak: '📊', match_result: '⚽',
};

const typeBg: Record<string, string> = {
  trophy: 'border-l-amber-500',
  upset: 'border-l-purple-500',
  coach_fired: 'border-l-red-500',
  coach_hired: 'border-l-blue-500',
  promotion: 'border-l-green-500',
  relegation: 'border-l-red-400',
  streak: 'border-l-sky-500',
  match_result: 'border-l-emerald-500',
};

export default function NewsTicker({ news }: { news: NewsItem[] }) {
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(() =>
    [...news]
      .sort((a, b) => (priorityMap[b.type] ?? 0) - (priorityMap[a.type] ?? 0))
      .slice(0, 8),
    [news]
  );

  useEffect(() => {
    if (sorted.length <= 1 || expanded) return;
    const timer = setInterval(() => {
      setIndex(prev => (prev + 1) % sorted.length);
    }, 4500);
    return () => clearInterval(timer);
  }, [sorted.length, expanded]);

  useEffect(() => { setIndex(0); }, [news.length]);

  if (sorted.length === 0) return null;
  const item = sorted[index % sorted.length];
  if (!item) return null;

  return (
    <div className="relative shrink-0">
      {/* Main ticker bar */}
      <div
        className="h-8 bg-slate-800/90 backdrop-blur border-b border-slate-700/40 flex items-center px-3 sm:px-5 gap-2 cursor-pointer hover:bg-slate-800 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-xs shrink-0">{typeIcon[item.type] ?? '📰'}</span>
        <p className="text-[11px] text-slate-300 truncate flex-1 animate-slide-down" key={item.id}>
          {item.title}
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          {sorted.length > 1 && (
            <span className="text-[9px] text-slate-600">{index + 1}/{sorted.length}</span>
          )}
          <span className="text-[10px] text-slate-600">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Expanded news panel */}
      {expanded && (
        <div className="absolute left-0 right-0 top-full bg-slate-800 border-b border-slate-700 shadow-xl z-[55] max-h-60 overflow-y-auto animate-slide-down">
          {sorted.map((n, i) => (
            <div
              key={n.id}
              className={`flex items-start gap-2 px-4 py-2 border-l-2 hover:bg-slate-700/30 transition-colors cursor-pointer ${typeBg[n.type] ?? 'border-l-slate-600'} ${i === index ? 'bg-slate-700/20' : ''}`}
              onClick={() => { setIndex(i); setExpanded(false); }}
            >
              <span className="text-xs mt-0.5 shrink-0">{typeIcon[n.type] ?? '📰'}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-200 font-medium leading-tight">{n.title}</p>
                {n.description && (
                  <p className="text-[10px] text-slate-500 mt-0.5 leading-tight truncate">{n.description}</p>
                )}
              </div>
              <span className="text-[9px] text-slate-600 shrink-0 mt-0.5">S{n.seasonNumber}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

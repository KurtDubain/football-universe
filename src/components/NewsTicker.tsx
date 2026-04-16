import { useState, useEffect } from 'react';
import type { NewsItem } from '../engine/season/season-manager';

const priorityMap: Record<string, number> = {
  trophy: 10, upset: 8, coach_fired: 7, coach_hired: 6,
  promotion: 5, relegation: 5, streak: 4, match_result: 2,
};

export default function NewsTicker({ news }: { news: NewsItem[] }) {
  const [index, setIndex] = useState(0);

  // Sort by priority, take top 5
  const sorted = [...news]
    .sort((a, b) => (priorityMap[b.type] ?? 0) - (priorityMap[a.type] ?? 0))
    .slice(0, 5);

  useEffect(() => {
    if (sorted.length <= 1) return;
    const timer = setInterval(() => {
      setIndex(prev => (prev + 1) % sorted.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [sorted.length]);

  useEffect(() => { setIndex(0); }, [news.length]);

  if (sorted.length === 0) return null;
  const item = sorted[index % sorted.length];
  if (!item) return null;

  const typeColors: Record<string, string> = {
    trophy: 'bg-amber-500', upset: 'bg-purple-500', coach_fired: 'bg-red-500',
    coach_hired: 'bg-blue-500', promotion: 'bg-green-500', relegation: 'bg-red-500',
    streak: 'bg-sky-500', match_result: 'bg-emerald-500',
  };

  return (
    <div className="h-7 bg-slate-800/90 backdrop-blur border-t border-slate-700/50 flex items-center px-3 sm:px-5 gap-2 overflow-hidden shrink-0">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${typeColors[item.type] ?? 'bg-slate-500'}`} />
      <p className="text-[11px] text-slate-400 truncate animate-slide-up" key={item.id}>
        <span className="text-slate-200 font-medium">{item.title}</span>
        {item.description && <span className="hidden sm:inline ml-2 text-slate-500">{item.description}</span>}
      </p>
      {sorted.length > 1 && (
        <span className="text-[9px] text-slate-600 shrink-0 ml-auto">{index + 1}/{sorted.length}</span>
      )}
    </div>
  );
}

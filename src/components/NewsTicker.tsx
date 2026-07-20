import { useState, useEffect, useMemo } from 'react';
import type { NewsItem } from '../engine/season/season-manager';
import { Icon, IconName } from './Icon';
import { curateNewsFeed } from '../engine/season/news-feed';

const typeIcon: Record<string, IconName> = {
  trophy: 'trophy', upset: 'fire', coach_fired: 'clipboard', coach_hired: 'check',
  promotion: 'arrow-up', relegation: 'arrow-down', streak: 'chart', match_result: 'ball',
  retirement: 'medal', injury: 'bandage', fire_sale: 'money', prize_money: 'coin',
  rumor: 'megaphone',
};

const typeAccent: Record<string, string> = {
  trophy: '#fbbf24', upset: '#f97316', coach_fired: '#ef4444', coach_hired: '#3b82f6',
  promotion: '#10b981', relegation: '#f87171', streak: '#0ea5e9', match_result: '#10b981',
  retirement: '#fcd34d', injury: '#fca5a5', fire_sale: '#fb923c', prize_money: '#eab308',
  rumor: '#c084fc',
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
  retirement: 'border-l-amber-300',
  injury: 'border-l-red-300',
  fire_sale: 'border-l-orange-500',
  prize_money: 'border-l-yellow-500',
  rumor: 'border-l-purple-400',
};

const EMPTY_TEAM_NAMES: string[] = [];

export default function NewsTicker({ news, favoriteTeamNames = EMPTY_TEAM_NAMES }: { news: NewsItem[]; favoriteTeamNames?: string[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(
    () => curateNewsFeed(news, { favoriteTeamNames, limit: 8 }),
    [favoriteTeamNames, news],
  );

  useEffect(() => {
    if (sorted.length <= 1 || expanded) return;
    const timer = setInterval(() => {
      setSelectedId(previousId => {
        const previousIndex = sorted.findIndex(item => item.id === previousId);
        return sorted[(Math.max(0, previousIndex) + 1) % sorted.length].id;
      });
    }, 4500);
    return () => clearInterval(timer);
  }, [sorted, expanded]);

  if (sorted.length === 0) return null;
  const selectedIndex = sorted.findIndex(item => item.id === selectedId);
  const index = selectedIndex >= 0 ? selectedIndex : 0;
  const item = sorted[index];
  if (!item) return null;

  return (
    <div className="relative shrink-0">
      {/* Main ticker bar */}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="global-news-list"
        className="w-full h-8 bg-slate-800/90 backdrop-blur border-b border-slate-700/40 flex items-center px-3 sm:px-5 gap-2 cursor-pointer hover:bg-slate-800 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
        onClick={() => setExpanded(previous => !previous)}
      >
        <span className="text-xs shrink-0 text-slate-300">
          <Icon name={typeIcon[item.type] ?? 'news'} size={13} accent={typeAccent[item.type]} />
        </span>
        <p className="text-[11px] text-slate-300 truncate flex-1 animate-slide-down" key={item.id}>
          {item.title}
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          {sorted.length > 1 && (
            <span className="text-[9px] text-slate-600">{index + 1}/{sorted.length}</span>
          )}
          <span className="text-[10px] text-slate-600">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Expanded news panel */}
      {expanded && (
        <div id="global-news-list" className="absolute left-0 right-0 top-full bg-slate-800 border-b border-slate-700 shadow-xl z-[55] max-h-60 overflow-y-auto animate-slide-down">
          {sorted.map((n, i) => (
            <button
              type="button"
              key={n.id}
              className={`w-full text-left flex items-start gap-2 px-4 py-2 border-l-2 hover:bg-slate-700/30 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 ${typeBg[n.type] ?? 'border-l-slate-600'} ${i === index ? 'bg-slate-700/20' : ''}`}
              onClick={() => { setSelectedId(n.id); setExpanded(false); }}
            >
              <span className="text-xs mt-0.5 shrink-0 text-slate-300">
                <Icon name={typeIcon[n.type] ?? 'news'} size={13} accent={typeAccent[n.type]} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-200 font-medium leading-tight">{n.title}</p>
                {n.description && (
                  <p className="text-[10px] text-slate-500 mt-0.5 leading-tight truncate">{n.description}</p>
                )}
              </div>
              <span className="text-[9px] text-slate-600 shrink-0 mt-0.5">S{n.seasonNumber}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

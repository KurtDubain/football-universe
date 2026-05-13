import { useState } from 'react';
import { useGameStore } from '../store/game-store';
import MatchLive from '../components/MatchLive';
import type { MatchResult } from '../types/match';
import type { MemorableType } from '../types/memorable';

const TYPE_META: Record<MemorableType, { emoji: string; label: string; color: string }> = {
  blowout: { emoji: '💥', label: '大屠杀', color: 'text-red-400 bg-red-900/30 border-red-700/40' },
  shootout: { emoji: '🎯', label: '点球大战', color: 'text-amber-400 bg-amber-900/30 border-amber-700/40' },
  last_minute: { emoji: '⚡', label: '绝杀', color: 'text-yellow-400 bg-yellow-900/30 border-yellow-700/40' },
  upset: { emoji: '🎲', label: '世纪冷门', color: 'text-purple-400 bg-purple-900/30 border-purple-700/40' },
  coronation: { emoji: '👑', label: '加冕之战', color: 'text-emerald-400 bg-emerald-900/30 border-emerald-700/40' },
  goalfest: { emoji: '⚽', label: '进球大战', color: 'text-blue-400 bg-blue-900/30 border-blue-700/40' },
};

export default function MemorableMatches() {
  const world = useGameStore((s) => s.world);
  const [filter, setFilter] = useState<MemorableType | 'all'>('all');
  const [replay, setReplay] = useState<MatchResult | null>(null);

  if (!world) return <div className="text-slate-400">正在加载...</div>;

  const memorable = world.memorableMatches ?? [];
  const filtered = filter === 'all' ? memorable : memorable.filter((m) => m.type === filter);

  // Group by season, newest first
  const grouped = new Map<number, typeof filtered>();
  for (const m of filtered) {
    if (!grouped.has(m.season)) grouped.set(m.season, []);
    grouped.get(m.season)!.push(m);
  }
  const bySeasons = [...grouped.entries()].sort((a, b) => b[0] - a[0]);

  const filterOptions: { key: MemorableType | 'all'; label: string; emoji?: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'blowout', label: '大屠杀', emoji: '💥' },
    { key: 'last_minute', label: '绝杀', emoji: '⚡' },
    { key: 'upset', label: '冷门', emoji: '🎲' },
    { key: 'shootout', label: '点球', emoji: '🎯' },
    { key: 'goalfest', label: '进球大战', emoji: '⚽' },
  ];

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl sm:text-2xl font-bold text-slate-100">经典战役</h2>
        <span className="text-xs text-slate-500">共 {memorable.length} 场 · 最近 {Math.min(30, memorable.length)} 场</span>
      </div>

      {/* Filter pills */}
      <div className="flex gap-1 bg-slate-800 rounded-lg p-1 border border-slate-700/60 overflow-x-auto">
        {filterOptions.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setFilter(opt.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
              filter === opt.key ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {opt.emoji && <span className="mr-1">{opt.emoji}</span>}
            {opt.label}
          </button>
        ))}
      </div>

      {bySeasons.length === 0 ? (
        <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-8 text-center">
          <div className="text-4xl mb-2">🎬</div>
          <div className="text-sm text-slate-400">尚无收藏的经典战役</div>
          <div className="text-xs text-slate-500 mt-1">
            大比分、绝杀、冷门、点球大战会被自动加入
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {bySeasons.map(([season, list]) => (
            <div key={season} className="bg-slate-800 rounded-xl border border-slate-700/60 overflow-hidden">
              <div className="px-4 py-2 bg-slate-700/30 border-b border-slate-700/60 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-200">第 {season} 赛季</h3>
                <span className="text-xs text-slate-500">{list.length} 场</span>
              </div>
              <div className="divide-y divide-slate-700/40">
                {list.map((m, i) => {
                  const meta = TYPE_META[m.type];
                  const ht = world.teamBases[m.result.homeTeamId];
                  const at = world.teamBases[m.result.awayTeamId];
                  const totalH = m.result.homeGoals + (m.result.etHomeGoals ?? 0);
                  const totalA = m.result.awayGoals + (m.result.etAwayGoals ?? 0);
                  return (
                    <div key={i} className="px-3 py-2 hover:bg-slate-700/20 transition-colors">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium border shrink-0 ${meta.color}`}>
                          {meta.emoji} {m.label}
                        </span>
                        <div className="flex items-center gap-1.5 flex-1 min-w-0 text-xs">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ht?.color ?? '#666' }} />
                          <span className="font-medium text-slate-200 truncate">{ht?.shortName ?? m.result.homeTeamId}</span>
                          <span className="font-bold text-slate-100">{totalH}-{totalA}</span>
                          <span className="font-medium text-slate-200 truncate">{at?.shortName ?? m.result.awayTeamId}</span>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: at?.color ?? '#666' }} />
                          {m.result.penalties && (
                            <span className="text-[10px] text-amber-400">
                              (点球 {m.result.penaltyHome ?? 0}-{m.result.penaltyAway ?? 0})
                            </span>
                          )}
                          <span className="text-[10px] text-slate-600 truncate">{m.result.competitionName} · {m.result.roundLabel}</span>
                        </div>
                        <button
                          onClick={() => setReplay(m.result)}
                          className="text-[10px] text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded bg-emerald-900/20 hover:bg-emerald-900/40 cursor-pointer shrink-0 transition-colors"
                        >
                          ▶ 回放
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {replay && (
        <MatchLive
          result={replay}
          teamBases={world.teamBases}
          onClose={() => setReplay(null)}
        />
      )}
    </div>
  );
}

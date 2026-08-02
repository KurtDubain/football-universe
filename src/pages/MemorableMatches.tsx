import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import MatchLive from '../components/MatchLive';
import type { MatchResult } from '../types/match';
import type { MemorableType } from '../types/memorable';
import { SegmentedControl } from '../components/ui';

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
  const [searchParams] = useSearchParams();
  const requestedFixture = searchParams.get('fixture');
  const [filter, setFilter] = useState<MemorableType | 'all'>('all');
  const [replay, setReplay] = useState<MatchResult | null>(() => {
    if (!requestedFixture || !world) return null;
    return world.memorableMatches?.find(entry => entry.result.fixtureId === requestedFixture)?.result ?? null;
  });

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
      <SegmentedControl
        value={filter}
        onChange={setFilter}
        ariaLabel="经典战役筛选"
        scrollable
        className="w-full"
        options={filterOptions.map((option) => ({
          value: option.key,
          label: (
            <>
              {option.emoji && <span className="mr-1" aria-hidden="true">{option.emoji}</span>}
              {option.label}
            </>
          ),
        }))}
      />

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
                    <div key={m.result.fixtureId || i} className="px-3 py-2.5 hover:bg-slate-700/20 transition-colors">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                        <div className="min-w-0">
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border ${meta.color}`}>
                            {meta.emoji} {m.label}
                          </span>
                          <div className="mt-1.5 grid grid-cols-[minmax(3rem,1fr)_auto_minmax(3rem,1fr)] items-center gap-2 text-xs">
                            <span className="flex min-w-0 items-center gap-1.5" title={ht?.name ?? m.result.homeTeamId}>
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: ht?.color ?? '#666' }} />
                              <span className="truncate font-medium text-slate-200">{ht?.shortName ?? m.result.homeTeamId}</span>
                            </span>
                            <span className="text-center text-sm font-bold text-slate-100 tabular-nums">{totalH}-{totalA}</span>
                            <span className="flex min-w-0 items-center justify-end gap-1.5 text-right" title={at?.name ?? m.result.awayTeamId}>
                              <span className="truncate font-medium text-slate-200">{at?.shortName ?? m.result.awayTeamId}</span>
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: at?.color ?? '#666' }} />
                            </span>
                          </div>
                          <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px]">
                            {m.result.penalties && (
                              <span className="shrink-0 text-amber-400">
                                点球 {m.result.penaltyHome ?? 0}-{m.result.penaltyAway ?? 0}
                              </span>
                            )}
                            <span className="truncate text-slate-600" title={`${m.result.competitionName} · ${m.result.roundLabel}`}>
                              {m.result.competitionName} · {m.result.roundLabel}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => setReplay(m.result)}
                          aria-label={`回放 ${ht?.name ?? m.result.homeTeamId} 对 ${at?.name ?? m.result.awayTeamId}`}
                          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded bg-emerald-900/20 px-2 py-1 text-[10px] text-emerald-400 transition-colors hover:bg-emerald-900/40 hover:text-emerald-300 cursor-pointer"
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

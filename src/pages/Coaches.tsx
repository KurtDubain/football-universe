import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { getTeamName, getCoachStyleLabel, getTrophyLabel } from '../utils/format';
import type { CoachBase } from '../types/coach';

type SortKey = 'rating' | 'name' | 'trophies' | 'pressure';
type FilterTab = 'all' | 'employed' | 'unemployed';

export default function Coaches() {
  const world = useGameStore((s) => s.world);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [sortBy, setSortBy] = useState<SortKey>('rating');

  if (!world) return <div className="text-slate-400">正在加载...</div>;

  // Build coach list with enriched data
  const coaches = Object.values(world.coachBases).map((base) => {
    const state = world.coachStates[base.id];
    const trophies = world.coachTrophies[base.id] ?? [];
    const career = world.coachCareers[base.id] ?? [];
    const team = state?.currentTeamId ? world.teamBases[state.currentTeamId] : null;
    const teamState = state?.currentTeamId ? world.teamStates[state.currentTeamId] : null;
    return { base, state, trophies, career, team, teamState };
  });

  // Filter
  const filtered = coaches.filter((c) => {
    if (filter === 'employed') return !c.state?.isUnemployed;
    if (filter === 'unemployed') return c.state?.isUnemployed;
    return true;
  });

  // Sort
  filtered.sort((a, b) => {
    switch (sortBy) {
      case 'rating': return b.base.rating - a.base.rating;
      case 'name': return a.base.name.localeCompare(b.base.name);
      case 'trophies': return b.trophies.length - a.trophies.length;
      case 'pressure': return (b.teamState?.coachPressure ?? -1) - (a.teamState?.coachPressure ?? -1);
      default: return 0;
    }
  });

  const employed = coaches.filter(c => !c.state?.isUnemployed);
  const unemployed = coaches.filter(c => c.state?.isUnemployed);

  // Style label colors
  const styleColor: Record<string, string> = {
    attacking: 'text-red-400 bg-red-900/30',
    defensive: 'text-blue-400 bg-blue-900/30',
    balanced: 'text-slate-300 bg-slate-700/50',
    possession: 'text-emerald-400 bg-emerald-900/30',
    counter: 'text-amber-400 bg-amber-900/30',
  };

  return (
    <div className="max-w-5xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100">教练中心</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {employed.length} 名在职 · {unemployed.length} 名空闲
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="text-xs bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-2 py-1.5 cursor-pointer"
          >
            <option value="rating">按评分</option>
            <option value="trophies">按奖杯</option>
            <option value="pressure">按压力</option>
            <option value="name">按姓名</option>
          </select>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-slate-800/60 rounded-lg p-0.5 border border-slate-700/50 w-fit">
        {([
          { key: 'all', label: `全部 (${coaches.length})` },
          { key: 'employed', label: `在职 (${employed.length})` },
          { key: 'unemployed', label: `空闲 (${unemployed.length})` },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1 text-xs rounded-md transition-colors cursor-pointer ${
              filter === key ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Coach list */}
      <div className="space-y-2">
        {filtered.map(({ base, state, trophies, career, team, teamState }) => {
          const pressure = teamState?.coachPressure ?? 0;
          const pressureColor = pressure > 60 ? 'text-red-400' : pressure > 35 ? 'text-amber-400' : 'text-green-400';
          const ratingTier = base.rating >= 85 ? 'bg-amber-500' : base.rating >= 70 ? 'bg-blue-500' : base.rating >= 55 ? 'bg-slate-500' : 'bg-slate-600';

          return (
            <Link
              key={base.id}
              to={`/coach/${base.id}`}
              className="block bg-slate-800 rounded-xl border border-slate-700/60 hover:border-slate-600 transition-all hover-lift"
            >
              <div className="p-3 sm:p-4 flex items-center gap-3 sm:gap-4">
                {/* Rating badge */}
                <div className={`w-10 h-10 sm:w-11 sm:h-11 ${ratingTier} rounded-xl flex items-center justify-center shrink-0`}>
                  <span className="text-white font-bold text-xs sm:text-sm">{base.rating}</span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-100">{base.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${styleColor[base.style] ?? 'bg-slate-700 text-slate-400'}`}>
                      {getCoachStyleLabel(base.style)}
                    </span>
                    {state?.isUnemployed && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-400">空闲</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                    {team ? (
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: team.color }} />
                        {team.name}
                      </span>
                    ) : (
                      <span>待业中{state?.unemployedSince != null ? ` (自S${state.unemployedSince})` : ''}</span>
                    )}
                    {trophies.length > 0 && (
                      <span className="text-amber-500">{trophies.length} 座奖杯</span>
                    )}
                    {career.length > 1 && (
                      <span>执教 {career.length} 队</span>
                    )}
                  </div>
                </div>

                {/* Buffs mini-display */}
                <div className="hidden md:flex items-center gap-3 shrink-0 text-xs">
                  <div className="text-center">
                    <div className="text-slate-500">攻</div>
                    <div className={base.attackBuff > 0 ? 'text-green-400' : base.attackBuff < 0 ? 'text-red-400' : 'text-slate-400'}>
                      {base.attackBuff > 0 ? '+' : ''}{base.attackBuff}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-slate-500">防</div>
                    <div className={base.defenseBuff > 0 ? 'text-green-400' : base.defenseBuff < 0 ? 'text-red-400' : 'text-slate-400'}>
                      {base.defenseBuff > 0 ? '+' : ''}{base.defenseBuff}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-slate-500">联赛</div>
                    <div className="text-slate-300">+{base.leagueBuff}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-slate-500">杯赛</div>
                    <div className="text-slate-300">+{base.cupBuff}</div>
                  </div>
                </div>

                {/* Pressure / status */}
                <div className="shrink-0 text-right w-16">
                  {team && teamState ? (
                    <div>
                      <div className={`text-sm font-bold ${pressureColor}`}>{pressure}</div>
                      <div className="text-[10px] text-slate-500">压力</div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-600">--</div>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-8 text-slate-500">无匹配教练</div>
      )}
    </div>
  );
}

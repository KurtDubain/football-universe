import type { Trophy } from '../types/team';

const TROPHY_META: Record<Trophy['type'], { label: string; color: string }> = {
  league1:      { label: '顶', color: 'bg-amber-900/50 text-amber-300 border-amber-700/40' },
  league2:      { label: '甲', color: 'bg-blue-900/50 text-blue-300 border-blue-700/40' },
  league3:      { label: '乙', color: 'bg-slate-700/60 text-slate-300 border-slate-600/40' },
  league_cup:   { label: '联杯', color: 'bg-emerald-900/50 text-emerald-300 border-emerald-700/40' },
  super_cup:    { label: '超杯', color: 'bg-purple-900/50 text-purple-300 border-purple-700/40' },
  world_cup:    { label: '环球', color: 'bg-rose-900/50 text-rose-300 border-rose-700/40' },
  mainland_cup: { label: '大陆杯', color: 'bg-orange-900/50 text-orange-300 border-orange-700/40' },
  southern_cup: { label: '南洲杯', color: 'bg-cyan-900/50 text-cyan-300 border-cyan-700/40' },
  eastern_cup:  { label: '东洲杯', color: 'bg-pink-900/50 text-pink-300 border-pink-700/40' },
};

const TROPHY_ORDER: Trophy['type'][] = [
  'league1', 'league2', 'league3', 'league_cup', 'super_cup', 'world_cup',
  'mainland_cup', 'southern_cup', 'eastern_cup',
];

/**
 * Compact horizontal trophy breakdown: total count badge + per-category chips
 * for non-zero counts. Renders nothing if the team/coach has no trophies.
 */
export default function TrophyBreakdown({
  trophies,
  size = 'sm',
}: {
  trophies: Trophy[];
  size?: 'xs' | 'sm';
}) {
  if (!trophies || trophies.length === 0) return null;

  const counts: Partial<Record<Trophy['type'], number>> = {};
  for (const t of trophies) {
    counts[t.type] = (counts[t.type] ?? 0) + 1;
  }

  const padX = size === 'xs' ? 'px-1' : 'px-1.5';
  const padY = size === 'xs' ? 'py-0' : 'py-0.5';
  const txt = size === 'xs' ? 'text-[9px]' : 'text-[10px]';

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* Total */}
      <span className={`${padX} ${padY} rounded ${txt} font-semibold bg-amber-500/15 text-amber-400 border border-amber-600/30`}>
        🏆 {trophies.length}
      </span>
      {/* Per-category chips, only non-zero */}
      {TROPHY_ORDER.map((type) => {
        const n = counts[type];
        if (!n) return null;
        const meta = TROPHY_META[type];
        return (
          <span
            key={type}
            className={`${padX} ${padY} rounded ${txt} font-medium border ${meta.color}`}
            title={`${meta.label} ${n}座`}
          >
            {meta.label} {n}
          </span>
        );
      })}
    </div>
  );
}

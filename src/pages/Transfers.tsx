import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import type { TransferRecord } from '../types/transfer';

const posLabel: Record<string, string> = { GK: '门将', DF: '后卫', MF: '中场', FW: '前锋' };
const posColor: Record<string, string> = {
  GK: 'text-amber-400 bg-amber-900/30',
  DF: 'text-blue-400 bg-blue-900/30',
  MF: 'text-green-400 bg-green-900/30',
  FW: 'text-red-400 bg-red-900/30',
};

export default function Transfers() {
  const world = useGameStore((s) => s.world);
  const [filter, setFilter] = useState<'all' | 'major'>('all');

  const transferData = useMemo(() => {
    if (!world) return { bySeasons: [] as { season: number; records: TransferRecord[] }[], total: 0 };
    const all = world.transferHistory ?? [];
    const filtered = filter === 'major' ? all.filter((t) => t.type === 'transfer') : all;
    const grouped = new Map<number, TransferRecord[]>();
    for (const t of filtered) {
      if (!grouped.has(t.season)) grouped.set(t.season, []);
      grouped.get(t.season)!.push(t);
    }
    const bySeasons = [...grouped.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([season, records]) => ({ season, records }));
    return { bySeasons, total: filtered.length };
  }, [world, filter]);

  if (!world) return <div className="text-slate-400">正在加载...</div>;

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl sm:text-2xl font-bold text-slate-100">转会窗口</h2>
        <span className="text-xs text-slate-500">共 {transferData.total} 笔</span>
      </div>

      {/* Filter */}
      <div className="flex gap-1 bg-slate-800 rounded-lg p-1 border border-slate-700/60 w-fit">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
            filter === 'all' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          全部
        </button>
        <button
          onClick={() => setFilter('major')}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
            filter === 'major' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          强援转会
        </button>
      </div>

      {transferData.bySeasons.length === 0 ? (
        <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-8 text-center">
          <div className="text-4xl mb-2">🔄</div>
          <div className="text-sm text-slate-400">尚无转会记录</div>
          <div className="text-xs text-slate-500 mt-1">
            完成一个完整赛季后将自动生成转会窗口
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {transferData.bySeasons.map(({ season, records }) => (
            <div key={season} className="bg-slate-800 rounded-xl border border-slate-700/60 overflow-hidden">
              <div className="px-4 py-2 bg-slate-700/30 border-b border-slate-700/60">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-200">第 {season} 赛季</h3>
                  <span className="text-xs text-slate-500">{records.length} 笔</span>
                </div>
              </div>
              <div className="divide-y divide-slate-700/40">
                {records.map((t, i) => (
                  <TransferRow key={i} record={t} world={world} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TransferRow({ record, world }: { record: TransferRecord; world: NonNullable<ReturnType<typeof useGameStore.getState>['world']> }) {
  const fromColor = world.teamBases[record.fromTeamId]?.color ?? '#666';
  const toColor = world.teamBases[record.toTeamId]?.color ?? '#666';
  const arrow = record.type === 'transfer' ? '→' : record.type === 'loan' ? '⇄' : '○';
  const arrowColor = record.type === 'transfer' ? 'text-emerald-400' : record.type === 'loan' ? 'text-amber-400' : 'text-slate-500';

  return (
    <div className="px-3 py-2 hover:bg-slate-700/20 transition-colors">
      <div className="flex items-center gap-2">
        {/* Position */}
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${posColor[record.position]}`}>
          {posLabel[record.position]}
        </span>

        {/* Player */}
        <Link to={`/player/${record.playerId}`} className="text-sm text-slate-100 font-medium hover:text-blue-300 truncate min-w-[60px]">
          {record.playerName}
        </Link>

        {/* From → To */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0 text-xs">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: fromColor }} />
          <Link to={`/team/${record.fromTeamId}`} className="text-slate-400 hover:text-blue-300 truncate">
            {record.fromTeamName}
          </Link>
          <span className={`${arrowColor} font-bold shrink-0`}>{arrow}</span>
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: toColor }} />
          <Link to={`/team/${record.toTeamId}`} className="text-slate-200 hover:text-blue-300 truncate font-medium">
            {record.toTeamName}
          </Link>
        </div>

        {/* Fee */}
        {record.fee && (
          <span className="text-xs text-emerald-400 font-bold shrink-0">€{record.fee}M</span>
        )}
      </div>
      {record.reason && (
        <div className="text-[10px] text-slate-500 ml-12 mt-0.5 truncate">{record.reason}</div>
      )}
    </div>
  );
}

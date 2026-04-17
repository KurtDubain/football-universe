import { useParams, Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { getTeamName } from '../utils/format';

const posLabel: Record<string, string> = { GK: '门将', DF: '后卫', MF: '中场', FW: '前锋' };
const posColor: Record<string, string> = { GK: 'bg-amber-900/40 text-amber-400', DF: 'bg-blue-900/40 text-blue-400', MF: 'bg-green-900/40 text-green-400', FW: 'bg-red-900/40 text-red-400' };

export default function PlayerDetail() {
  const { id } = useParams<{ id: string }>();
  const world = useGameStore((s) => s.world);

  if (!world || !id) return <div className="text-slate-400">正在加载...</div>;

  // Find player: id format is "teamId-number"
  const parts = id.split('-');
  const number = parseInt(parts[parts.length - 1]);
  const teamId = parts.slice(0, -1).join('-');

  const squad = world.squads[teamId];
  const player = squad?.find(p => p.id === id);
  const team = world.teamBases[teamId];
  const stats = world.playerStats[id];

  if (!player || !team) return <div className="text-slate-400">未找到球员: {id}</div>;

  return (
    <div className="max-w-2xl space-y-5">
      {/* Header */}
      <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-5">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl font-black text-white shrink-0" style={{ backgroundColor: team.color }}>
            {player.number}
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-100">{player.number}号球员</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Link to={`/team/${teamId}`} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: team.color }} />
                {team.name}
              </Link>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${posColor[player.position] ?? ''}`}>
                {posLabel[player.position] ?? player.position}
              </span>
              <span className="text-xs text-slate-500">能力 {player.rating}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBox label="出场" value={stats?.appearances ?? 0} />
        <StatBox label="进球" value={stats?.goals ?? 0} color="text-amber-400" />
        <StatBox label="助攻" value={stats?.assists ?? 0} color="text-blue-400" />
        <StatBox label="黄牌" value={stats?.yellowCards ?? 0} color="text-yellow-400" />
      </div>

      {/* Attributes */}
      <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">球员属性</h3>
        <div className="space-y-2">
          <AttrBar label="综合能力" value={player.rating} max={99} />
          <AttrBar label="进球倾向" value={player.goalScoring} max={100} color="bg-amber-500" />
        </div>
      </div>

      {/* Red cards if any */}
      {(stats?.redCards ?? 0) > 0 && (
        <div className="bg-red-900/15 rounded-xl border border-red-800/30 p-3 text-center">
          <span className="text-sm text-red-400 font-semibold">红牌: {stats!.redCards}</span>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-3 text-center">
      <div className={`text-2xl font-bold ${color ?? 'text-slate-100'}`}>{value}</div>
      <div className="text-[10px] text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

function AttrBar({ label, value, max, color }: { label: string; value: number; max: number; color?: string }) {
  const pct = (value / max) * 100;
  return (
    <div>
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-200 font-semibold">{value}</span>
      </div>
      <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color ?? 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

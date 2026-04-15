import { useParams, Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import {
  getTeamName,
  getCoachStyleLabel,
  getTrophyLabel,
} from '../utils/format';

export default function CoachDetail() {
  const { id } = useParams<{ id: string }>();
  const world = useGameStore((s) => s.world);

  if (!world || !id) {
    return <div className="text-slate-400">正在加载...</div>;
  }

  const base = world.coachBases[id];
  const state = world.coachStates[id];
  const career = world.coachCareers[id] ?? [];
  const trophies = world.coachTrophies[id] ?? [];

  if (!base || !state) {
    return <div className="text-slate-400">未找到教练: {id}</div>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-100">{base.name}</h2>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-sm text-slate-400">
            评分: <span className="text-slate-200 font-semibold">{base.rating}</span>
          </span>
          <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded">
            {getCoachStyleLabel(base.style)}
          </span>
          {state.isUnemployed ? (
            <span className="text-xs bg-red-900/50 text-red-400 px-2 py-0.5 rounded">
              待业
            </span>
          ) : state.currentTeamId ? (
            <Link
              to={`/team/${state.currentTeamId}`}
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              {getTeamName(state.currentTeamId, world.teamBases)}
            </Link>
          ) : null}
        </div>
      </div>

      {/* Buff values */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
        <h3 className="text-sm font-semibold text-slate-200 mb-3">
          教练加成
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <BuffCard label="进攻加成" value={base.attackBuff} />
          <BuffCard label="防守加成" value={base.defenseBuff} />
          <BuffCard label="士气加成" value={base.moraleBuff} />
          <BuffCard label="联赛加成" value={base.leagueBuff} />
          <BuffCard label="杯赛加成" value={base.cupBuff} />
          <BuffCard label="抗压能力" value={base.pressureResistance} max={100} />
          <BuffCard label="冒险倾向" value={base.riskBias} />
          <BuffCard label="稳定加成" value={base.stabilityBuff} />
        </div>
      </div>

      {/* Trophies */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
        <h3 className="text-sm font-semibold text-slate-200 mb-2">
          奖杯 ({trophies.length})
        </h3>
        {trophies.length === 0 ? (
          <p className="text-sm text-slate-500">暂无奖杯</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {trophies.map((t, i) => (
              <span
                key={i}
                className="text-xs bg-amber-900/50 text-amber-300 px-2 py-1 rounded"
              >
                {getTrophyLabel(t.type)} (S{t.seasonNumber})
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Career history */}
      {career.length > 0 && (
        <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-700">
            <h3 className="text-sm font-semibold text-slate-200">
              执教历史
            </h3>
          </div>
          <div className="divide-y divide-slate-700">
            {career.map((entry, i) => (
              <div key={i} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <Link
                    to={`/team/${entry.teamId}`}
                    className="text-sm text-blue-400 hover:text-blue-300"
                  >
                    {entry.teamName}
                  </Link>
                  <p className="text-xs text-slate-400 mt-0.5">
                    S{entry.fromSeason}
                    {entry.toSeason !== null ? ` - S${entry.toSeason}` : ' - 至今'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {entry.fired && (
                    <span className="text-xs bg-red-900/50 text-red-400 px-2 py-0.5 rounded">
                      解雇
                    </span>
                  )}
                  {entry.trophies.length > 0 && (
                    <span className="text-xs bg-amber-900/50 text-amber-300 px-2 py-0.5 rounded">
                      {entry.trophies.length} 座奖杯
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BuffCard({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max?: number;
}) {
  const isPositive = value > 0;
  const isNegative = value < 0;

  return (
    <div className="bg-slate-700/50 rounded p-2 text-center">
      <p className="text-xs text-slate-400">{label}</p>
      <p
        className={`text-lg font-bold mt-0.5 ${
          isPositive
            ? 'text-green-400'
            : isNegative
              ? 'text-red-400'
              : 'text-slate-300'
        }`}
      >
        {max ? value : isPositive ? `+${value}` : value}
      </p>
    </div>
  );
}

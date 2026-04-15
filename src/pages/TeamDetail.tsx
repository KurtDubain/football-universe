import { useParams, Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import {
  getCoachName,
  getLeagueName,
  getTrophyLabel,
  formatForm,
} from '../utils/format';

export default function TeamDetail() {
  const { id } = useParams<{ id: string }>();
  const world = useGameStore((s) => s.world);

  if (!world || !id) {
    return <div className="text-slate-400">正在加载...</div>;
  }

  const base = world.teamBases[id];
  const state = world.teamStates[id];

  if (!base || !state) {
    return <div className="text-slate-400">未找到球队: {id}</div>;
  }

  const trophies = world.teamTrophies[id] ?? [];
  const records = world.teamSeasonRecords[id] ?? [];
  const coachId = state.currentCoachId;

  return (
    <div className="max-w-4xl space-y-5">
      {/* Header */}
      <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: base.color }}>
            <span className="text-white font-black text-sm sm:text-lg">{base.shortName}</span>
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-100">{base.name}</h2>
            <div className="flex items-center gap-2 sm:gap-3 mt-0.5 flex-wrap">
              <span className="text-xs text-slate-400">{getLeagueName(state.leagueLevel)}</span>
              <span className="text-xs text-slate-500">OVR {base.overall}</span>
              <span className="text-[10px] bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">
                {'★'.repeat(base.expectation)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
        {/* Base Attributes */}
        <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">
            基础属性
          </h3>
          <div className="space-y-2">
            <AttrBar label="综合" value={base.overall} />
            <AttrBar label="进攻" value={base.attack} color="bg-red-500" />
            <AttrBar label="中场" value={base.midfield} color="bg-amber-500" />
            <AttrBar label="防守" value={base.defense} color="bg-blue-500" />
            <AttrBar label="稳定" value={base.stability} color="bg-green-500" />
            <AttrBar label="深度" value={base.depth} color="bg-purple-500" />
            <AttrBar label="声望" value={base.reputation} color="bg-sky-500" />
          </div>
        </div>

        {/* Current State */}
        <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">
            当前状态
          </h3>
          <div className="space-y-2">
            <StateBar label="士气" value={state.morale} max={100} color="bg-green-500" />
            <StateBar
              label="疲劳"
              value={state.fatigue}
              max={100}
              color="bg-red-500"
              inverted
            />
            <StateBar
              label="动力"
              value={state.momentum + 10}
              max={20}
              color="bg-amber-500"
            />
            <StateBar
              label="球员健康"
              value={state.squadHealth}
              max={100}
              color="bg-blue-500"
            />
            <StateBar
              label="教练压力"
              value={state.coachPressure}
              max={100}
              color="bg-orange-500"
              inverted
            />
          </div>

          {/* Form */}
          <div className="mt-4">
            <span className="text-xs text-slate-400">近期战绩: </span>
            <div className="flex gap-1 mt-1">
              {state.recentForm.length === 0 ? (
                <span className="text-xs text-slate-500">暂无</span>
              ) : (
                formatForm(state.recentForm).map((f, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold text-white ${f.color}`}
                  >
                    {f.label}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Coach */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
        <h3 className="text-sm font-semibold text-slate-200 mb-2">
          现任教练
        </h3>
        {coachId ? (
          <div className="flex items-center gap-3">
            <Link
              to={`/coach/${coachId}`}
              className="text-blue-400 hover:text-blue-300"
            >
              {getCoachName(coachId, world.coachBases)}
            </Link>
            {world.coachBases[coachId] && (
              <span className="text-xs text-slate-400">
                评分: {world.coachBases[coachId].rating}
              </span>
            )}
          </div>
        ) : (
          <span className="text-sm text-slate-500">暂无教练</span>
        )}
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

      {/* Season records */}
      {records.length > 0 && (
        <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-700">
            <h3 className="text-sm font-semibold text-slate-200">
              历史赛季记录
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-400 border-b border-slate-700">
                  <th className="px-3 py-1.5 text-left">赛季</th>
                  <th className="px-2 py-1.5 text-center">级别</th>
                  <th className="px-2 py-1.5 text-center">排名</th>
                  <th className="px-2 py-1.5 text-center">赛</th>
                  <th className="px-2 py-1.5 text-center">胜</th>
                  <th className="px-2 py-1.5 text-center">平</th>
                  <th className="px-2 py-1.5 text-center">负</th>
                  <th className="px-2 py-1.5 text-center">进</th>
                  <th className="px-2 py-1.5 text-center">失</th>
                  <th className="px-2 py-1.5 text-center">积分</th>
                  <th className="px-2 py-1.5 text-center">备注</th>
                </tr>
              </thead>
              <tbody>
                {records.map((rec) => (
                  <tr
                    key={rec.seasonNumber}
                    className="border-t border-slate-700/50"
                  >
                    <td className="px-3 py-1.5 text-slate-300">
                      S{rec.seasonNumber}
                    </td>
                    <td className="px-2 py-1.5 text-center text-slate-400">
                      {getLeagueName(rec.leagueLevel)}
                    </td>
                    <td className="px-2 py-1.5 text-center text-slate-200 font-semibold">
                      {rec.leaguePosition}
                    </td>
                    <td className="px-2 py-1.5 text-center text-slate-400">
                      {rec.leaguePlayed}
                    </td>
                    <td className="px-2 py-1.5 text-center text-slate-300">
                      {rec.leagueWon}
                    </td>
                    <td className="px-2 py-1.5 text-center text-slate-300">
                      {rec.leagueDrawn}
                    </td>
                    <td className="px-2 py-1.5 text-center text-slate-300">
                      {rec.leagueLost}
                    </td>
                    <td className="px-2 py-1.5 text-center text-slate-300">
                      {rec.leagueGF}
                    </td>
                    <td className="px-2 py-1.5 text-center text-slate-300">
                      {rec.leagueGA}
                    </td>
                    <td className="px-2 py-1.5 text-center text-slate-100 font-bold">
                      {rec.leaguePoints}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {rec.promoted && (
                        <span className="text-xs text-green-400">升级</span>
                      )}
                      {rec.relegated && (
                        <span className="text-xs text-red-400">降级</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Attribute bar ──────────────────────────────────────────

function AttrBar({
  label,
  value,
  color = 'bg-blue-500',
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-400 w-8 text-right">{label}</span>
      <div className="flex-1 bg-slate-700 rounded-full h-2.5 overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-xs text-slate-300 w-7 text-right font-mono">
        {value}
      </span>
    </div>
  );
}

function StateBar({
  label,
  value,
  max,
  color = 'bg-blue-500',
  inverted = false,
}: {
  label: string;
  value: number;
  max: number;
  color?: string;
  inverted?: boolean;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const displayColor = inverted && pct > 60 ? 'bg-red-500' : color;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-400 w-16 text-right">{label}</span>
      <div className="flex-1 bg-slate-700 rounded-full h-2 overflow-hidden">
        <div
          className={`h-full rounded-full ${displayColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-slate-300 w-7 text-right font-mono">
        {value}
      </span>
    </div>
  );
}

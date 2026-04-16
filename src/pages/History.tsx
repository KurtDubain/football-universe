import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { getTeamName } from '../utils/format';
import SeasonReview from '../components/SeasonReview';

export default function History() {
  const world = useGameStore((s) => s.world);
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);

  if (!world) return <div className="text-slate-400">正在加载...</div>;

  const honors = world.honorHistory;

  // All-time trophy leaders
  const trophyCounts: { teamId: string; name: string; count: number; color: string }[] = [];
  for (const [teamId, trophies] of Object.entries(world.teamTrophies)) {
    if (trophies.length > 0) {
      trophyCounts.push({
        teamId,
        name: getTeamName(teamId, world.teamBases),
        count: trophies.length,
        color: (world.teamBases[teamId] as any)?.color ?? '#666',
      });
    }
  }
  trophyCounts.sort((a, b) => b.count - a.count);

  return (
    <div className="max-w-4xl space-y-5">
      <h2 className="text-xl font-bold text-slate-100">历史荣誉</h2>

      {/* Trophy leaderboard */}
      {trophyCounts.length > 0 && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">历史奖杯榜</h3>
          <div className="space-y-1.5">
            {trophyCounts.slice(0, 10).map((t, i) => (
              <div key={t.teamId} className="flex items-center gap-2">
                <span className={`w-5 text-center text-xs font-bold ${i === 0 ? 'text-amber-400' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-amber-700' : 'text-slate-500'}`}>
                  {i + 1}
                </span>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                <Link to={`/team/${t.teamId}`} className="text-sm text-slate-200 hover:text-blue-400 flex-1 truncate">
                  {t.name}
                </Link>
                <span className="text-sm font-bold text-amber-400">{t.count}</span>
                <span className="text-[10px] text-slate-500">座</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Achievements */}
      {(world.achievements ?? []).length > 0 && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">成就殿堂</h3>
          <div className="flex flex-wrap gap-2">
            {(world.achievements ?? []).map((a: any) => (
              <div key={a.id} className="bg-amber-900/20 border border-amber-700/30 rounded-lg px-3 py-2 text-xs">
                <span className="text-amber-400 font-semibold">{a.title}</span>
                <span className="text-slate-500 ml-1.5">S{a.seasonNumber}</span>
                <p className="text-slate-400 text-[10px] mt-0.5">{a.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Season list */}
      {honors.length === 0 ? (
        <p className="text-sm text-slate-500">暂无历史记录，完成至少一个赛季后显示</p>
      ) : (
        <div className="space-y-3">
          {[...honors].reverse().map((record) => {
            const isExpanded = expandedSeason === record.seasonNumber;
            return (
              <div key={record.seasonNumber} className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                {/* Season header — always visible */}
                <button
                  onClick={() => setExpandedSeason(isExpanded ? null : record.seasonNumber)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-700/30 transition-colors cursor-pointer text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-slate-100">第{record.seasonNumber}赛季</span>
                    <span className="text-xs text-amber-400">
                      冠军: {getTeamName(record.league1Champion, world.teamBases)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {record.worldCupWinner && (
                      <span className="text-[10px] bg-sky-900/50 text-sky-400 px-1.5 py-0.5 rounded">环球冠军杯</span>
                    )}
                    <span className="text-slate-500 text-xs">{isExpanded ? '收起 ▲' : '展开 ▼'}</span>
                  </div>
                </button>

                {/* Expanded: full season review */}
                {isExpanded && (
                  <div className="border-t border-slate-700 p-4">
                    <SeasonReview world={world} seasonNumber={record.seasonNumber} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

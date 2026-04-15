import { Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { getTeamName, getCoachName } from '../utils/format';
import type { HonorRecord } from '../types/honor';

export default function History() {
  const world = useGameStore((s) => s.world);

  if (!world) {
    return <div className="text-slate-400">正在加载...</div>;
  }

  const honors = world.honorHistory;

  // Compute all-time trophy leaders
  const trophyCounts: Record<string, { name: string; count: number }> = {};
  for (const [teamId, trophies] of Object.entries(world.teamTrophies)) {
    if (trophies.length > 0) {
      trophyCounts[teamId] = {
        name: getTeamName(teamId, world.teamBases),
        count: trophies.length,
      };
    }
  }
  const trophyLeaders = Object.entries(trophyCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);

  return (
    <div className="max-w-4xl space-y-6">
      <h2 className="text-xl font-bold text-slate-100">历史荣誉</h2>

      {/* All-time trophy leaders */}
      {trophyLeaders.length > 0 && (
        <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">
            历史奖杯榜
          </h3>
          <div className="space-y-2">
            {trophyLeaders.map(([teamId, info], i) => (
              <div
                key={teamId}
                className="flex items-center gap-3"
              >
                <span className="text-sm text-slate-500 w-6 text-right">
                  {i + 1}.
                </span>
                <Link
                  to={`/team/${teamId}`}
                  className="text-sm text-slate-200 hover:text-blue-400 flex-1"
                >
                  {info.name}
                </Link>
                <span className="text-sm font-bold text-amber-400">
                  {info.count} 座
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Season by season */}
      {honors.length === 0 ? (
        <p className="text-sm text-slate-500">暂无历史记录, 完成至少一个赛季后显示</p>
      ) : (
        <div className="space-y-4">
          {[...honors].reverse().map((record) => (
            <SeasonHonorCard
              key={record.seasonNumber}
              record={record}
              teamBases={world.teamBases}
              coachBases={world.coachBases}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SeasonHonorCard({
  record,
  teamBases,
  coachBases,
}: {
  record: HonorRecord;
  teamBases: Record<string, { name: string }>;
  coachBases: Record<string, { name: string }>;
}) {
  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
      <div className="px-4 py-2 border-b border-slate-700 bg-slate-750">
        <h3 className="text-sm font-bold text-slate-100">
          第 {record.seasonNumber} 赛季
        </h3>
      </div>

      <div className="p-4 space-y-3">
        {/* Champions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
          <ChampionBadge
            title="顶级联赛冠军"
            teamId={record.league1Champion}
            teamBases={teamBases}
            color="bg-amber-900/50 text-amber-300"
          />
          <ChampionBadge
            title="甲级联赛冠军"
            teamId={record.league2Champion}
            teamBases={teamBases}
            color="bg-slate-700 text-slate-300"
          />
          <ChampionBadge
            title="乙级联赛冠军"
            teamId={record.league3Champion}
            teamBases={teamBases}
            color="bg-orange-900/50 text-orange-300"
          />
          <ChampionBadge
            title="联赛杯冠军"
            teamId={record.leagueCupWinner}
            teamBases={teamBases}
            color="bg-green-900/50 text-green-300"
          />
          <ChampionBadge
            title="超级杯冠军"
            teamId={record.superCupWinner}
            teamBases={teamBases}
            color="bg-purple-900/50 text-purple-300"
          />
          {record.worldCupWinner && (
            <ChampionBadge
              title="环球冠军杯"
              teamId={record.worldCupWinner}
              teamBases={teamBases}
              color="bg-sky-900/50 text-sky-300"
            />
          )}
        </div>

        {/* Promoted / Relegated */}
        {(record.promoted.length > 0 || record.relegated.length > 0) && (
          <div className="flex flex-wrap gap-2 text-xs">
            {record.promoted.map((p, i) => (
              <span key={i} className="bg-green-900/30 text-green-400 px-2 py-0.5 rounded">
                <Link to={`/team/${p.teamId}`} className="hover:underline">
                  {getTeamName(p.teamId, teamBases)}
                </Link>
                {' '}升级 ({p.from} {'>'} {p.to})
              </span>
            ))}
            {record.relegated.map((r, i) => (
              <span key={i} className="bg-red-900/30 text-red-400 px-2 py-0.5 rounded">
                <Link to={`/team/${r.teamId}`} className="hover:underline">
                  {getTeamName(r.teamId, teamBases)}
                </Link>
                {' '}降级 ({r.from} {'>'} {r.to})
              </span>
            ))}
          </div>
        )}

        {/* Coach changes */}
        {record.coachChanges.length > 0 && (
          <div>
            <p className="text-xs text-slate-500 mb-1">教练变动:</p>
            <div className="flex flex-wrap gap-2 text-xs">
              {record.coachChanges.map((c, i) => (
                <span
                  key={i}
                  className="bg-slate-700 text-slate-300 px-2 py-0.5 rounded"
                >
                  <Link to={`/team/${c.teamId}`} className="hover:underline">
                    {getTeamName(c.teamId, teamBases)}
                  </Link>
                  :{' '}
                  <Link to={`/coach/${c.oldCoachId}`} className="text-red-400 hover:underline">
                    {getCoachName(c.oldCoachId, coachBases)}
                  </Link>
                  {' -> '}
                  <Link to={`/coach/${c.newCoachId}`} className="text-green-400 hover:underline">
                    {getCoachName(c.newCoachId, coachBases)}
                  </Link>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ChampionBadge({
  title,
  teamId,
  teamBases,
  color,
}: {
  title: string;
  teamId: string;
  teamBases: Record<string, { name: string }>;
  color: string;
}) {
  return (
    <div className={`rounded px-3 py-2 ${color}`}>
      <p className="text-xs opacity-70">{title}</p>
      <Link
        to={`/team/${teamId}`}
        className="text-sm font-semibold hover:underline"
      >
        {getTeamName(teamId, teamBases)}
      </Link>
    </div>
  );
}

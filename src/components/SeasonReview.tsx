import { Link } from 'react-router-dom';
import type { GameWorld } from '../engine/season/season-manager';
import type { SeasonRecord } from '../types/team';
import { getTeamName } from '../utils/format';
import { getTopScorers, getTopAssists } from '../engine/players/stats';

interface Props {
  world: GameWorld;
  seasonNumber: number;
}

type RecordWithTeam = SeasonRecord & { teamId: string };

export default function SeasonReview({ world, seasonNumber }: Props) {
  const honor = world.honorHistory.find(h => h.seasonNumber === seasonNumber);
  if (!honor) return null;

  const tb = world.teamBases;

  // Collect season records
  const seasonRecords: RecordWithTeam[] = [];
  for (const [teamId, records] of Object.entries(world.teamSeasonRecords)) {
    const rec = records.find(r => r.seasonNumber === seasonNumber);
    if (rec) seasonRecords.push({ ...rec, teamId });
  }

  const l1Records = seasonRecords.filter(r => r.leagueLevel === 1).sort((a, b) => a.leaguePosition - b.leaguePosition);

  // Total goals across all leagues
  const totalGoals = seasonRecords.reduce((s, r) => s + r.leagueGF, 0);
  const totalMatches = seasonRecords.reduce((s, r) => s + r.leaguePlayed, 0) / 2;

  // Best defense / attack in top league
  const bestDefense = l1Records.length > 0 ? l1Records.reduce((b, r) => r.leagueGA < b.leagueGA ? r : b) : null;
  const bestAttack = l1Records.length > 0 ? l1Records.reduce((b, r) => r.leagueGF > b.leagueGF ? r : b) : null;

  // Top scorers
  const scorers = getTopScorers(world.playerStats, 5);
  const assists = getTopAssists(world.playerStats, 3);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="text-center py-4 bg-gradient-to-r from-amber-900/20 via-slate-800 to-amber-900/20 rounded-lg border border-amber-700/30">
        <h2 className="text-2xl font-black text-slate-100">第{seasonNumber}赛季 回顾</h2>
        <p className="text-xs text-slate-500 mt-1">{totalMatches}场比赛 · {totalGoals}粒进球 · 场均{totalMatches > 0 ? (totalGoals / totalMatches).toFixed(1) : '0'}球</p>
      </div>

      {/* Champions grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <ChampionCard title="顶级联赛冠军" teamId={honor.league1Champion} runnerUp={l1Records[1]?.teamId} tb={tb} accent="amber" />
        <ChampionCard title="甲级联赛冠军" teamId={honor.league2Champion} tb={tb} accent="blue" />
        <ChampionCard title="乙级联赛冠军" teamId={honor.league3Champion} tb={tb} accent="emerald" />
        <ChampionCard title="联赛杯冠军" teamId={honor.leagueCupWinner} tb={tb} accent="amber" />
        <ChampionCard title="超级杯冠军" teamId={honor.superCupWinner} tb={tb} accent="purple" />
        {honor.worldCupWinner && <ChampionCard title="环球冠军杯" teamId={honor.worldCupWinner} tb={tb} accent="sky" />}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {bestAttack && (
          <StatCard label="最强火力" value={`${getTeamName(bestAttack.teamId, tb)}`} sub={`${bestAttack.leagueGF}球`} />
        )}
        {bestDefense && (
          <StatCard label="最佳防守" value={`${getTeamName(bestDefense.teamId, tb)}`} sub={`仅失${bestDefense.leagueGA}球`} />
        )}
        {l1Records.length > 0 && (
          <StatCard label="最多胜场" value={getTeamName(l1Records.reduce((b, r) => r.leagueWon > b.leagueWon ? r : b).teamId, tb)} sub={`${l1Records.reduce((b, r) => r.leagueWon > b.leagueWon ? r : b).leagueWon}胜`} />
        )}
        <StatCard label="换帅次数" value={`${honor.coachChanges.length}次`} sub={honor.coachChanges.length > 0 ? honor.coachChanges.map(c => tb[c.teamId]?.name).slice(0, 2).join('、') : '无'} />
      </div>

      {/* Top scorer highlight + list */}
      {scorers.length > 0 && (() => {
        const king = scorers[0];
        const kingParts = king.playerId.split('-');
        const kingNum = kingParts[kingParts.length - 1];
        const kingTeam = tb[king.teamId];

        return (
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            {/* Shooter king card */}
            <div className="p-4 bg-gradient-to-r from-amber-900/20 to-slate-800 border-b border-slate-700/50">
              <div className="flex items-center gap-3">
                <Link to={`/player/${king.playerId}`} className="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black text-white shrink-0 hover:opacity-80 transition-opacity" style={{ backgroundColor: kingTeam?.color ?? '#f59e0b' }}>
                  {kingNum}
                </Link>
                <div>
                  <div className="text-[10px] text-amber-400 font-semibold">赛季射手王 👑</div>
                  <Link to={`/team/${king.teamId}`} className="text-sm font-bold text-slate-100 hover:text-blue-400">{getTeamName(king.teamId, tb)} {kingNum}号</Link>
                  <div className="flex gap-3 mt-0.5">
                    <span className="text-sm font-bold text-amber-400">{king.goals} 球</span>
                    {king.assists > 0 && <span className="text-xs text-slate-400">{king.assists} 助攻</span>}
                    <span className="text-xs text-slate-500">{king.appearances} 场</span>
                  </div>
                </div>
              </div>
            </div>
            {/* Rest of top scorers */}
            {scorers.length > 1 && (
              <div className="p-3 space-y-1">
                {scorers.slice(1).map((s, i) => {
                  const parts = s.playerId.split('-');
                  const num = parts[parts.length - 1];
                  return (
                    <div key={s.playerId} className="flex items-center gap-2 text-xs">
                      <span className={`w-4 text-center font-bold ${i === 0 ? 'text-slate-300' : i === 1 ? 'text-amber-700' : 'text-slate-500'}`}>{i + 2}</span>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tb[s.teamId]?.color ?? '#666' }} />
                      <Link to={`/player/${s.playerId}`} className="text-slate-300 hover:text-blue-400 flex-1 truncate">{getTeamName(s.teamId, tb)} {num}号</Link>
                      <span className="font-bold text-slate-200">{s.goals}球</span>
                      {s.assists > 0 && <span className="text-slate-500">{s.assists}助</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* World Cup details */}
      {honor.worldCupWinner && (
        <div className="bg-sky-900/15 rounded-xl border border-sky-800/30 p-3">
          <h3 className="text-xs font-semibold text-sky-400 mb-2">环球冠军杯</h3>
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <span className="text-amber-400 font-semibold">冠军:</span>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tb[honor.worldCupWinner]?.color ?? '#666' }} />
            <Link to={`/team/${honor.worldCupWinner}`} className="hover:text-blue-400 font-medium">{getTeamName(honor.worldCupWinner, tb)}</Link>
          </div>
        </div>
      )}

      {/* Promotions & Relegations */}
      {(honor.promoted.length > 0 || honor.relegated.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {honor.promoted.length > 0 && (
            <div className="bg-green-900/15 rounded-xl border border-green-800/30 p-3">
              <h3 className="text-xs font-semibold text-green-400 mb-2">升级球队</h3>
              {honor.promoted.map(p => (
                <div key={p.teamId} className="text-xs text-slate-300 flex items-center gap-1.5 py-0.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tb[p.teamId]?.color ?? '#666' }} />
                  <Link to={`/team/${p.teamId}`} className="hover:text-blue-400">{getTeamName(p.teamId, tb)}</Link>
                  <span className="text-slate-500">{p.from}级→{p.to}级</span>
                </div>
              ))}
            </div>
          )}
          {honor.relegated.length > 0 && (
            <div className="bg-red-900/15 rounded-xl border border-red-800/30 p-3">
              <h3 className="text-xs font-semibold text-red-400 mb-2">降级球队</h3>
              {honor.relegated.map(r => (
                <div key={r.teamId} className="text-xs text-slate-300 flex items-center gap-1.5 py-0.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tb[r.teamId]?.color ?? '#666' }} />
                  <Link to={`/team/${r.teamId}`} className="hover:text-blue-400">{getTeamName(r.teamId, tb)}</Link>
                  <span className="text-slate-500">{r.from}级→{r.to}级</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChampionCard({ title, teamId, runnerUp, tb, accent }: { title: string; teamId: string; runnerUp?: string; tb: Record<string, any>; accent: string }) {
  const team = tb[teamId];
  if (!team) return null;
  const colors: Record<string, string> = {
    amber: 'border-amber-700/40 bg-amber-900/15',
    blue: 'border-blue-700/40 bg-blue-900/15',
    emerald: 'border-emerald-700/40 bg-emerald-900/15',
    purple: 'border-purple-700/40 bg-purple-900/15',
    sky: 'border-sky-700/40 bg-sky-900/15',
  };

  return (
    <div className={`rounded-xl border p-3 ${colors[accent] ?? colors.amber}`}>
      <div className="text-[10px] text-slate-500 mb-1">{title}</div>
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ backgroundColor: team.color }}>
          {team.shortName?.charAt(0)}
        </span>
        <Link to={`/team/${teamId}`} className="text-sm font-semibold text-slate-100 hover:text-blue-400 truncate">{team.name}</Link>
      </div>
      {runnerUp && tb[runnerUp] && (
        <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-slate-500">
          <span>亚军:</span>
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tb[runnerUp]?.color ?? '#666' }} />
          <Link to={`/team/${runnerUp}`} className="text-slate-400 hover:text-blue-400">{getTeamName(runnerUp, tb)}</Link>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-3">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-200 mt-0.5 truncate">{value}</div>
      <div className="text-[10px] text-slate-500 truncate">{sub}</div>
    </div>
  );
}

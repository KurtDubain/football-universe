import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { getTeamName, getCoachName, getTierLabel, getTierColor } from '../utils/format';
import SeasonReview from '../components/SeasonReview';

export default function History() {
  const world = useGameStore((s) => s.world);
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);
  const [tab, setTab] = useState<'seasons' | 'records' | 'coaches'>('seasons');

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
        color: (world.teamBases[teamId] as { color?: string })?.color ?? '#666',
      });
    }
  }
  trophyCounts.sort((a, b) => b.count - a.count);

  // Fun records computed from season records
  const funRecords = useMemo(() => {
    if (honors.length === 0) return null;

    const allRecords = Object.entries(world.teamSeasonRecords).flatMap(([tid, recs]) =>
      recs.map(r => ({ ...r, teamId: tid, teamName: getTeamName(tid, world.teamBases) }))
    );
    if (allRecords.length === 0) return null;

    // Most points in a season
    const mostPoints = allRecords.reduce((b, r) => r.leaguePoints > (b?.leaguePoints ?? 0) ? r : b, allRecords[0]);
    // Fewest points
    const fewestPoints = allRecords.filter(r => r.leaguePlayed > 5).reduce((b, r) => r.leaguePoints < (b?.leaguePoints ?? 999) ? r : b, allRecords[0]);
    // Most goals in a season
    const mostGoals = allRecords.reduce((b, r) => r.leagueGF > (b?.leagueGF ?? 0) ? r : b, allRecords[0]);
    // Best defense (fewest conceded)
    const bestDefense = allRecords.filter(r => r.leaguePlayed > 5).reduce((b, r) => r.leagueGA < (b?.leagueGA ?? 999) ? r : b, allRecords[0]);
    // Most wins
    const mostWins = allRecords.reduce((b, r) => r.leagueWon > (b?.leagueWon ?? 0) ? r : b, allRecords[0]);
    // Most losses
    const mostLosses = allRecords.reduce((b, r) => r.leagueLost > (b?.leagueLost ?? 0) ? r : b, allRecords[0]);

    // Consecutive champions (same team winning L1 in a row)
    let maxConsec = 0, consecTeam = '', consecFrom = 0;
    let curConsec = 0, curTeam = '';
    for (const h of honors) {
      if (h.league1Champion === curTeam) {
        curConsec++;
      } else {
        curTeam = h.league1Champion;
        curConsec = 1;
      }
      if (curConsec > maxConsec) {
        maxConsec = curConsec;
        consecTeam = curTeam;
        consecFrom = h.seasonNumber - curConsec + 1;
      }
    }

    // Most coach changes in a season
    const mostChanges = honors.reduce((b, h) => h.coachChanges.length > (b?.coachChanges.length ?? 0) ? h : b, honors[0]);

    // Total goals across all seasons
    const totalGoals = allRecords.reduce((s, r) => s + r.leagueGF, 0);
    const totalMatches = allRecords.reduce((s, r) => s + r.leaguePlayed, 0) / 2;

    return {
      mostPoints, fewestPoints, mostGoals, bestDefense, mostWins, mostLosses,
      maxConsec, consecTeam, consecFrom,
      mostChanges,
      totalGoals, totalMatches,
      totalSeasons: honors.length,
    };
  }, [honors, world.teamSeasonRecords, world.teamBases]);

  // Coach career stats
  const coachStats = useMemo(() => {
    return Object.entries(world.coachCareers)
      .map(([coachId, career]) => {
        const base = world.coachBases[coachId];
        if (!base) return null;
        const trophies = world.coachTrophies[coachId] ?? [];
        const teamsManaged = new Set(career.map(c => c.teamId)).size;
        const totalSeasons = career.reduce((s, c) => s + ((c.toSeason ?? world.seasonState.seasonNumber) - c.fromSeason + 1), 0);
        const firedCount = career.filter(c => c.fired).length;
        return { coachId, name: base.name, rating: base.rating, trophies: trophies.length, teamsManaged, totalSeasons, firedCount };
      })
      .filter(Boolean)
      .sort((a, b) => b!.trophies - a!.trophies);
  }, [world.coachCareers, world.coachBases, world.coachTrophies, world.seasonState.seasonNumber]);

  const tabs = [
    { key: 'seasons' as const, label: '赛季历史' },
    { key: 'records' as const, label: '趣味数据' },
    { key: 'coaches' as const, label: '名帅殿堂' },
  ];

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-100">历史荣誉</h2>
        <div className="flex bg-slate-800 rounded-lg border border-slate-700 p-0.5">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-1 text-xs rounded-md cursor-pointer transition-colors ${tab === t.key ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >{t.label}</button>
          ))}
        </div>
      </div>

      {/* Trophy leaderboard — always visible */}
      {trophyCounts.length > 0 && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">历史奖杯榜</h3>
          <div className="space-y-1.5">
            {trophyCounts.slice(0, 10).map((t, i) => (
              <div key={t.teamId} className="flex items-center gap-2">
                <span className={`w-5 text-center text-xs font-bold ${i === 0 ? 'text-amber-400' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-amber-700' : 'text-slate-500'}`}>{i + 1}</span>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                <Link to={`/team/${t.teamId}`} className="text-sm text-slate-200 hover:text-blue-400 flex-1 truncate">{t.name}</Link>
                <span className="text-sm font-bold text-amber-400">{t.count}</span>
                <span className="text-[10px] text-slate-500">座</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ Tab: 赛季历史 ═══ */}
      {tab === 'seasons' && (
        <>
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

          {honors.length === 0 ? (
            <p className="text-sm text-slate-500">暂无历史记录，完成至少一个赛季后显示</p>
          ) : (
            <div className="space-y-3">
              {[...honors].reverse().map((record) => {
                const isExpanded = expandedSeason === record.seasonNumber;
                return (
                  <div key={record.seasonNumber} className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                    <button onClick={() => setExpandedSeason(isExpanded ? null : record.seasonNumber)}
                      className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-700/30 transition-colors cursor-pointer text-left"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-slate-100">第{record.seasonNumber}赛季</span>
                        <span className="text-xs text-amber-400">冠军: {getTeamName(record.league1Champion, world.teamBases)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {record.worldCupWinner && <span className="text-[10px] bg-sky-900/50 text-sky-400 px-1.5 py-0.5 rounded">环球冠军杯</span>}
                        <span className="text-slate-500 text-xs">{isExpanded ? '▲' : '▼'}</span>
                      </div>
                    </button>
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
        </>
      )}

      {/* ═══ Tab: 趣味数据 ═══ */}
      {tab === 'records' && funRecords && (
        <div className="space-y-4">
          {/* Overview stats */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <RecordCard label="历史总赛季" value={`${funRecords.totalSeasons}`} />
            <RecordCard label="历史总进球" value={`${funRecords.totalGoals}`} />
            <RecordCard label="历史总场次" value={`${Math.round(funRecords.totalMatches)}`} />
          </div>

          {/* Highlight records */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <RecordDetail emoji="🏆" title="最高赛季积分" team={funRecords.mostPoints.teamName} detail={`S${funRecords.mostPoints.seasonNumber} · ${funRecords.mostPoints.leaguePoints}分`} teamId={funRecords.mostPoints.teamId} color={(world.teamBases[funRecords.mostPoints.teamId] as any)?.color} />
            <RecordDetail emoji="⚽" title="单赛季最多进球" team={funRecords.mostGoals.teamName} detail={`S${funRecords.mostGoals.seasonNumber} · ${funRecords.mostGoals.leagueGF}球`} teamId={funRecords.mostGoals.teamId} color={(world.teamBases[funRecords.mostGoals.teamId] as any)?.color} />
            <RecordDetail emoji="🛡️" title="最佳防守赛季" team={funRecords.bestDefense.teamName} detail={`S${funRecords.bestDefense.seasonNumber} · 仅失${funRecords.bestDefense.leagueGA}球`} teamId={funRecords.bestDefense.teamId} color={(world.teamBases[funRecords.bestDefense.teamId] as any)?.color} />
            <RecordDetail emoji="💪" title="单赛季最多胜场" team={funRecords.mostWins.teamName} detail={`S${funRecords.mostWins.seasonNumber} · ${funRecords.mostWins.leagueWon}胜`} teamId={funRecords.mostWins.teamId} color={(world.teamBases[funRecords.mostWins.teamId] as any)?.color} />
            <RecordDetail emoji="😢" title="最低赛季积分" team={funRecords.fewestPoints.teamName} detail={`S${funRecords.fewestPoints.seasonNumber} · ${funRecords.fewestPoints.leaguePoints}分`} teamId={funRecords.fewestPoints.teamId} color={(world.teamBases[funRecords.fewestPoints.teamId] as any)?.color} />
            <RecordDetail emoji="💀" title="单赛季最多败场" team={funRecords.mostLosses.teamName} detail={`S${funRecords.mostLosses.seasonNumber} · ${funRecords.mostLosses.leagueLost}负`} teamId={funRecords.mostLosses.teamId} color={(world.teamBases[funRecords.mostLosses.teamId] as any)?.color} />
          </div>

          {/* Special records */}
          {funRecords.maxConsec >= 2 && (
            <div className="bg-amber-900/15 rounded-xl border border-amber-700/30 p-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">👑</span>
                <div>
                  <div className="text-sm font-bold text-amber-300">
                    {getTeamName(funRecords.consecTeam, world.teamBases)} {funRecords.maxConsec}连冠
                  </div>
                  <div className="text-[10px] text-slate-500">S{funRecords.consecFrom} - S{funRecords.consecFrom + funRecords.maxConsec - 1}</div>
                </div>
              </div>
            </div>
          )}

          {funRecords.mostChanges.coachChanges.length >= 3 && (
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
              <div className="text-xs text-slate-400">
                最动荡赛季: 第{funRecords.mostChanges.seasonNumber}赛季 — {funRecords.mostChanges.coachChanges.length}次换帅
              </div>
            </div>
          )}
        </div>
      )}
      {tab === 'records' && !funRecords && (
        <p className="text-sm text-slate-500">完成至少一个赛季后显示趣味数据</p>
      )}

      {/* ═══ Tab: 名帅殿堂 ═══ */}
      {tab === 'coaches' && (
        <div className="space-y-2">
          {coachStats.filter(Boolean).map((cs) => {
            const c = cs!;
            return (
              <Link key={c.coachId} to={`/coach/${c.coachId}`} className="block bg-slate-800 rounded-xl border border-slate-700 p-3 hover:border-slate-600 transition-colors hover-lift">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${c.rating >= 85 ? 'bg-amber-500' : c.rating >= 70 ? 'bg-blue-500' : 'bg-slate-600'}`}>
                    <span className="text-white font-bold text-xs">{c.rating}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-100">{c.name}</div>
                    <div className="flex gap-3 text-[10px] text-slate-500 mt-0.5">
                      <span>{c.totalSeasons}个赛季</span>
                      <span>{c.teamsManaged}支球队</span>
                      {c.firedCount > 0 && <span className="text-red-400">{c.firedCount}次解雇</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-lg font-bold text-amber-400">{c.trophies}</div>
                    <div className="text-[9px] text-slate-500">奖杯</div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RecordCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-3 text-center">
      <div className="text-xl font-bold text-slate-100">{value}</div>
      <div className="text-[10px] text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

function RecordDetail({ emoji, title, team, detail, teamId, color }: { emoji: string; title: string; team: string; detail: string; teamId: string; color?: string }) {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-3 flex items-center gap-3">
      <span className="text-xl shrink-0">{emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-slate-500">{title}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color ?? '#666' }} />
          <Link to={`/team/${teamId}`} className="text-sm font-semibold text-slate-200 hover:text-blue-400 truncate">{team}</Link>
        </div>
        <div className="text-[10px] text-slate-400 mt-0.5">{detail}</div>
      </div>
    </div>
  );
}

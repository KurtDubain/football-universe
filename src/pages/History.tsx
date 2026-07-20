import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { getTeamName, getCoachName } from '../utils/format';
import { formatMoney } from '../engine/economy/finance';
import SeasonReview from '../components/SeasonReview';
import type { Achievement } from '../engine/achievements';
import type { GameWorld } from '../engine/season/season-manager';
import { PageHeader, PageShell, SegmentedControl } from '../components/ui';
import { rankClubCoefficients } from '../engine/rankings/club-coefficient';

export default function History() {
  const world = useGameStore((s) => s.world);

  if (!world) return <div className="text-slate-400">正在加载...</div>;
  return <HistoryContent world={world} />;
}

function HistoryContent({ world }: { world: GameWorld }) {
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);
  const [tab, setTab] = useState<'seasons' | 'coefficient' | 'records' | 'coaches' | 'hall'>('seasons');

  const honors = world.honorHistory;

  // All-time trophy leaders
  const trophyCounts: { teamId: string; name: string; count: number; color: string }[] = [];
  for (const [teamId, trophies] of Object.entries(world.teamTrophies)) {
    if (trophies.length > 0) {
      trophyCounts.push({
        teamId,
        name: getTeamName(teamId, world.teamBases),
        count: trophies.length,
        color: world.teamBases[teamId]?.color ?? '#666',
      });
    }
  }
  trophyCounts.sort((a, b) => b.count - a.count);

  // Phase H — wealth leaderboard (current cash by team).
  // Cash CAN go negative — separate richest / poorest views.
  const wealthRanking: { teamId: string; name: string; cash: number; color: string }[] = [];
  for (const [teamId, fin] of Object.entries(world.teamFinances ?? {})) {
    wealthRanking.push({
      teamId,
      name: getTeamName(teamId, world.teamBases),
      cash: fin.cash,
      color: world.teamBases[teamId]?.color ?? '#666',
    });
  }
  wealthRanking.sort((a, b) => b.cash - a.cash);

  const coefficientRanking = useMemo(
    () => rankClubCoefficients(world.teamBases, world.teamSeasonRecords),
    [world.teamBases, world.teamSeasonRecords],
  );

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
    { key: 'coefficient' as const, label: '俱乐部积分' },
    { key: 'records' as const, label: '趣味数据' },
    { key: 'hall' as const, label: '荣誉殿堂' },
    { key: 'coaches' as const, label: '名帅殿堂' },
  ];

  return (
    <PageShell width="standard" className="tabular-nums">
      <PageHeader
        title="历史荣誉"
        actions={(
          <SegmentedControl
            value={tab}
            onChange={setTab}
            ariaLabel="历史荣誉分类"
            stretch
            options={tabs.map(t => ({ value: t.key, label: t.label }))}
          />
        )}
      />

      {/* Trophy leaderboard */}
      {tab === 'hall' && trophyCounts.length > 0 && (
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

      {/* Current cash belongs to the statistics view. */}
      {tab === 'records' && wealthRanking.length > 0 && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">财富榜</h3>
            <span className="text-[10px] text-slate-600">当前现金 · Phase H</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
            {/* Richest 5 */}
            <div className="space-y-1.5">
              <div className="text-[10px] text-emerald-400/80 uppercase tracking-wider mb-1">最富有</div>
              {wealthRanking.slice(0, 5).map((t, i) => (
                <div key={t.teamId} className="flex items-center gap-2">
                  <span className={`w-5 text-center text-xs font-bold ${i === 0 ? 'text-emerald-400' : 'text-slate-500'}`}>{i + 1}</span>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                  <Link to={`/team/${t.teamId}`} className="text-sm text-slate-200 hover:text-blue-400 flex-1 truncate">{t.name}</Link>
                  <span className="text-sm font-bold text-emerald-300">{formatMoney(t.cash)}</span>
                </div>
              ))}
            </div>
            {/* Poorest 5 (only show if any have negative cash, OR show bottom 5) */}
            <div className="space-y-1.5">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">
                {wealthRanking.some(team => team.cash < 0) ? '财政告急' : '现金榜末位'}
              </div>
              {(() => {
                const slice = wealthRanking.slice(-5).reverse();
                return slice.map((t, i) => {
                  const tone = t.cash < 0 ? 'text-red-300' : t.cash < 10 ? 'text-amber-300' : 'text-slate-400';
                  return (
                    <div key={t.teamId} className="flex items-center gap-2">
                      <span className="w-5 text-center text-xs font-bold text-slate-500">{wealthRanking.length - i}</span>
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                      <Link to={`/team/${t.teamId}`} className="text-sm text-slate-200 hover:text-blue-400 flex-1 truncate">{t.name}</Link>
                      <span className={`text-sm font-bold ${tone}`}>{formatMoney(t.cash)}</span>
                    </div>
                  );
                });
              })()}
            </div>
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
                {(world.achievements ?? []).map((a: Achievement) => (
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

      {/* ═══ Tab: 俱乐部积分 ═══ */}
      {tab === 'coefficient' && (
        <section className="overflow-hidden rounded-lg border border-slate-700 bg-slate-800">
          <div className="border-b border-slate-700 px-4 py-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">五赛季俱乐部积分</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                  联赛与杯赛成绩计分，近季权重更高；洲际杯按区域积分排名取得资格。
                </p>
              </div>
              <span className="text-[11px] text-slate-500">
                {world.seasonState.seasonNumber % 4 === 2 ? '本届' : '下一届'}：S{world.seasonState.seasonNumber + ((2 - world.seasonState.seasonNumber) % 4 + 4) % 4}
              </span>
            </div>
          </div>
          <div className="divide-y divide-slate-700/60">
            {coefficientRanking.map(entry => {
              const team = world.teamBases[entry.teamId];
              const hasHistory = entry.seasons.length > 0;
              return (
                <div key={entry.teamId} data-testid="club-coefficient-row" className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5 sm:grid-cols-[2.5rem_minmax(10rem,1fr)_minmax(12rem,auto)_4.5rem] sm:px-4">
                  <span className={`text-center text-sm font-bold ${entry.rank <= 3 ? 'text-amber-300' : 'text-slate-500'}`}>{entry.rank}</span>
                  <Link to={`/team/${entry.teamId}`} className="min-w-0 text-sm font-medium text-slate-200 hover:text-emerald-300">
                    <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: team?.color ?? '#64748b' }} />
                    {team?.name ?? entry.teamId}
                    <span className="ml-2 text-[11px] font-normal text-slate-600">{team?.region?.split('+')[0]}</span>
                  </Link>
                  <div className="hidden justify-end gap-1 sm:flex" title={entry.seasons.map(season => `S${season.seasonNumber}: ${season.rawPoints} × ${season.weight} = ${season.points}`).join('\n')}>
                    {entry.seasons.length > 0 ? entry.seasons.map(season => (
                      <span key={season.seasonNumber} className="rounded border border-slate-700 bg-slate-900/50 px-1.5 py-0.5 text-[10px] text-slate-500">
                        S{season.seasonNumber} {season.points}
                      </span>
                    )) : <span className="text-[11px] text-slate-600">暂无赛季积分</span>}
                  </div>
                  <span className={`text-right text-sm font-bold ${hasHistory ? 'text-emerald-300' : 'text-slate-500'}`}>{entry.points.toFixed(1)}</span>
                </div>
              );
            })}
          </div>
          {world.honorHistory.length === 0 && (
            <p className="border-t border-slate-700 px-4 py-3 text-[11px] text-slate-500">
              完成首个赛季后开始累计；当前同为 0 分，暂按俱乐部声望与实力排序。
            </p>
          )}
        </section>
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
            <RecordDetail emoji="🏆" title="最高赛季积分" team={funRecords.mostPoints.teamName} detail={`S${funRecords.mostPoints.seasonNumber} · ${funRecords.mostPoints.leaguePoints}分`} teamId={funRecords.mostPoints.teamId} color={world.teamBases[funRecords.mostPoints.teamId]?.color} />
            <RecordDetail emoji="⚽" title="单赛季最多进球" team={funRecords.mostGoals.teamName} detail={`S${funRecords.mostGoals.seasonNumber} · ${funRecords.mostGoals.leagueGF}球`} teamId={funRecords.mostGoals.teamId} color={world.teamBases[funRecords.mostGoals.teamId]?.color} />
            <RecordDetail emoji="🛡️" title="最佳防守赛季" team={funRecords.bestDefense.teamName} detail={`S${funRecords.bestDefense.seasonNumber} · 仅失${funRecords.bestDefense.leagueGA}球`} teamId={funRecords.bestDefense.teamId} color={world.teamBases[funRecords.bestDefense.teamId]?.color} />
            <RecordDetail emoji="💪" title="单赛季最多胜场" team={funRecords.mostWins.teamName} detail={`S${funRecords.mostWins.seasonNumber} · ${funRecords.mostWins.leagueWon}胜`} teamId={funRecords.mostWins.teamId} color={world.teamBases[funRecords.mostWins.teamId]?.color} />
            <RecordDetail emoji="😢" title="最低赛季积分" team={funRecords.fewestPoints.teamName} detail={`S${funRecords.fewestPoints.seasonNumber} · ${funRecords.fewestPoints.leaguePoints}分`} teamId={funRecords.fewestPoints.teamId} color={world.teamBases[funRecords.fewestPoints.teamId]?.color} />
            <RecordDetail emoji="💀" title="单赛季最多败场" team={funRecords.mostLosses.teamName} detail={`S${funRecords.mostLosses.seasonNumber} · ${funRecords.mostLosses.leagueLost}负`} teamId={funRecords.mostLosses.teamId} color={world.teamBases[funRecords.mostLosses.teamId]?.color} />
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

      {/* ═══ Tab: 荣誉殿堂 ═══ */}
      {tab === 'hall' && honors.length > 0 && (
        <div className="space-y-5">
          {/* Competition Kings */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">赛事之王</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(() => {
                const countByType = (type: string) => {
                  const counts: Record<string, number> = {};
                  for (const [tid, trophies] of Object.entries(world.teamTrophies)) {
                    const c = trophies.filter(t => t.type === type).length;
                    if (c > 0) counts[tid] = c;
                  }
                  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
                  return sorted[0] ?? null;
                };
                const kings = [
                  { type: 'league1', label: '联赛之王', emoji: '🏟️' },
                  { type: 'league_cup', label: '联赛杯之王', emoji: '🏆' },
                  { type: 'super_cup', label: '超级杯之王', emoji: '⭐' },
                  { type: 'world_cup', label: '环球杯之王', emoji: '🌍' },
                  { type: 'mainland_cup', label: '大陆杯之王', emoji: '🟧' },
                  { type: 'southern_cup', label: '南洲杯之王', emoji: '🟦' },
                  { type: 'eastern_cup', label: '东洲杯之王', emoji: '🟪' },
                ];
                return kings.map(k => {
                  const top = countByType(k.type);
                  if (!top) return (
                    <div key={k.type} className="bg-slate-700/30 rounded-lg p-3 text-center">
                      <div className="text-lg">{k.emoji}</div>
                      <div className="text-[10px] text-slate-500 mt-1">{k.label}</div>
                      <div className="text-xs text-slate-600 mt-1">暂无</div>
                    </div>
                  );
                  return (
                    <div key={k.type} className="bg-slate-700/30 rounded-lg p-3 text-center">
                      <div className="text-lg">{k.emoji}</div>
                      <div className="text-[10px] text-slate-500 mt-1">{k.label}</div>
                      <Link to={`/team/${top[0]}`} className="text-xs text-slate-200 font-bold mt-1 block hover:text-blue-400">{getTeamName(top[0], world.teamBases)}</Link>
                      <div className="text-sm font-black text-amber-400 mt-0.5">{top[1]}冠</div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {/* Record Wall */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">纪录墙</h3>
            <div className="space-y-2">
              {(() => {
                const records: { icon: string; label: string; team: string; teamId: string; detail: string }[] = [];
                const allRecords = Object.entries(world.teamSeasonRecords);

                // Never relegated
                const neverRelegated = allRecords.filter(([, recs]) => recs.length >= 2 && recs.every(r => !r.relegated)).map(([tid]) => tid);
                if (neverRelegated.length > 0 && neverRelegated.length <= 8) {
                  records.push({ icon: '🌲', label: '常青树（从未降级）', team: neverRelegated.map(id => getTeamName(id, world.teamBases)).join('、'), teamId: neverRelegated[0], detail: '' });
                }

                // Most times relegated
                const relegCounts = allRecords.map(([tid, recs]) => ({ tid, count: recs.filter(r => r.relegated).length })).filter(x => x.count > 0).sort((a, b) => b.count - a.count);
                if (relegCounts[0]) {
                  records.push({ icon: '🛗', label: '最多降级', team: getTeamName(relegCounts[0].tid, world.teamBases), teamId: relegCounts[0].tid, detail: `${relegCounts[0].count}次` });
                }

                // Most times promoted
                const promoCounts = allRecords.map(([tid, recs]) => ({ tid, count: recs.filter(r => r.promoted).length })).filter(x => x.count > 0).sort((a, b) => b.count - a.count);
                if (promoCounts[0]) {
                  records.push({ icon: '🚀', label: '最多升级', team: getTeamName(promoCounts[0].tid, world.teamBases), teamId: promoCounts[0].tid, detail: `${promoCounts[0].count}次` });
                }

                // Elevator team (most combined prom+releg)
                const elevatorCounts = allRecords.map(([tid, recs]) => ({ tid, count: recs.filter(r => r.promoted || r.relegated).length })).sort((a, b) => b.count - a.count);
                if (elevatorCounts[0] && elevatorCounts[0].count >= 3) {
                  records.push({ icon: '🎢', label: '电梯队', team: getTeamName(elevatorCounts[0].tid, world.teamBases), teamId: elevatorCounts[0].tid, detail: `${elevatorCounts[0].count}次升降级` });
                }

                // Never won L1
                const l1Winners = new Set(honors.map(h => h.league1Champion));
                const l1Teams = allRecords.filter(([, recs]) => recs.some(r => r.leagueLevel === 1)).map(([tid]) => tid);
                const neverWon = l1Teams.filter(id => !l1Winners.has(id));
                if (neverWon.length > 0 && neverWon.length <= 6) {
                  records.push({ icon: '😤', label: '无冕之王（顶级联赛从未夺冠）', team: neverWon.map(id => getTeamName(id, world.teamBases)).join('、'), teamId: neverWon[0], detail: '' });
                }

                return records.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 bg-slate-700/20 rounded-lg p-3">
                    <span className="text-xl shrink-0">{r.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-slate-500">{r.label}</div>
                      <div className="text-xs text-slate-200 font-medium mt-0.5 truncate">{r.team}</div>
                    </div>
                    {r.detail && <span className="text-xs text-amber-400 font-bold shrink-0">{r.detail}</span>}
                  </div>
                ));
              })()}
            </div>
          </div>

          {/* Coach Records */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">教练纪录</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(() => {
                const coachCards: { icon: string; label: string; name: string; coachId: string; detail: string }[] = [];

                // Longest tenure at one club
                let longestTenure = { coachId: '', teamName: '', seasons: 0 };
                for (const [cid, career] of Object.entries(world.coachCareers)) {
                  for (const entry of career) {
                    const len = (entry.toSeason ?? world.seasonState.seasonNumber) - entry.fromSeason + 1;
                    if (len > longestTenure.seasons) {
                      longestTenure = { coachId: cid, teamName: entry.teamName, seasons: len };
                    }
                  }
                }
                if (longestTenure.seasons > 0) {
                  coachCards.push({ icon: '🏠', label: '最长单队执教', name: getCoachName(longestTenure.coachId, world.coachBases), coachId: longestTenure.coachId, detail: `${longestTenure.teamName} ${longestTenure.seasons}季` });
                }

                // Most times fired
                let mostFired = { coachId: '', count: 0 };
                for (const [cid, career] of Object.entries(world.coachCareers)) {
                  const fireCount = career.filter(e => e.fired).length;
                  if (fireCount > mostFired.count) mostFired = { coachId: cid, count: fireCount };
                }
                if (mostFired.count > 0) {
                  coachCards.push({ icon: '🚪', label: '最多被解雇', name: getCoachName(mostFired.coachId, world.coachBases), coachId: mostFired.coachId, detail: `${mostFired.count}次` });
                }

                // Most teams managed
                let mostTeams = { coachId: '', count: 0 };
                for (const [cid, career] of Object.entries(world.coachCareers)) {
                  const teamCount = new Set(career.map(e => e.teamId)).size;
                  if (teamCount > mostTeams.count) mostTeams = { coachId: cid, count: teamCount };
                }
                if (mostTeams.count > 1) {
                  coachCards.push({ icon: '🧳', label: '最多执教球队', name: getCoachName(mostTeams.coachId, world.coachBases), coachId: mostTeams.coachId, detail: `${mostTeams.count}支` });
                }

                return coachCards.map((c, i) => (
                  <Link key={i} to={`/coach/${c.coachId}`} className="bg-slate-700/20 rounded-lg p-3 hover:bg-slate-700/40 transition-colors block">
                    <div className="text-center">
                      <div className="text-xl">{c.icon}</div>
                      <div className="text-[10px] text-slate-500 mt-1">{c.label}</div>
                      <div className="text-xs text-slate-200 font-bold mt-1">{c.name}</div>
                      <div className="text-[10px] text-amber-400 mt-0.5">{c.detail}</div>
                    </div>
                  </Link>
                ));
              })()}
            </div>
          </div>

          {/* Continental Power Rankings */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">大洲对抗</h3>
            {(() => {
              const continents: Record<string, { teams: string[]; trophies: number; avgOvr: number; l1Count: number; wins: number; losses: number }> = {};
              for (const [tid, base] of Object.entries(world.teamBases)) {
                const cont = base.region?.split('+')[0] ?? '未知';
                if (!continents[cont]) continents[cont] = { teams: [], trophies: 0, avgOvr: 0, l1Count: 0, wins: 0, losses: 0 };
                continents[cont].teams.push(tid);
                continents[cont].trophies += (world.teamTrophies[tid] ?? []).length;
                continents[cont].avgOvr += base.overall;
                if (world.teamStates[tid]?.leagueLevel === 1) continents[cont].l1Count++;
              }
              for (const c of Object.values(continents)) {
                c.avgOvr = c.teams.length > 0 ? Math.round(c.avgOvr / c.teams.length) : 0;
              }
              for (const m of (world.matchHistory ?? [])) {
                const hCont = world.teamBases[m.homeId]?.region?.split('+')[0];
                const aCont = world.teamBases[m.awayId]?.region?.split('+')[0];
                if (!hCont || !aCont || hCont === aCont) continue;
                if (m.homeGoals > m.awayGoals) {
                  if (continents[hCont]) continents[hCont].wins++;
                  if (continents[aCont]) continents[aCont].losses++;
                } else if (m.awayGoals > m.homeGoals) {
                  if (continents[aCont]) continents[aCont].wins++;
                  if (continents[hCont]) continents[hCont].losses++;
                }
              }
              const contColors: Record<string, string> = { '大陆': 'border-amber-600/40', '南洲': 'border-teal-600/40', '东洲': 'border-rose-600/40' };
              const sorted = Object.entries(continents).sort((a, b) => b[1].trophies - a[1].trophies);
              return (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {sorted.map(([name, data]) => {
                    const total = data.wins + data.losses;
                    const winRate = total > 0 ? Math.round((data.wins / total) * 100) : 0;
                    return (
                      <div key={name} className={`bg-slate-700/20 rounded-lg p-3 border ${contColors[name] ?? 'border-slate-600/40'}`}>
                        <div className="text-sm font-bold text-slate-200 text-center mb-2">{name}</div>
                        <div className="grid grid-cols-2 gap-1 text-[10px]">
                          <span className="text-slate-500">球队数</span>
                          <span className="text-slate-300 text-right">{data.teams.length}</span>
                          <span className="text-slate-500">平均OVR</span>
                          <span className="text-slate-300 text-right">{data.avgOvr}</span>
                          <span className="text-slate-500">顶级联赛</span>
                          <span className="text-slate-300 text-right">{data.l1Count}队</span>
                          <span className="text-slate-500">总奖杯</span>
                          <span className="text-amber-400 text-right font-bold">{data.trophies}</span>
                          <span className="text-slate-500">跨洲胜率</span>
                          <span className={`text-right font-bold ${winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{total > 0 ? `${winRate}%` : '-'}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      )}
      {tab === 'hall' && honors.length === 0 && (
        <p className="text-sm text-slate-500">完成至少一个赛季后显示荣誉殿堂</p>
      )}

      {/* ═══ Tab: 名帅殿堂 ═══ */}
      {tab === 'coaches' && (
        <div className="space-y-2">
          {coachStats.filter(cs => cs && (cs.trophies > 0 || cs.totalSeasons > 1)).map((cs) => {
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
          {coachStats.every(cs => !cs || (cs.trophies === 0 && cs.totalSeasons <= 1)) && (
            <p className="py-8 text-center text-sm text-slate-500">完成更多赛季后，具有代表性履历的教练会进入名帅殿堂。</p>
          )}
        </div>
      )}
    </PageShell>
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

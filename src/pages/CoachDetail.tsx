import { useParams, Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { getTeamName, getCoachStyleLabel, getTrophyLabel } from '../utils/format';
import { computeCoachRivalries } from '../engine/coaches/coach-rivalries';

export default function CoachDetail() {
  const { id } = useParams<{ id: string }>();
  const world = useGameStore((s) => s.world);

  if (!world || !id) return <div className="text-slate-400">正在加载...</div>;

  const base = world.coachBases[id];
  const state = world.coachStates[id];
  const career = world.coachCareers[id] ?? [];
  const trophies = world.coachTrophies[id] ?? [];

  if (!base || !state) return <div className="text-slate-400">未找到教练: {id}</div>;

  const team = state.currentTeamId ? world.teamBases[state.currentTeamId] : null;
  const teamState = state.currentTeamId ? world.teamStates[state.currentTeamId] : null;
  const pressure = teamState?.coachPressure ?? 0;

  const ratingTier = base.rating >= 85 ? 'from-amber-600 to-amber-500' : base.rating >= 70 ? 'from-blue-600 to-blue-500' : 'from-slate-600 to-slate-500';

  const styleColor: Record<string, string> = {
    attacking: 'text-red-400 bg-red-900/30',
    defensive: 'text-blue-400 bg-blue-900/30',
    balanced: 'text-slate-300 bg-slate-700/60',
    possession: 'text-emerald-400 bg-emerald-900/30',
    counter: 'text-amber-400 bg-amber-900/30',
  };

  // Buff items
  const buffs = [
    { label: '进攻', value: base.attackBuff, desc: '影响球队进攻能力' },
    { label: '防守', value: base.defenseBuff, desc: '影响球队防守能力' },
    { label: '士气', value: base.moraleBuff, desc: '影响球队士气恢复' },
    { label: '联赛', value: base.leagueBuff, desc: '联赛比赛加成' },
    { label: '杯赛', value: base.cupBuff, desc: '杯赛比赛加成' },
    { label: '稳定', value: base.stabilityBuff, desc: '影响球队发挥稳定性' },
  ];

  return (
    <div className="max-w-3xl space-y-5">
      {/* Header card */}
      <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-5">
        <div className="flex items-start gap-4">
          <div className={`w-16 h-16 bg-gradient-to-br ${ratingTier} rounded-xl flex items-center justify-center shrink-0`}>
            <span className="text-white font-black text-2xl">{base.rating}</span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-bold text-slate-100">{base.name}</h2>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded ${styleColor[base.style] ?? ''}`}>
                {getCoachStyleLabel(base.style)}
              </span>
              {state.isUnemployed ? (
                <span className="text-xs px-2 py-0.5 rounded bg-red-900/40 text-red-400">
                  待业{state.unemployedSince != null ? ` (自S${state.unemployedSince})` : ''}
                </span>
              ) : team ? (
                <Link to={`/team/${state.currentTeamId}`} className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: team.color }} />
                  {team.name}
                </Link>
              ) : null}
              {trophies.length > 0 && (
                <span className="text-xs text-amber-400">{trophies.length} 座奖杯</span>
              )}
              {!state.isUnemployed && state.contractEnd && (
                <span className="text-xs text-slate-500">
                  合同至S{state.contractEnd} ({state.contractEnd - world.seasonState.seasonNumber > 0 ? `剩${state.contractEnd - world.seasonState.seasonNumber}季` : '到期'})
                </span>
              )}
            </div>
          </div>
          {/* Pressure gauge */}
          {teamState && (
            <div className="text-center shrink-0">
              <div className={`text-2xl font-bold ${pressure > 60 ? 'text-red-400' : pressure > 35 ? 'text-amber-400' : 'text-green-400'}`}>
                {pressure}
              </div>
              <div className="text-[10px] text-slate-500">教练压力</div>
              <div className="w-16 h-1.5 bg-slate-700 rounded-full mt-1 overflow-hidden">
                <div
                  className={`h-full rounded-full ${pressure > 60 ? 'bg-red-500' : pressure > 35 ? 'bg-amber-500' : 'bg-green-500'}`}
                  style={{ width: `${pressure}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Coaching stats */}
      {(() => {
        // Aggregate stats from all season records where this coach managed
        const allRecords = Object.entries(world.teamSeasonRecords).flatMap(([tid, recs]) =>
          recs.filter(r => r.coachId === id).map(r => ({ ...r, teamId: tid }))
        );
        if (allRecords.length === 0) return null;
        const totalW = allRecords.reduce((s, r) => s + r.leagueWon, 0);
        const totalD = allRecords.reduce((s, r) => s + r.leagueDrawn, 0);
        const totalL = allRecords.reduce((s, r) => s + r.leagueLost, 0);
        const totalP = allRecords.reduce((s, r) => s + r.leaguePlayed, 0);
        const totalPts = allRecords.reduce((s, r) => s + r.leaguePoints, 0);
        const winRate = totalP > 0 ? ((totalW / totalP) * 100).toFixed(1) : '0';
        const avgPts = allRecords.length > 0 ? (totalPts / allRecords.length).toFixed(1) : '0';
        const best = allRecords.reduce((b, r) => r.leaguePosition < b.leaguePosition ? r : b, allRecords[0]);
        const championships = allRecords.filter(r => r.leaguePosition === 1).length;

        return (
          <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">执教数据</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="text-center">
                <div className="text-lg font-bold text-slate-100">{allRecords.length}</div>
                <div className="text-[10px] text-slate-500">执教赛季</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-green-400">{winRate}%</div>
                <div className="text-[10px] text-slate-500">胜率 ({totalW}胜{totalD}平{totalL}负)</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-blue-400">{avgPts}</div>
                <div className="text-[10px] text-slate-500">赛季场均积分</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-amber-400">{championships}</div>
                <div className="text-[10px] text-slate-500">联赛冠军</div>
              </div>
            </div>
            {best && (
              <div className="mt-2 text-[10px] text-slate-500 text-center">
                最佳赛季: S{best.seasonNumber} {world.teamBases[best.teamId]?.name} 第{best.leaguePosition}名 ({best.leaguePoints}分)
              </div>
            )}
          </div>
        );
      })()}

      {/* Buff grid + meta */}
      <div className="grid grid-cols-2 gap-4">
        {/* Buffs */}
        <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">教练加成</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {buffs.map((b) => (
              <div key={b.label} className="bg-slate-700/30 rounded-lg p-2 text-center">
                <div className="text-[10px] text-slate-500">{b.label}</div>
                <div className={`text-lg font-bold ${b.value > 0 ? 'text-green-400' : b.value < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                  {b.value > 0 ? '+' : ''}{b.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Special traits */}
        <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">特质</h3>
          <div className="space-y-2.5">
            <TraitBar label="抗压能力" value={base.pressureResistance} max={100} />
            <TraitBar label="冒险倾向" value={base.riskBias + 10} max={20} bipolar />
            <TraitBar label="稳定性" value={base.stabilityBuff + 5} max={15} />
          </div>
        </div>
      </div>

      {/* Trophies */}
      {trophies.length > 0 && (
        <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            奖杯柜 ({trophies.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {trophies.map((t, i) => (
              <span key={i} className="text-xs bg-amber-900/40 text-amber-300 px-2 py-1 rounded-lg">
                {getTrophyLabel(t.type)} · S{t.seasonNumber}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Tactical Analytics */}
      {career.length > 0 && (() => {
        const totalSeasons = career.reduce((s, c) => s + ((c.toSeason ?? world.seasonState.seasonNumber) - c.fromSeason + 1), 0);
        const teamCount = new Set(career.map(c => c.teamId)).size;
        const avgTenure = teamCount > 0 ? (totalSeasons / teamCount).toFixed(1) : '0';
        const firedCount = career.filter(c => c.fired).length;
        const completedTenures = career.filter(c => c.toSeason !== null).length;
        const fireRate = completedTenures > 0 ? Math.round((firedCount / completedTenures) * 100) : 0;

        // Trophy preference
        const trophyByType: Record<string, number> = {};
        for (const t of trophies) {
          trophyByType[t.type] = (trophyByType[t.type] ?? 0) + 1;
        }
        const leagueTrophies = (trophyByType['league1'] ?? 0) + (trophyByType['league2'] ?? 0) + (trophyByType['league3'] ?? 0);
        const cupTrophies = (trophyByType['league_cup'] ?? 0) + (trophyByType['super_cup'] ?? 0) + (trophyByType['world_cup'] ?? 0);
        let preference = '执教经历尚浅';
        if (trophies.length >= 3) {
          if (cupTrophies > leagueTrophies * 1.5) preference = '杯赛专精';
          else if (leagueTrophies > cupTrophies * 1.5) preference = '联赛之王';
          else preference = '全能型';
        } else if (trophies.length >= 1) {
          preference = '初露锋芒';
        }

        // Stints with team OVR change
        const stintImpacts = career.filter(c => c.toSeason !== null).map(c => {
          const recs = (world.teamSeasonRecords[c.teamId] ?? []).filter(r => r.seasonNumber >= c.fromSeason && r.seasonNumber <= (c.toSeason ?? c.fromSeason));
          if (recs.length < 2) return null;
          const ovrStart = recs[0].teamOverall ?? 0;
          const ovrEnd = recs[recs.length - 1].teamOverall ?? 0;
          return { teamName: c.teamName, delta: ovrEnd - ovrStart };
        }).filter(Boolean) as { teamName: string; delta: number }[];

        return (
          <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">执教分析</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <div className="text-center">
                <div className={`text-base font-bold ${preference === '杯赛专精' ? 'text-purple-400' : preference === '联赛之王' ? 'text-amber-400' : preference === '全能型' ? 'text-emerald-400' : 'text-slate-400'}`}>{preference}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">赛事偏好</div>
              </div>
              <div className="text-center">
                <div className="text-base font-bold text-slate-200">{avgTenure}季</div>
                <div className="text-[10px] text-slate-500 mt-0.5">单队平均执教</div>
              </div>
              <div className="text-center">
                <div className={`text-base font-bold ${fireRate > 60 ? 'text-red-400' : fireRate > 30 ? 'text-orange-400' : 'text-emerald-400'}`}>{fireRate}%</div>
                <div className="text-[10px] text-slate-500 mt-0.5">解雇率</div>
              </div>
              <div className="text-center">
                <div className="text-base font-bold text-slate-200">{leagueTrophies}/{cupTrophies}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">联赛/杯赛</div>
              </div>
            </div>
            {stintImpacts.length > 0 && (
              <div className="border-t border-slate-700/40 pt-3">
                <div className="text-[10px] text-slate-500 mb-2">球队OVR带队变化</div>
                <div className="space-y-1">
                  {stintImpacts.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="text-slate-300 flex-1 truncate">{s.teamName}</span>
                      <span className={`font-bold tabular-nums ${s.delta > 0 ? 'text-emerald-400' : s.delta < 0 ? 'text-red-400' : 'text-slate-500'}`}>
                        {s.delta > 0 ? `+${s.delta}` : s.delta} OVR
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Coach rivalries */}
      {(() => {
        const rivalries = computeCoachRivalries(world, id, 5);
        if (rivalries.length === 0) return null;
        return (
          <div className="bg-slate-800 rounded-xl border border-slate-700/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-700/60 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                宿敌录
              </h3>
              <span className="text-[10px] text-slate-500">最常对话的 {rivalries.length} 位教练</span>
            </div>
            <div className="divide-y divide-slate-700/40">
              {rivalries.map((r) => (
                <div key={r.opponentCoachId} className="px-4 py-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Link to={`/coach/${r.opponentCoachId}`} className="text-sm font-medium text-slate-100 hover:text-blue-300">
                      {r.opponentName}
                    </Link>
                    {r.isRival && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/30 text-red-300 font-semibold">
                        宿敌
                      </span>
                    )}
                    <span className="text-[10px] text-slate-500 ml-auto">
                      共 {r.meetings} 次交手
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <div className="bg-slate-900/40 rounded p-1.5">
                      <div className="text-emerald-400 font-bold">{r.wins}</div>
                      <div className="text-[9px] text-slate-500">胜</div>
                    </div>
                    <div className="bg-slate-900/40 rounded p-1.5">
                      <div className="text-slate-300 font-bold">{r.draws}</div>
                      <div className="text-[9px] text-slate-500">平</div>
                    </div>
                    <div className="bg-slate-900/40 rounded p-1.5">
                      <div className="text-red-400 font-bold">{r.losses}</div>
                      <div className="text-[9px] text-slate-500">负</div>
                    </div>
                    <div className="bg-slate-900/40 rounded p-1.5">
                      <div className="text-slate-300 font-bold">{r.goalsFor}-{r.goalsAgainst}</div>
                      <div className="text-[9px] text-slate-500">进/失</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Career history */}
      {career.length > 0 && (
        <div className="bg-slate-800 rounded-xl border border-slate-700/60 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700/60">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              执教履历 ({career.length} 段)
            </h3>
          </div>
          <div className="divide-y divide-slate-700/40">
            {career.map((entry, i) => {
              const entryTeam = world.teamBases[entry.teamId];
              return (
                <div key={i} className="px-4 py-3 flex items-center gap-3">
                  {entryTeam && (
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: entryTeam.color }} />
                  )}
                  <div className="flex-1 min-w-0">
                    <Link to={`/team/${entry.teamId}`} className="text-sm text-slate-200 hover:text-blue-400">
                      {entry.teamName}
                    </Link>
                    <p className="text-[11px] text-slate-500">
                      S{entry.fromSeason}{entry.toSeason !== null ? ` - S${entry.toSeason}` : ' - 至今'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {entry.fired && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-400">解雇</span>
                    )}
                    {entry.trophies.length > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300">
                        {entry.trophies.length} 冠
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function TraitBar({ label, value, max, bipolar }: { label: string; value: number; max: number; bipolar?: boolean }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color = bipolar
    ? (value > max / 2 + 2 ? 'bg-red-500' : value < max / 2 - 2 ? 'bg-blue-500' : 'bg-slate-400')
    : (pct > 70 ? 'bg-green-500' : pct > 40 ? 'bg-amber-500' : 'bg-red-500');

  return (
    <div>
      <div className="flex justify-between text-[11px] mb-0.5">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-300">{bipolar ? value - max / 2 : value}</span>
      </div>
      <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

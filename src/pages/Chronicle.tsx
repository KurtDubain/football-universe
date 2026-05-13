import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { getTeamName, getCoachName } from '../utils/format';
import type { GameWorld } from '../engine/season/season-manager';

export default function Chronicle() {
  const world = useGameStore((s) => s.world);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [mode, setMode] = useState<'overview' | 'narrative'>('overview');

  if (!world) return <div className="text-slate-400">正在加载...</div>;

  const honors = world.honorHistory;
  if (honors.length === 0) {
    return (
      <div className="max-w-4xl">
        <h2 className="text-xl font-bold text-slate-100 mb-4">编年史</h2>
        <p className="text-sm text-slate-500">完成至少一个赛季后显示</p>
      </div>
    );
  }

  if (selectedSeason !== null) {
    return <SeasonDetail world={world} seasonNumber={selectedSeason} onBack={() => setSelectedSeason(null)} />;
  }

  return (
    <div className="space-y-4">
      {/* Mode tabs */}
      <div className="flex gap-1 max-w-4xl">
        <button onClick={() => setMode('overview')}
          className={`px-3 py-1.5 text-xs rounded-lg cursor-pointer transition-colors ${mode === 'overview' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}>
          总览
        </button>
        <button onClick={() => setMode('narrative')}
          className={`px-3 py-1.5 text-xs rounded-lg cursor-pointer transition-colors ${mode === 'narrative' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}>
          全赛季叙事
        </button>
      </div>

      {mode === 'overview'
        ? <OverallChronicle world={world} onSelectSeason={setSelectedSeason} />
        : <AllSeasonsNarrative world={world} onSelectSeason={setSelectedSeason} />}
    </div>
  );
}

function OverallChronicle({ world, onSelectSeason }: { world: GameWorld; onSelectSeason: (s: number) => void }) {
  const honors = world.honorHistory;
  const tb = world.teamBases;

  // Champion timeline
  const champTimeline = honors.map(h => ({
    season: h.seasonNumber,
    champion: h.league1Champion,
    name: getTeamName(h.league1Champion, tb),
    color: (tb[h.league1Champion] as any)?.color ?? '#666',
    cups: [h.leagueCupWinner, h.superCupWinner, h.worldCupWinner].filter(Boolean).length,
    worldCup: !!h.worldCupWinner,
  }));

  // Dynasty detection (consecutive wins by same team)
  const dynasties: { team: string; name: string; from: number; to: number; count: number; color: string }[] = [];
  let curTeam = '', curFrom = 0, curCount = 0;
  for (const c of champTimeline) {
    if (c.champion === curTeam) {
      curCount++;
    } else {
      if (curCount >= 2) dynasties.push({ team: curTeam, name: getTeamName(curTeam, tb), from: curFrom, to: c.season - 1, count: curCount, color: (tb[curTeam] as any)?.color ?? '#666' });
      curTeam = c.champion;
      curFrom = c.season;
      curCount = 1;
    }
  }
  if (curCount >= 2) dynasties.push({ team: curTeam, name: getTeamName(curTeam, tb), from: curFrom, to: honors[honors.length - 1].seasonNumber, count: curCount, color: (tb[curTeam] as any)?.color ?? '#666' });

  // OVR evolution for top 5 teams (by total trophies)
  const topTeams = Object.entries(world.teamTrophies)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5)
    .map(([tid]) => tid);

  const ovrHistory = useMemo(() => {
    const data: Record<string, { season: number; ovr: number }[]> = {};
    for (const tid of topTeams) {
      data[tid] = (world.teamSeasonRecords[tid] ?? []).map(r => ({ season: r.seasonNumber, ovr: r.teamOverall ?? 0 }));
    }
    return data;
  }, [world.teamSeasonRecords, topTeams]);

  // All-time stats
  const totalSeasons = honors.length;
  const uniqueChampions = new Set(honors.map(h => h.league1Champion)).size;
  const totalCoachChanges = honors.reduce((s, h) => s + h.coachChanges.length, 0);
  const totalPromotions = honors.reduce((s, h) => s + h.promoted.length, 0);

  return (
    <div className="max-w-4xl space-y-5">
      <h2 className="text-xl font-bold text-slate-100">编年史</h2>

      {/* All-time stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-3 text-center">
          <div className="text-2xl font-black text-slate-100">{totalSeasons}</div>
          <div className="text-[10px] text-slate-500">总赛季</div>
        </div>
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-3 text-center">
          <div className="text-2xl font-black text-amber-400">{uniqueChampions}</div>
          <div className="text-[10px] text-slate-500">不同冠军</div>
        </div>
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-3 text-center">
          <div className="text-2xl font-black text-slate-100">{totalCoachChanges}</div>
          <div className="text-[10px] text-slate-500">总换帅</div>
        </div>
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-3 text-center">
          <div className="text-2xl font-black text-emerald-400">{totalPromotions}</div>
          <div className="text-[10px] text-slate-500">总升级次数</div>
        </div>
      </div>

      {/* Dynasties */}
      {dynasties.length > 0 && (
        <div className="bg-amber-900/15 rounded-xl border border-amber-700/30 p-4">
          <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-2">王朝</h3>
          <div className="space-y-1.5">
            {dynasties.map((d, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                <span className="text-slate-200 font-semibold">{d.name}</span>
                <span className="text-amber-400 font-bold">{d.count}连冠</span>
                <span className="text-slate-500">S{d.from}-S{d.to}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Champion Timeline */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700/60">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">冠军更迭</h3>
        </div>
        <div className="divide-y divide-slate-700/30">
          {champTimeline.map(c => (
            <button key={c.season} onClick={() => onSelectSeason(c.season)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-700/30 transition-colors cursor-pointer text-left">
              <span className="text-xs text-slate-500 w-8 shrink-0">S{c.season}</span>
              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
              <span className="text-sm text-slate-200 font-medium flex-1">{c.name}</span>
              {c.cups >= 2 && <span className="text-[11px] sm:text-[9px] bg-amber-900/40 text-amber-400 px-1.5 py-0.5 rounded">{c.cups}冠</span>}
              {c.worldCup && <span className="text-[11px] sm:text-[9px] bg-sky-900/40 text-sky-400 px-1.5 py-0.5 rounded">WC</span>}
              <span className="text-slate-600 text-xs">→</span>
            </button>
          ))}
        </div>
      </div>

      {/* OVR Evolution */}
      {topTeams.length > 0 && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">豪门OVR变迁</h3>
          <div className="space-y-2">
            {topTeams.map(tid => {
              const history = ovrHistory[tid] ?? [];
              if (history.length === 0) return null;
              const team = tb[tid];
              const current = team?.overall ?? 0;
              const initial = history[0]?.ovr ?? current;
              const diff = current - initial;
              return (
                <div key={tid} className="flex items-center gap-2 text-xs">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: (team as any)?.color ?? '#666' }} />
                  <Link to={`/team/${tid}`} className="text-slate-200 hover:text-blue-400 w-20 truncate">{getTeamName(tid, tb)}</Link>
                  <span className="text-slate-500">{initial}</span>
                  <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, (current / 97) * 100)}%`, backgroundColor: (team as any)?.color ?? '#666' }} />
                  </div>
                  <span className="text-slate-200 font-bold w-6 text-right">{current}</span>
                  <span className={`w-8 text-right ${diff > 0 ? 'text-emerald-400' : diff < 0 ? 'text-red-400' : 'text-slate-500'}`}>
                    {diff > 0 ? `+${diff}` : diff}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SeasonDetail({ world, seasonNumber, onBack }: { world: GameWorld; seasonNumber: number; onBack: () => void }) {
  const honor = world.honorHistory.find(h => h.seasonNumber === seasonNumber);
  const tb = world.teamBases;

  if (!honor) {
    return (
      <div className="max-w-4xl">
        <button onClick={onBack} className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer mb-3">← 返回编年史</button>
        <p className="text-sm text-slate-500">未找到该赛季数据</p>
      </div>
    );
  }

  const seasonRecords = Object.entries(world.teamSeasonRecords)
    .map(([teamId, recs]) => {
      const rec = recs.find(r => r.seasonNumber === seasonNumber);
      return rec ? { ...rec, teamId } : null;
    })
    .filter(Boolean) as (typeof world.teamSeasonRecords[string][number] & { teamId: string })[];

  const l1 = seasonRecords.filter(r => r.leagueLevel === 1).sort((a, b) => a.leaguePosition - b.leaguePosition);
  const l2 = seasonRecords.filter(r => r.leagueLevel === 2).sort((a, b) => a.leaguePosition - b.leaguePosition);
  const l3 = seasonRecords.filter(r => r.leagueLevel === 3).sort((a, b) => a.leaguePosition - b.leaguePosition);

  // Match history for this season
  const seasonMatches = (world.matchHistory ?? []).filter(m => m.season === seasonNumber);
  const totalGoals = seasonMatches.reduce((s, m) => s + m.homeGoals + m.awayGoals, 0);
  const avgGoals = seasonMatches.length > 0 ? (totalGoals / seasonMatches.length).toFixed(2) : '0';

  // Best stats from records
  const allRecs = [...l1, ...l2, ...l3];
  const bestAttack = allRecs.length > 0 ? allRecs.reduce((b, r) => r.leagueGF > b.leagueGF ? r : b) : null;
  const bestDefense = allRecs.length > 0 ? allRecs.filter(r => r.leaguePlayed > 5).reduce((b, r) => r.leagueGA < b.leagueGA ? r : b, allRecs[0]) : null;
  const mostWins = l1.length > 0 ? l1.reduce((b, r) => r.leagueWon > b.leagueWon ? r : b) : null;
  const mostLosses = l1.length > 0 ? l1.reduce((b, r) => r.leagueLost > b.leagueLost ? r : b) : null;

  // Biggest blowout from match history
  const blowouts = [...seasonMatches]
    .map(m => ({ ...m, diff: Math.abs(m.homeGoals - m.awayGoals) }))
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 3);

  // Highest scoring match
  const highScoring = [...seasonMatches]
    .map(m => ({ ...m, total: m.homeGoals + m.awayGoals }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);

  // Continental performance this season
  const contStats: Record<string, { wins: number; losses: number; goals: number }> = {};
  for (const m of seasonMatches) {
    const hCont = tb[m.homeId]?.region?.split('+')[0];
    const aCont = tb[m.awayId]?.region?.split('+')[0];
    if (!hCont || !aCont || hCont === aCont) continue;
    for (const c of [hCont, aCont]) {
      if (!contStats[c]) contStats[c] = { wins: 0, losses: 0, goals: 0 };
    }
    if (m.homeGoals > m.awayGoals) { contStats[hCont].wins++; contStats[aCont].losses++; }
    else if (m.awayGoals > m.homeGoals) { contStats[aCont].wins++; contStats[hCont].losses++; }
    contStats[hCont].goals += m.homeGoals;
    contStats[aCont].goals += m.awayGoals;
  }

  // Multi-crown detection
  const allWinners = [honor.league1Champion, honor.leagueCupWinner, honor.superCupWinner, honor.worldCupWinner].filter(Boolean);
  const crownCounts = new Map<string, number>();
  for (const w of allWinners) { if (w) crownCounts.set(w, (crownCounts.get(w) ?? 0) + 1); }
  const multiCrown = [...crownCounts.entries()].find(([, c]) => c >= 2);

  // Champion's L1 performance
  const champRec = l1[0];
  const runner = l1[1] ? getTeamName(l1[1].teamId, tb) : '';
  const gap = l1[0] && l1[1] ? l1[0].leaguePoints - l1[1].leaguePoints : 0;
  const champ = getTeamName(honor.league1Champion, tb);

  // Champion's WC tournament details
  const champRegion = tb[honor.league1Champion]?.region;
  const champCont = champRegion?.split('+')[0];

  // Underdog cup winner
  const lcWinner = honor.leagueCupWinner;
  const lcWinnerLevel = lcWinner ? (l1.some(r => r.teamId === lcWinner) ? 1 : l2.some(r => r.teamId === lcWinner) ? 2 : 3) : 0;
  const isUnderdog = lcWinnerLevel >= 2;

  // Get this season's buffs (current or archived)
  const isCurrentSeason = seasonNumber === world.seasonState.seasonNumber;
  const buffs = isCurrentSeason
    ? (world.seasonBuffs ?? [])
    : ((world.seasonBuffsHistory ?? []).find(h => h.season === seasonNumber)?.buffs ?? []);

  // Build narrative — multiple paragraphs
  const paragraphs: string[] = [];

  if (gap >= 10) {
    paragraphs.push(`第${seasonNumber}赛季，${champ}以${gap}分的绝对优势统治联赛，${champRec?.leagueWon}胜${champRec?.leagueDrawn}平${champRec?.leagueLost}负的恐怖战绩没有给任何对手留下幻想的余地。`);
  } else if (gap <= 3 && runner) {
    paragraphs.push(`第${seasonNumber}赛季是一场令人窒息的冠军争夺战。${champ}和${runner}的对决贯穿始终，最终${champ}凭借${gap}分的微弱优势在最后时刻惊险加冕，过程跌宕起伏。`);
  } else {
    paragraphs.push(`第${seasonNumber}赛季，${champ}凭借稳定的发挥以${champRec?.leaguePoints}分拿下联赛冠军，本赛季打入${champRec?.leagueGF}球。`);
  }

  // Buff-driven narrative
  if (buffs.length > 0) {
    const championBuff = buffs.find(b => b.teamId === honor.league1Champion);
    if (championBuff) {
      const isPos = championBuff.effects.some(e => e.delta > 0);
      if (isPos) {
        paragraphs.push(`赛季初的「${championBuff.label}」剧情似乎成为${champ}夺冠的关键催化剂——这股神奇力量贯穿整个赛季，最终化为冠军奖杯。`);
      } else {
        paragraphs.push(`让人惊叹的是，${champ}在赛季初遭遇「${championBuff.label}」的负面剧情，却依然力克所有不利因素登顶——这正是冠军的成色。`);
      }
    }
    // Notable buff stories for non-champions
    const otherBuffs = buffs.filter(b => b.teamId !== honor.league1Champion).slice(0, 1);
    for (const b of otherBuffs) {
      const teamName = getTeamName(b.teamId, tb);
      const teamRec = allRecs.find(r => r.teamId === b.teamId);
      if (!teamRec) continue;
      const isPos = b.effects.some(e => e.delta > 0);
      if (isPos && teamRec.leaguePosition <= 5) {
        paragraphs.push(`${teamName}的「${b.label}」剧情兑现了承诺——他们在赛季中表现出色，最终位列第${teamRec.leaguePosition}位。`);
      } else if (!isPos && teamRec.relegated) {
        paragraphs.push(`「${b.label}」的诅咒最终降临到${teamName}头上——这支球队遭遇了赛季的至暗时刻，最终遗憾降级。`);
      } else if (isPos && teamRec.leaguePosition > 8) {
        paragraphs.push(`尽管赛季初被「${b.label}」眷顾，${teamName}却未能将这份运气转化为成绩，最终位列第${teamRec.leaguePosition}位，令人惋惜。`);
      }
    }
  }

  if (multiCrown) {
    const [tid, count] = multiCrown;
    const crownLabel = count === 4 ? '四冠王' : count === 3 ? '三冠王' : '双冠王';
    if (tid === honor.league1Champion) {
      paragraphs.push(`${champ}不满足于联赛冠军，更包揽多项杯赛荣誉，成就赛季${crownLabel}的伟业。`);
    } else {
      paragraphs.push(`${getTeamName(tid, tb)}虽未夺得联赛冠军，却在杯赛中横扫一切，最终捧得${crownLabel}头衔。`);
    }
  }

  if (isUnderdog && lcWinner) {
    paragraphs.push(`本赛季最大的传奇属于${getTeamName(lcWinner, tb)}——这支来自${lcWinnerLevel === 2 ? '甲级' : '乙级'}联赛的球队竟然杀入联赛杯决赛并最终夺冠，上演了不可思议的黑马奇迹。`);
  }

  if (bestDefense && bestDefense.leagueGA <= 18 && bestDefense.teamId !== honor.league1Champion) {
    paragraphs.push(`防守端，${getTeamName(bestDefense.teamId, tb)}铸就钢铁防线，全赛季仅失${bestDefense.leagueGA}球，令所有对手闻风丧胆。`);
  }

  if (honor.coachChanges.length >= 4) {
    paragraphs.push(`教练席上风波不断，${honor.coachChanges.length}次换帅让人目不暇接，多支球队的赛季因此陷入动荡。`);
  } else if (honor.coachChanges.length >= 1 && honor.coachChanges.length <= 2) {
    paragraphs.push(`教练队伍相对稳定，赛季全程仅发生了${honor.coachChanges.length}次换帅。`);
  }

  if (honor.worldCupWinner) {
    const wcChamp = getTeamName(honor.worldCupWinner, tb);
    const wcCont = tb[honor.worldCupWinner]?.region?.split('+')[0];
    paragraphs.push(`赛季末的环球冠军杯上，${wcChamp}力压群雄登顶，为${wcCont || '所在大洲'}带来了至高荣耀。`);
  }

  if (honor.promoted.length > 0 && honor.relegated.length > 0) {
    paragraphs.push(`赛季末的升降级名单中，${honor.promoted.map(p => getTeamName(p.teamId, tb)).join('、')}带着梦想升入新的舞台，而${honor.relegated.map(r => getTeamName(r.teamId, tb)).join('、')}则未能抵挡降级的命运。`);
  }

  return (
    <div className="max-w-4xl space-y-4">
      <button onClick={onBack} className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer">← 返回编年史</button>

      {/* Header with rich narrative */}
      <div className="py-5 bg-gradient-to-r from-amber-900/20 via-slate-800 to-amber-900/20 rounded-xl border border-amber-700/30 px-4 sm:px-6">
        <h2 className="text-2xl font-black text-slate-100 text-center">第{seasonNumber}赛季</h2>
        <div className="flex justify-center gap-4 mt-1 text-[10px] text-slate-500">
          <span>{seasonMatches.length}场比赛</span>
          <span>{totalGoals}粒进球</span>
          <span>场均{avgGoals}球</span>
          {honor.worldCupWinner && <span className="text-sky-400">⭐ 世界杯年</span>}
        </div>
        <div className="mt-3 max-w-2xl mx-auto space-y-2">
          {paragraphs.map((p, i) => (
            <p key={i} className="text-xs sm:text-sm text-slate-400 leading-relaxed text-center italic">{p}</p>
          ))}
        </div>
      </div>

      {/* Champions */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <ChampCard label="顶级联赛冠军" team={honor.league1Champion} runnerUp={l1[1]?.teamId} tb={tb} color="amber" />
        <ChampCard label="甲级联赛冠军" team={honor.league2Champion} tb={tb} color="blue" />
        <ChampCard label="乙级联赛冠军" team={honor.league3Champion} tb={tb} color="emerald" />
        <ChampCard label="联赛杯" team={honor.leagueCupWinner} tb={tb} color="amber" />
        <ChampCard label="超级杯" team={honor.superCupWinner} tb={tb} color="purple" />
        {honor.worldCupWinner && <ChampCard label="环球冠军杯" team={honor.worldCupWinner} tb={tb} color="sky" />}
      </div>

      {/* Awards Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {bestAttack && (
          <AwardBox emoji="⚽" label="最强火力" team={getTeamName(bestAttack.teamId, tb)} detail={`${bestAttack.leagueGF}球`} color={(tb[bestAttack.teamId] as any)?.color} />
        )}
        {bestDefense && (
          <AwardBox emoji="🛡️" label="最佳防守" team={getTeamName(bestDefense.teamId, tb)} detail={`仅失${bestDefense.leagueGA}球`} color={(tb[bestDefense.teamId] as any)?.color} />
        )}
        {mostWins && (
          <AwardBox emoji="💪" label="最多胜场" team={getTeamName(mostWins.teamId, tb)} detail={`${mostWins.leagueWon}胜`} color={(tb[mostWins.teamId] as any)?.color} />
        )}
        {mostLosses && mostLosses.leagueLost > 0 && (
          <AwardBox emoji="😢" label="最多败场" team={getTeamName(mostLosses.teamId, tb)} detail={`${mostLosses.leagueLost}负`} color={(tb[mostLosses.teamId] as any)?.color} />
        )}
      </div>

      {/* Memorable Matches */}
      {(blowouts.length > 0 || highScoring.length > 0) && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">难忘比赛</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {blowouts[0] && blowouts[0].diff >= 4 && (
              <div className="bg-slate-700/20 rounded-lg p-3">
                <div className="text-[10px] text-slate-500 mb-1">最大分差</div>
                <MemMatch m={blowouts[0]} tb={tb} />
              </div>
            )}
            {highScoring[0] && highScoring[0].total >= 5 && (
              <div className="bg-slate-700/20 rounded-lg p-3">
                <div className="text-[10px] text-slate-500 mb-1">最多进球</div>
                <MemMatch m={highScoring[0]} tb={tb} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Continental Performance */}
      {Object.keys(contStats).length > 1 && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">大洲对抗</h3>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(contStats).map(([cont, data]) => {
              const total = data.wins + data.losses;
              const winRate = total > 0 ? Math.round((data.wins / total) * 100) : 0;
              const isStrong = winRate >= 50;
              return (
                <div key={cont} className={`text-center p-2 rounded-lg ${isStrong ? 'bg-emerald-900/15 border border-emerald-700/30' : 'bg-slate-700/20'}`}>
                  <div className="text-xs font-bold text-slate-300">{cont}</div>
                  <div className="text-[10px] text-slate-500 mt-1">{data.wins}胜 {data.losses}负</div>
                  <div className={`text-[10px] mt-0.5 font-bold ${isStrong ? 'text-emerald-400' : 'text-slate-500'}`}>{total > 0 ? `${winRate}%` : '-'}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* L1 Standings */}
      {l1.length > 0 && (
        <StandingsTable title="顶级联赛积分榜" records={l1} tb={tb} />
      )}

      {/* L2 Standings */}
      {l2.length > 0 && (
        <StandingsTable title="甲级联赛积分榜" records={l2} tb={tb} />
      )}

      {/* L3 Standings */}
      {l3.length > 0 && (
        <StandingsTable title="乙级联赛积分榜" records={l3} tb={tb} />
      )}

      {/* Promotions & Relegations */}
      {(honor.promoted.length > 0 || honor.relegated.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {honor.promoted.length > 0 && (
            <div className="bg-green-900/15 rounded-lg border border-green-800/30 p-3">
              <h4 className="text-[10px] text-green-400 font-semibold mb-1">⬆️ 升级球队</h4>
              {honor.promoted.map(p => (
                <div key={p.teamId} className="flex items-center gap-1.5 text-xs text-slate-300 py-0.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: (tb[p.teamId] as any)?.color ?? '#666' }} />
                  <Link to={`/team/${p.teamId}`} className="hover:text-blue-400">{getTeamName(p.teamId, tb)}</Link>
                  <span className="text-slate-500 text-[10px]">{p.from}→{p.to}级</span>
                </div>
              ))}
            </div>
          )}
          {honor.relegated.length > 0 && (
            <div className="bg-red-900/15 rounded-lg border border-red-800/30 p-3">
              <h4 className="text-[10px] text-red-400 font-semibold mb-1">⬇️ 降级球队</h4>
              {honor.relegated.map(r => (
                <div key={r.teamId} className="flex items-center gap-1.5 text-xs text-slate-300 py-0.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: (tb[r.teamId] as any)?.color ?? '#666' }} />
                  <Link to={`/team/${r.teamId}`} className="hover:text-blue-400">{getTeamName(r.teamId, tb)}</Link>
                  <span className="text-slate-500 text-[10px]">{r.from}→{r.to}级</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Season Buffs Recap */}
      {buffs.length > 0 && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-3">
          <h3 className="text-xs font-semibold text-slate-400 mb-2">赛季剧情</h3>
          <div className="space-y-1.5">
            {buffs.map(b => {
              const isPos = b.effects.some(e => e.delta > 0);
              return (
                <div key={b.teamId} className="flex items-center gap-2 text-xs">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${isPos ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'}`}>{b.label}</span>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: (tb[b.teamId] as any)?.color ?? '#666' }} />
                  <span className="text-slate-300">{getTeamName(b.teamId, tb)}</span>
                  <span className="text-slate-600 text-[10px] truncate flex-1">{b.description}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Coach Changes */}
      {honor.coachChanges.length > 0 && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-3">
          <h3 className="text-xs font-semibold text-slate-400 mb-2">教练变动 ({honor.coachChanges.length})</h3>
          <div className="space-y-1">
            {honor.coachChanges.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px] flex-wrap">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: (tb[c.teamId] as any)?.color ?? '#666' }} />
                <span className="text-slate-300">{getTeamName(c.teamId, tb)}</span>
                <span className="text-red-400">{getCoachName(c.oldCoachId, world.coachBases)}</span>
                <span className="text-slate-600">→</span>
                <span className="text-emerald-400">{getCoachName(c.newCoachId, world.coachBases)}</span>
                <span className="text-slate-600 text-[10px] ml-auto">{c.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AllSeasonsNarrative({ world, onSelectSeason }: { world: GameWorld; onSelectSeason: (s: number) => void }) {
  const honors = world.honorHistory;
  const tb = world.teamBases;

  // Build narrative episodes per season
  const episodes = honors.map(honor => {
    const seasonNumber = honor.seasonNumber;
    const seasonRecords = Object.entries(world.teamSeasonRecords)
      .map(([teamId, recs]) => {
        const rec = recs.find(r => r.seasonNumber === seasonNumber);
        return rec ? { ...rec, teamId } : null;
      })
      .filter(Boolean) as any[];
    const l1 = seasonRecords.filter(r => r.leagueLevel === 1).sort((a, b) => a.leaguePosition - b.leaguePosition);
    const champ = getTeamName(honor.league1Champion, tb);
    const runner = l1[1] ? getTeamName(l1[1].teamId, tb) : '';
    const gap = l1[0] && l1[1] ? l1[0].leaguePoints - l1[1].leaguePoints : 0;

    const isCurrentSeason = seasonNumber === world.seasonState.seasonNumber;
    const buffs = isCurrentSeason
      ? (world.seasonBuffs ?? [])
      : ((world.seasonBuffsHistory ?? []).find(h => h.season === seasonNumber)?.buffs ?? []);

    // Multi-crown
    const allWinners = [honor.league1Champion, honor.leagueCupWinner, honor.superCupWinner, honor.worldCupWinner].filter(Boolean);
    const crownCounts = new Map<string, number>();
    for (const w of allWinners) { if (w) crownCounts.set(w, (crownCounts.get(w) ?? 0) + 1); }
    const multiCrown = [...crownCounts.entries()].find(([, c]) => c >= 2);

    // Generate single-paragraph episode
    const sentences: string[] = [];
    if (gap >= 10) {
      sentences.push(`${champ}以${gap}分的恐怖优势横扫联赛`);
    } else if (gap <= 3 && runner) {
      sentences.push(`${champ}和${runner}上演冠军争夺战，${champ}惊险胜出`);
    } else {
      sentences.push(`${champ}以${l1[0]?.leaguePoints}分加冕王座`);
    }

    // Buff influence
    const champBuff = buffs.find(b => b.teamId === honor.league1Champion);
    if (champBuff) {
      const isPos = champBuff.effects.some(e => e.delta > 0);
      sentences.push(isPos ? `「${champBuff.label}」剧情成为夺冠的助推器` : `克服了「${champBuff.label}」的阴影`);
    }

    if (multiCrown) {
      const [tid, count] = multiCrown;
      const crown = count === 4 ? '四冠王' : count === 3 ? '三冠王' : '双冠王';
      if (tid === honor.league1Champion) sentences.push(`同时夺得多座奖杯成就${crown}伟业`);
    }

    if (honor.worldCupWinner) {
      sentences.push(`环球冠军杯由${getTeamName(honor.worldCupWinner, tb)}捧得`);
    }

    if (honor.coachChanges.length >= 4) {
      sentences.push(`赛季全程换帅${honor.coachChanges.length}次`);
    }

    if (honor.relegated.length > 0) {
      sentences.push(`${honor.relegated.map(r => getTeamName(r.teamId, tb)).join('、')}遗憾降级`);
    }
    if (honor.promoted.length > 0) {
      sentences.push(`${honor.promoted.map(p => getTeamName(p.teamId, tb)).join('、')}成功升级`);
    }

    return {
      seasonNumber,
      paragraph: sentences.join('，') + '。',
      championColor: (tb[honor.league1Champion] as any)?.color ?? '#666',
      isWcYear: !!honor.worldCupWinner,
    };
  });

  return (
    <div className="max-w-4xl space-y-4">
      <div className="py-4 bg-gradient-to-r from-amber-900/20 via-slate-800 to-amber-900/20 rounded-xl border border-amber-700/30 px-4 text-center">
        <h2 className="text-xl font-black text-slate-100">编年史 · 全部赛季</h2>
        <p className="text-xs text-slate-500 mt-1">从开局到现在，{episodes.length}个赛季的兴衰起伏</p>
      </div>

      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="relative">
          <div className="absolute left-8 top-0 bottom-0 w-px bg-slate-700" />
          {episodes.map((ep, i) => (
            <button key={ep.seasonNumber} onClick={() => onSelectSeason(ep.seasonNumber)}
              className="w-full flex items-start gap-3 px-4 py-3 hover:bg-slate-700/30 transition-colors cursor-pointer text-left border-b border-slate-700/20 last:border-b-0">
              <div className="flex flex-col items-center shrink-0 w-8 relative z-10">
                <div className="w-4 h-4 rounded-full ring-2 ring-slate-800" style={{ backgroundColor: ep.championColor }} />
                <span className="text-[10px] text-slate-500 mt-1">S{ep.seasonNumber}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-300 leading-relaxed">
                  {ep.paragraph}
                  {ep.isWcYear && <span className="text-sky-400 ml-1">⭐</span>}
                </p>
              </div>
              <span className="text-slate-600 text-xs shrink-0 mt-1">→</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StandingsTable({ title, records, tb }: { title: string; records: any[]; tb: Record<string, any> }) {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-700/60">
        <h3 className="text-xs font-semibold text-slate-400">{title}</h3>
      </div>
      <div className="divide-y divide-slate-700/30">
        {records.map((r, i) => (
          <div key={r.teamId} className={`flex items-center gap-2 px-3 py-1.5 text-xs ${i === 0 ? 'bg-amber-900/10' : r.relegated ? 'bg-red-900/10' : r.promoted ? 'bg-green-900/10' : ''}`}>
            <span className={`w-4 text-center font-bold ${i === 0 ? 'text-amber-400' : r.relegated ? 'text-red-400' : r.promoted ? 'text-green-400' : 'text-slate-500'}`}>{i + 1}</span>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: (tb[r.teamId] as any)?.color ?? '#666' }} />
            <Link to={`/team/${r.teamId}`} className="flex-1 truncate text-slate-200 hover:text-blue-400">{getTeamName(r.teamId, tb)}</Link>
            <span className="text-slate-500 hidden sm:inline">{r.leagueWon}胜 {r.leagueDrawn}平 {r.leagueLost}负</span>
            <span className="text-slate-500 text-[10px]">{r.leagueGF}-{r.leagueGA}</span>
            <span className="text-slate-400 w-8 text-right">{r.leagueGF - r.leagueGA > 0 ? '+' : ''}{r.leagueGF - r.leagueGA}</span>
            <span className="font-bold text-slate-200 w-8 text-right">{r.leaguePoints}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MemMatch({ m, tb }: { m: any; tb: Record<string, any> }) {
  const homeName = getTeamName(m.homeId, tb);
  const awayName = getTeamName(m.awayId, tb);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: (tb[m.homeId] as any)?.color ?? '#666' }} />
      <span className="flex-1 truncate text-slate-300 text-right">{homeName}</span>
      <span className="font-bold tabular-nums text-amber-400 px-2">{m.homeGoals}-{m.awayGoals}</span>
      <span className="flex-1 truncate text-slate-300">{awayName}</span>
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: (tb[m.awayId] as any)?.color ?? '#666' }} />
      <span className="text-[11px] sm:text-[9px] text-slate-600 ml-1">{m.comp}</span>
    </div>
  );
}

function AwardBox({ emoji, label, team, detail, color }: { emoji: string; label: string; team: string; detail: string; color?: string }) {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-3">
      <div className="flex items-center gap-2">
        <span className="text-lg shrink-0">{emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-slate-500">{label}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color ?? '#666' }} />
            <span className="text-xs font-semibold text-slate-200 truncate">{team}</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">{detail}</div>
        </div>
      </div>
    </div>
  );
}

function ChampCard({ label, team, runnerUp, tb, color }: { label: string; team: string; runnerUp?: string; tb: Record<string, any>; color: string }) {
  if (!team || !tb[team]) return null;
  const colors: Record<string, string> = { amber: 'border-amber-700/40 bg-amber-900/15', blue: 'border-blue-700/40 bg-blue-900/15', emerald: 'border-emerald-700/40 bg-emerald-900/15', purple: 'border-purple-700/40 bg-purple-900/15', sky: 'border-sky-700/40 bg-sky-900/15' };
  return (
    <div className={`rounded-lg border p-2.5 ${colors[color] ?? colors.amber}`}>
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="flex items-center gap-1.5 mt-1">
        <span className="w-4 h-4 rounded flex items-center justify-center text-[10px] sm:text-[8px] font-bold text-white" style={{ backgroundColor: tb[team]?.color ?? '#666' }}>{tb[team]?.shortName?.charAt(0)}</span>
        <Link to={`/team/${team}`} className="text-xs font-semibold text-slate-200 hover:text-blue-400 truncate">{getTeamName(team, tb)}</Link>
      </div>
      {runnerUp && tb[runnerUp] && (
        <div className="flex items-center gap-1 mt-1 text-[11px] sm:text-[9px] text-slate-500">
          <span>亚</span>
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tb[runnerUp]?.color ?? '#666' }} />
          <span className="truncate">{getTeamName(runnerUp, tb)}</span>
        </div>
      )}
    </div>
  );
}

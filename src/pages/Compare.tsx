import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { getTeamName, getCoachName, formatForm } from '../utils/format';
import TeamBadge from '../components/TeamBadge';

export default function Compare() {
  const world = useGameStore((s) => s.world);
  const [teamA, setTeamA] = useState('');
  const [teamB, setTeamB] = useState('');

  if (!world) return <div className="text-slate-400">正在加载...</div>;

  const allTeamIds = Object.keys(world.teamBases).sort((a, b) => (world.teamBases[b]?.overall ?? 0) - (world.teamBases[a]?.overall ?? 0));

  const a = teamA ? world.teamBases[teamA] : null;
  const b = teamB ? world.teamBases[teamB] : null;
  const aState = teamA ? world.teamStates[teamA] : null;
  const bState = teamB ? world.teamStates[teamB] : null;

  const attrs = [
    { key: 'overall', label: '综合', max: 100 },
    { key: 'attack', label: '攻击', max: 100 },
    { key: 'midfield', label: '中场', max: 100 },
    { key: 'defense', label: '防守', max: 100 },
    { key: 'stability', label: '稳定', max: 100 },
    { key: 'depth', label: '厚度', max: 100 },
  ];

  const stateAttrs = [
    { key: 'morale', label: '士气', max: 100 },
    { key: 'fatigue', label: '疲劳', max: 100, inverted: true },
    { key: 'coachPressure', label: '教练压力', max: 100, inverted: true },
    { key: 'squadHealth', label: '球员健康', max: 100 },
  ];

  // Historical head-to-head from season records + match results
  const h2h = useMemo(() => {
    if (!teamA || !teamB) return null;
    const aTrophies = (world.teamTrophies[teamA] ?? []).length;
    const bTrophies = (world.teamTrophies[teamB] ?? []).length;
    const aRecords = world.teamSeasonRecords[teamA] ?? [];
    const bRecords = world.teamSeasonRecords[teamB] ?? [];
    const aChampions = aRecords.filter(r => r.leaguePosition === 1).length;
    const bChampions = bRecords.filter(r => r.leaguePosition === 1).length;

    // Scan all calendar windows for head-to-head matches
    const matches: { season: number; home: string; away: string; homeGoals: number; awayGoals: number; comp: string; round: string; et?: boolean; pen?: string }[] = [];
    for (const honor of world.honorHistory) {
      const sn = honor.seasonNumber;
      // Search the stored season's calendar if available, otherwise skip
      // Results are in calendar windows
    }
    // Scan current season calendar
    for (const w of world.seasonState.calendar) {
      if (!w.completed || w.results.length === 0) continue;
      for (const r of w.results) {
        if ((r.homeTeamId === teamA && r.awayTeamId === teamB) ||
            (r.homeTeamId === teamB && r.awayTeamId === teamA)) {
          const totalH = r.homeGoals + (r.etHomeGoals ?? 0);
          const totalA = r.awayGoals + (r.etAwayGoals ?? 0);
          matches.push({
            season: world.seasonState.seasonNumber,
            home: r.homeTeamId,
            away: r.awayTeamId,
            homeGoals: totalH,
            awayGoals: totalA,
            comp: r.competitionName,
            round: r.roundLabel,
            et: r.extraTime || undefined,
            pen: r.penalties ? `${r.penaltyHome}-${r.penaltyAway}` : undefined,
          });
        }
      }
    }

    let aWins = 0, bWins = 0, draws = 0, aGoals = 0, bGoals = 0;
    for (const m of matches) {
      const aIsHome = m.home === teamA;
      const aG = aIsHome ? m.homeGoals : m.awayGoals;
      const bG = aIsHome ? m.awayGoals : m.homeGoals;
      aGoals += aG;
      bGoals += bG;
      if (aG > bG) aWins++;
      else if (bG > aG) bWins++;
      else draws++;
    }

    return { aTrophies, bTrophies, aChampions, bChampions, aSeasons: aRecords.length, bSeasons: bRecords.length, matches, aWins, bWins, draws, aGoals, bGoals };
  }, [teamA, teamB, world.teamTrophies, world.teamSeasonRecords, world.seasonState.calendar, world.honorHistory]);

  return (
    <div className="max-w-3xl space-y-5">
      <h2 className="text-xl font-bold text-slate-100">球队对比</h2>

      {/* Team selectors */}
      <div className="flex gap-3 items-center">
        <select value={teamA} onChange={e => setTeamA(e.target.value)}
          className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 cursor-pointer">
          <option value="">选择球队 A</option>
          {allTeamIds.map(id => <option key={id} value={id}>{world.teamBases[id]?.name} ({world.teamBases[id]?.overall})</option>)}
        </select>
        <span className="text-slate-500 font-bold text-lg">VS</span>
        <select value={teamB} onChange={e => setTeamB(e.target.value)}
          className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 cursor-pointer">
          <option value="">选择球队 B</option>
          {allTeamIds.map(id => <option key={id} value={id}>{world.teamBases[id]?.name} ({world.teamBases[id]?.overall})</option>)}
        </select>
      </div>

      {a && b && aState && bState && (
        <>
          {/* Header cards */}
          <div className="grid grid-cols-2 gap-3">
            <TeamHeader base={a} state={aState} coachName={aState.currentCoachId ? getCoachName(aState.currentCoachId, world.coachBases) : '无'} />
            <TeamHeader base={b} state={bState} coachName={bState.currentCoachId ? getCoachName(bState.currentCoachId, world.coachBases) : '无'} />
          </div>

          {/* Attribute comparison bars */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">属性对比</h3>
            <div className="space-y-2.5">
              {attrs.map(attr => {
                const va = (a as any)[attr.key] ?? 0;
                const vb = (b as any)[attr.key] ?? 0;
                return <DualBar key={attr.key} label={attr.label} left={va} right={vb} max={attr.max} leftColor={a.color} rightColor={b.color} />;
              })}
            </div>
          </div>

          {/* State comparison */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">当前状态</h3>
            <div className="space-y-2.5">
              {stateAttrs.map(attr => {
                const va = (aState as any)[attr.key] ?? 0;
                const vb = (bState as any)[attr.key] ?? 0;
                return <DualBar key={attr.key} label={attr.label} left={va} right={vb} max={attr.max} leftColor={a.color} rightColor={b.color} />;
              })}
            </div>
            {/* Form */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-700/50">
              <div className="flex gap-0.5">
                {formatForm(aState.recentForm.slice(-5)).map((f, i) => (
                  <span key={i} className={`w-5 h-5 rounded text-[10px] font-bold text-white flex items-center justify-center ${f.color}`}>{f.label}</span>
                ))}
              </div>
              <span className="text-[10px] text-slate-500">近期战绩</span>
              <div className="flex gap-0.5">
                {formatForm(bState.recentForm.slice(-5)).map((f, i) => (
                  <span key={i} className={`w-5 h-5 rounded text-[10px] font-bold text-white flex items-center justify-center ${f.color}`}>{f.label}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Historical stats */}
          {h2h && (
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">历史荣誉</h3>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="text-slate-200 font-bold">{h2h.aTrophies}</div>
                <div className="text-slate-500">总奖杯</div>
                <div className="text-slate-200 font-bold">{h2h.bTrophies}</div>
                <div className="text-slate-200 font-bold">{h2h.aChampions}</div>
                <div className="text-slate-500">联赛冠军</div>
                <div className="text-slate-200 font-bold">{h2h.bChampions}</div>
                <div className="text-slate-200 font-bold">{h2h.aSeasons}</div>
                <div className="text-slate-500">历史赛季</div>
                <div className="text-slate-200 font-bold">{h2h.bSeasons}</div>
              </div>
            </div>
          )}

          {/* Head-to-head record */}
          {h2h && h2h.matches.length > 0 && (
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-700/60">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">交手记录</h3>
              </div>
              {/* Summary bar */}
              <div className="px-4 py-3 border-b border-slate-700/30">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-bold" style={{ color: a.color }}>{h2h.aWins}胜</span>
                  <div className="flex-1 h-3 bg-slate-700 rounded-full overflow-hidden flex">
                    {h2h.aWins + h2h.bWins + h2h.draws > 0 && (
                      <>
                        <div className="h-full" style={{ width: `${(h2h.aWins / (h2h.aWins + h2h.bWins + h2h.draws)) * 100}%`, backgroundColor: a.color }} />
                        <div className="h-full bg-slate-500" style={{ width: `${(h2h.draws / (h2h.aWins + h2h.bWins + h2h.draws)) * 100}%` }} />
                        <div className="h-full" style={{ width: `${(h2h.bWins / (h2h.aWins + h2h.bWins + h2h.draws)) * 100}%`, backgroundColor: b.color }} />
                      </>
                    )}
                  </div>
                  <span className="font-bold" style={{ color: b.color }}>{h2h.bWins}胜</span>
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                  <span>{h2h.aGoals}进球</span>
                  <span>{h2h.matches.length}场 · {h2h.draws}平</span>
                  <span>{h2h.bGoals}进球</span>
                </div>
              </div>
              {/* Match list */}
              <div className="divide-y divide-slate-700/30 max-h-48 overflow-y-auto">
                {[...h2h.matches].reverse().map((m, i) => {
                  const aIsHome = m.home === teamA;
                  const aScore = aIsHome ? m.homeGoals : m.awayGoals;
                  const bScore = aIsHome ? m.awayGoals : m.homeGoals;
                  const resultColor = aScore > bScore ? a.color : bScore > aScore ? b.color : '#94a3b8';
                  return (
                    <div key={i} className="flex items-center gap-2 px-4 py-2 text-xs">
                      <span className="text-[10px] text-slate-600 w-8 shrink-0">S{m.season}</span>
                      <span className="flex-1 truncate text-slate-400">{getTeamName(m.home, world.teamBases)}</span>
                      <span className="font-bold tabular-nums px-2 py-0.5 rounded" style={{ color: resultColor }}>
                        {m.homeGoals} - {m.awayGoals}
                      </span>
                      <span className="flex-1 truncate text-slate-400 text-right">{getTeamName(m.away, world.teamBases)}</span>
                      <span className="text-[10px] text-slate-600 w-12 text-right shrink-0 truncate">{m.comp}</span>
                      {m.et && <span className="text-[9px] text-amber-500">ET</span>}
                      {m.pen && <span className="text-[9px] text-amber-500">P{m.pen}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {h2h && h2h.matches.length === 0 && (
            <div className="text-center text-xs text-slate-500 py-4">本赛季暂无交手记录</div>
          )}
        </>
      )}
    </div>
  );
}

function TeamHeader({ base, state, coachName }: { base: any; state: any; coachName: string }) {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-3 text-center">
      <TeamBadge shortName={base.shortName} color={base.color} size={40} />
      <div className="text-sm font-bold text-slate-100 mt-2">{base.name}</div>
      <div className="text-2xl font-black text-slate-200 mt-1">{base.overall}</div>
      <div className="text-[10px] text-slate-500 mt-1">{coachName} · {base.region?.split('+')[1]}</div>
    </div>
  );
}

function DualBar({ label, left, right, max, leftColor, rightColor }: { label: string; left: number; right: number; max: number; leftColor: string; rightColor: string }) {
  const lPct = Math.min(100, (left / max) * 100);
  const rPct = Math.min(100, (right / max) * 100);
  const winner = left > right ? 'left' : right > left ? 'right' : 'tie';

  return (
    <div className="flex items-center gap-2">
      <span className={`w-8 text-right text-xs font-bold ${winner === 'left' ? 'text-slate-100' : 'text-slate-500'}`}>{left}</span>
      <div className="flex-1 flex gap-1">
        <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden flex justify-end">
          <div className="h-full rounded-full" style={{ width: `${lPct}%`, backgroundColor: leftColor }} />
        </div>
        <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${rPct}%`, backgroundColor: rightColor }} />
        </div>
      </div>
      <span className={`w-8 text-left text-xs font-bold ${winner === 'right' ? 'text-slate-100' : 'text-slate-500'}`}>{right}</span>
      <span className="w-10 text-[10px] text-slate-500 text-center">{label}</span>
    </div>
  );
}

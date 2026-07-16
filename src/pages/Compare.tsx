import { useState, useMemo } from 'react';
import { useGameStore } from '../store/game-store';
import { getTeamName, getTeamShortName, getCoachName, formatForm } from '../utils/format';
import { getTeamCoachId } from '../engine/coaches/coach-lookup';
import TeamBadge from '../components/TeamBadge';
import type { GameWorld } from '../engine/season/season-manager';
import type { TeamBase, TeamState } from '../types/team';

type TeamNumericKey = 'overall' | 'attack' | 'midfield' | 'defense' | 'stability' | 'depth';
type StateNumericKey = 'morale' | 'fatigue' | 'coachPressure' | 'squadHealth';

export default function Compare() {
  const world = useGameStore((s) => s.world);

  if (!world) return <div className="text-slate-400">正在加载...</div>;
  return <CompareContent world={world} />;
}

function CompareContent({ world }: { world: GameWorld }) {
  const [teamA, setTeamA] = useState('');
  const [teamB, setTeamB] = useState('');

  const allTeamIds = Object.keys(world.teamBases).sort((a, b) => (world.teamBases[b]?.overall ?? 0) - (world.teamBases[a]?.overall ?? 0));

  const a = teamA ? world.teamBases[teamA] : null;
  const b = teamB ? world.teamBases[teamB] : null;
  const aState = teamA ? world.teamStates[teamA] : null;
  const bState = teamB ? world.teamStates[teamB] : null;

  const attrs: { key: TeamNumericKey; label: string; max: number }[] = [
    { key: 'overall', label: '综合', max: 100 },
    { key: 'attack', label: '攻击', max: 100 },
    { key: 'midfield', label: '中场', max: 100 },
    { key: 'defense', label: '防守', max: 100 },
    { key: 'stability', label: '稳定', max: 100 },
    { key: 'depth', label: '厚度', max: 100 },
  ];

  const stateAttrs: { key: StateNumericKey; label: string; max: number; inverted?: boolean }[] = [
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

    // Scan matchHistory (past seasons) + current season calendar
    const matches: { season: number; home: string; away: string; homeGoals: number; awayGoals: number; comp: string; round: string; et?: boolean; pen?: string }[] = [];

    // Past seasons from matchHistory
    for (const m of (world.matchHistory ?? [])) {
      if ((m.homeId === teamA && m.awayId === teamB) ||
          (m.homeId === teamB && m.awayId === teamA)) {
        matches.push({
          season: m.season,
          home: m.homeId,
          away: m.awayId,
          homeGoals: m.homeGoals,
          awayGoals: m.awayGoals,
          comp: m.comp,
          round: '',
          et: m.et,
          pen: m.pen,
        });
      }
    }

    // Current season from calendar
    for (const w of world.seasonState.calendar) {
      if (!w.completed || w.results.length === 0) continue;
      for (const r of w.results) {
        if ((r.homeTeamId === teamA && r.awayTeamId === teamB) ||
            (r.homeTeamId === teamB && r.awayTeamId === teamA)) {
          matches.push({
            season: world.seasonState.seasonNumber,
            home: r.homeTeamId,
            away: r.awayTeamId,
            homeGoals: r.homeGoals + (r.etHomeGoals ?? 0),
            awayGoals: r.awayGoals + (r.etAwayGoals ?? 0),
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
  }, [teamA, teamB, world]);

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

      {a && b && aState && bState && (() => {
        const aCoachId = getTeamCoachId(world.coachStates, a.id);
        const bCoachId = getTeamCoachId(world.coachStates, b.id);
        return (
        <>
          {/* Header cards */}
          <div className="grid grid-cols-2 gap-3">
            <TeamHeader base={a} state={aState} coachName={aCoachId ? getCoachName(aCoachId, world.coachBases) : '无'} />
            <TeamHeader base={b} state={bState} coachName={bCoachId ? getCoachName(bCoachId, world.coachBases) : '无'} />
          </div>

          {/* Attribute comparison bars */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">属性对比</h3>
            <div className="space-y-2.5">
              {attrs.map(attr => {
                const va = a[attr.key] ?? 0;
                const vb = b[attr.key] ?? 0;
                return <DualBar key={attr.key} label={attr.label} left={va} right={vb} max={attr.max} leftColor={a.color} rightColor={b.color} />;
              })}
            </div>
          </div>

          {/* State comparison */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">当前状态</h3>
            <div className="space-y-2.5">
              {stateAttrs.map(attr => {
                const va = aState[attr.key] ?? 0;
                const vb = bState[attr.key] ?? 0;
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
                      <span className="flex-1 whitespace-nowrap text-slate-400" title={getTeamName(m.home, world.teamBases)}>{getTeamShortName(m.home, world.teamBases)}</span>
                      <span className="font-bold tabular-nums px-2 py-0.5 rounded" style={{ color: resultColor }}>
                        {m.homeGoals} - {m.awayGoals}
                      </span>
                      <span className="flex-1 whitespace-nowrap text-slate-400 text-right" title={getTeamName(m.away, world.teamBases)}>{getTeamShortName(m.away, world.teamBases)}</span>
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
        );
      })()}
    </div>
  );
}

function TeamHeader({ base, coachName }: { base: TeamBase; state: TeamState; coachName: string }) {
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

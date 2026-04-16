import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { predictMatch } from '../engine/match/prediction';
import type { MatchFixture, MatchResult } from '../types/match';
import MatchDetailModal from '../components/MatchDetailModal';
import { isDerby, getDerbyName } from '../config/derbies';
import {
  getTeamName,
  getWindowTypeColor,
  getWindowTypeLabel,
} from '../utils/format';

export default function Calendar() {
  const world = useGameStore((s) => s.world);
  const [expandedWindow, setExpandedWindow] = useState<number | null>(null);
  const [selectedFixture, setSelectedFixture] = useState<MatchFixture | null>(null);
  const [selectedResult, setSelectedResult] = useState<MatchResult | null>(null);

  if (!world) {
    return <div className="text-slate-400">正在加载...</div>;
  }

  const { calendar, currentWindowIndex } = world.seasonState;
  const completedCount = calendar.filter(w => w.completed).length;

  const handleFixtureClick = (fixture: MatchFixture) => {
    setSelectedFixture(fixture);
    setSelectedResult(null);
  };

  const handleResultClick = (result: MatchResult) => {
    const fixture: MatchFixture = {
      id: result.fixtureId,
      homeTeamId: result.homeTeamId,
      awayTeamId: result.awayTeamId,
      competitionType: result.competitionType,
      competitionName: result.competitionName,
      roundLabel: result.roundLabel,
    };
    setSelectedFixture(fixture);
    setSelectedResult(result);
  };

  const closeModal = () => {
    setSelectedFixture(null);
    setSelectedResult(null);
  };

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-slate-100">
          赛历 — 第 {world.seasonState.seasonNumber} 赛季
        </h2>
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <span className="px-3 py-1 bg-slate-800 rounded-lg border border-slate-700">
            {completedCount}/{calendar.length} 阶段
          </span>
        </div>
      </div>

      {/* Type legend */}
      <div className="flex flex-wrap gap-2 mb-4 text-xs">
        {(['league', 'league_cup', 'super_cup_group', 'super_cup', 'relegation_playoff', 'season_end'] as const).map(type => (
          <span key={type} className={`px-2 py-0.5 rounded text-white/80 ${getWindowTypeColor(type)}`}>
            {getWindowTypeLabel(type)}
          </span>
        ))}
      </div>

      <div className="relative">
        <div className="absolute left-[18px] top-0 bottom-0 w-px bg-slate-700" />

        <div className="space-y-1.5">
          {calendar.map((win, i) => {
            const isCurrent = i === currentWindowIndex;
            const isCompleted = win.completed;
            const isFuture = i > currentWindowIndex;
            const isExpanded = expandedWindow === win.id;
            const matchCount = isCompleted ? win.results.length : win.fixtures.length;

            return (
              <div key={win.id} className="relative flex items-start gap-3 pl-0">
                {/* Timeline dot */}
                <div className="relative z-10 mt-2.5 shrink-0">
                  <div
                    className={`w-9 h-9 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all
                      ${isCompleted
                        ? 'bg-green-600/90 border-green-500 text-white'
                        : isCurrent
                          ? 'bg-blue-600 border-blue-400 text-white shadow-lg shadow-blue-500/30 animate-pulse'
                          : 'bg-slate-800 border-slate-600 text-slate-500'
                      }`}
                  >
                    {i + 1}
                  </div>
                </div>

                {/* Window card */}
                <div className={`flex-1 rounded-xl border transition-all overflow-hidden ${
                  isCurrent
                    ? 'bg-slate-800 border-blue-500/40 shadow-lg shadow-blue-900/20'
                    : isCompleted
                      ? 'bg-slate-800/70 border-slate-700/80'
                      : 'bg-slate-800/30 border-slate-700/40'
                }`}>
                  <button
                    onClick={() => setExpandedWindow(isExpanded ? null : win.id)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-slate-700/20 cursor-pointer text-left"
                  >
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium text-white shrink-0 ${getWindowTypeColor(win.type)}`}>
                      {getWindowTypeLabel(win.type)}
                    </span>
                    <span className={`text-sm font-medium flex-1 ${isFuture ? 'text-slate-500' : 'text-slate-200'}`}>
                      {win.label}
                    </span>
                    {isCurrent && (
                      <span className="text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full border border-blue-500/30 shrink-0">
                        当前
                      </span>
                    )}
                    <span className={`text-xs shrink-0 ${isFuture ? 'text-slate-600' : 'text-slate-500'}`}>
                      {matchCount > 0 ? `${matchCount}场` : ''}
                      <span className="ml-1.5">{isExpanded ? '▼' : '▶'}</span>
                    </span>
                  </button>

                  {/* Expanded: show fixtures/results, all CLICKABLE */}
                  {isExpanded && (
                    <div className="border-t border-slate-700/60 p-2 space-y-1">
                      {isCompleted && win.results.map(r => {
                        const homeTeam = world.teamBases[r.homeTeamId];
                        const awayTeam = world.teamBases[r.awayTeamId];
                        return (
                          <button
                            key={r.fixtureId}
                            onClick={() => handleResultClick(r)}
                            className="w-full flex items-center text-sm py-2 px-3 rounded-lg hover:bg-slate-700/40 cursor-pointer transition-colors text-left"
                          >
                            <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: homeTeam?.color ?? '#666' }} />
                              <span className="text-slate-200 truncate">{getTeamName(r.homeTeamId, world.teamBases)}</span>
                            </div>
                            <div className="flex items-center gap-1.5 px-3 shrink-0">
                              <span className={`font-bold text-base ${r.homeGoals > r.awayGoals ? 'text-green-400' : r.homeGoals < r.awayGoals ? 'text-red-400' : 'text-slate-300'}`}>
                                {r.homeGoals}
                              </span>
                              <span className="text-slate-600">-</span>
                              <span className={`font-bold text-base ${r.awayGoals > r.homeGoals ? 'text-green-400' : r.awayGoals < r.homeGoals ? 'text-red-400' : 'text-slate-300'}`}>
                                {r.awayGoals}
                              </span>
                              {r.extraTime && (
                                <span className="text-[10px] text-amber-400">{r.penalties ? '点球' : '加时'}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 flex-1 min-w-0">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: awayTeam?.color ?? '#666' }} />
                              <span className="text-slate-200 truncate">{getTeamName(r.awayTeamId, world.teamBases)}</span>
                            </div>
                            <span className="text-[10px] text-slate-600 ml-2 shrink-0">详情 →</span>
                          </button>
                        );
                      })}

                      {!isCompleted && win.fixtures.length > 0 && win.fixtures.map(fixture => {
                        const homeTeam = world.teamBases[fixture.homeTeamId];
                        const awayTeam = world.teamBases[fixture.awayTeamId];
                        const homeState = world.teamStates[fixture.homeTeamId];
                        const awayState = world.teamStates[fixture.awayTeamId];
                        if (!homeTeam || !awayTeam || !homeState || !awayState) return null;

                        const homeCoach = homeState.currentCoachId ? world.coachBases[homeState.currentCoachId] ?? null : null;
                        const awayCoach = awayState.currentCoachId ? world.coachBases[awayState.currentCoachId] ?? null : null;
                        const pred = predictMatch(homeTeam, awayTeam, homeState, awayState, homeCoach, awayCoach);

                        const calDerby = isDerby(fixture.homeTeamId, fixture.awayTeamId) ? getDerbyName(fixture.homeTeamId, fixture.awayTeamId) : null;

                        return (
                          <button
                            key={fixture.id}
                            onClick={() => handleFixtureClick(fixture)}
                            className={`w-full flex items-center text-sm py-2 px-3 rounded-lg hover:bg-slate-700/40 cursor-pointer transition-colors text-left ${calDerby ? 'bg-orange-900/10 border border-orange-800/20' : 'bg-slate-700/15'}`}
                          >
                            <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: homeTeam.color }} />
                              <span className="text-slate-300 truncate">{homeTeam.name}</span>
                              <span className="text-[10px] text-slate-500">{homeTeam.overall}</span>
                            </div>
                            <div className="flex flex-col items-center px-3 shrink-0 w-16">
                              <span className="text-[10px] text-slate-500">VS</span>
                              <div className="flex h-1 w-full rounded-full overflow-hidden bg-slate-700 mt-0.5">
                                <div className="bg-green-500" style={{ width: `${pred.homeWinPct}%` }} />
                                <div className="bg-slate-400" style={{ width: `${pred.drawPct}%` }} />
                                <div className="bg-red-500" style={{ width: `${pred.awayWinPct}%` }} />
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 flex-1 min-w-0">
                              <span className="text-[10px] text-slate-500">{awayTeam.overall}</span>
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: awayTeam.color }} />
                              <span className="text-slate-300 truncate">{awayTeam.name}</span>
                            </div>
                            <span className="text-[10px] text-slate-600 ml-2 shrink-0">
                              {calDerby ? <span className="text-orange-400">{calDerby}</span> : '预测 →'}
                            </span>
                          </button>
                        );
                      })}

                      {!isCompleted && win.fixtures.length === 0 && (
                        <p className="text-xs text-slate-600 px-3 py-2">对阵待定</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal */}
      <MatchDetailModal
        isOpen={!!selectedFixture}
        onClose={closeModal}
        fixture={selectedFixture ?? undefined}
        result={selectedResult ?? undefined}
        world={world}
      />
    </div>
  );
}

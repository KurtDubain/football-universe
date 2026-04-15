import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { predictMatch, MatchPrediction } from '../engine/match/prediction';
import type { MatchFixture, MatchResult } from '../types/match';
import type { GameWorld } from '../engine/season/season-manager';
import MatchDetailModal from '../components/MatchDetailModal';
import {
  getTeamName,
  getTeamShortName,
  getWindowTypeLabel,
  getWindowTypeColor,
  formatForm,
  getCoachName,
} from '../utils/format';

export default function Dashboard() {
  const world = useGameStore((s) => s.world);
  const lastResults = useGameStore((s) => s.lastResults);
  const lastNews = useGameStore((s) => s.lastNews);
  const getCurrentWindow = useGameStore((s) => s.getCurrentWindow);
  const advanceWindow = useGameStore((s) => s.advanceWindow);
  const isAdvancing = useGameStore((s) => s.isAdvancing);

  // Modal state
  const [selectedFixture, setSelectedFixture] = useState<MatchFixture | null>(null);
  const [selectedResult, setSelectedResult] = useState<MatchResult | null>(null);

  if (!world) {
    return <div className="text-slate-400">正在加载...</div>;
  }

  const currentWindow = getCurrentWindow();
  const calendarLen = world.seasonState.calendar.length;
  const completedWindows = world.seasonState.calendar.filter((w) => w.completed).length;
  const isWorldCupYear = world.seasonState.isWorldCupYear;

  // Find the matching fixture for a result
  const findFixtureForResult = (result: MatchResult): MatchFixture | undefined => {
    for (const win of world.seasonState.calendar) {
      const f = win.fixtures.find((fx) => fx.id === result.fixtureId);
      if (f) return f;
    }
    // Fallback: construct one from the result
    return {
      id: result.fixtureId,
      homeTeamId: result.homeTeamId,
      awayTeamId: result.awayTeamId,
      competitionType: result.competitionType,
      competitionName: result.competitionName,
      roundLabel: result.roundLabel,
    };
  };

  const handleFixtureClick = (fixture: MatchFixture) => {
    setSelectedFixture(fixture);
    setSelectedResult(null);
  };

  const handleResultClick = (result: MatchResult) => {
    const fixture = findFixtureForResult(result);
    if (fixture) {
      setSelectedFixture(fixture);
      setSelectedResult(result);
    }
  };

  const closeModal = () => {
    setSelectedFixture(null);
    setSelectedResult(null);
  };

  return (
    <div className="space-y-6 max-w-6xl">
      {/* ═══════ Season Banner ═══════ */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-950 via-slate-900 to-slate-800 p-6 border border-slate-700/50">
        <div className="relative z-10 flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-black text-slate-100 tracking-tight">
              第 {world.seasonState.seasonNumber} 赛季
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              进度 {completedWindows} / {calendarLen} 阶段
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isWorldCupYear && (
              <span className="px-3 py-1 bg-sky-900/60 border border-sky-700/50 text-sky-300 text-xs font-semibold rounded-full">
                环球冠军杯年
              </span>
            )}
          </div>
        </div>
        {/* Progress bar */}
        <div className="mt-4 relative z-10">
          <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 rounded-full transition-all"
              style={{ width: `${calendarLen > 0 ? (completedWindows / calendarLen) * 100 : 0}%` }}
            />
          </div>
        </div>
        {/* Decorative background elements */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/5 rounded-full -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-emerald-600/5 rounded-full translate-y-1/2 -translate-x-1/4" />
      </div>

      {/* ═══════ Current Match Day Panel ═══════ */}
      {currentWindow ? (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span
                className={`inline-block px-2.5 py-1 rounded-lg text-xs font-semibold text-white ${getWindowTypeColor(
                  currentWindow.type
                )}`}
              >
                {getWindowTypeLabel(currentWindow.type)}
              </span>
              <h2 className="text-lg font-bold text-slate-100">
                比赛日 -- {currentWindow.label}
              </h2>
              <span className="text-sm text-slate-500">
                ({currentWindow.id + 1}/{calendarLen})
              </span>
            </div>
            <button
              onClick={advanceWindow}
              disabled={isAdvancing}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors cursor-pointer text-sm shadow-lg shadow-blue-900/30"
            >
              {isAdvancing
                ? '模拟中...'
                : `开始模拟 (${currentWindow.fixtures.length} 场)`}
            </button>
          </div>
          {currentWindow.description && (
            <p className="text-sm text-slate-400 mb-4">{currentWindow.description}</p>
          )}

          {/* Fixture cards grid */}
          {currentWindow.fixtures.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {currentWindow.fixtures.map((fixture) => (
                <FixtureCard
                  key={fixture.id}
                  fixture={fixture}
                  world={world}
                  onClick={() => handleFixtureClick(fixture)}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-gradient-to-r from-amber-900/30 to-slate-800 rounded-2xl p-6 border border-amber-700/50">
          <h2 className="text-lg font-bold text-amber-300">赛季已结束</h2>
          <p className="text-sm text-slate-400 mt-1">
            所有赛事已完成，请在历史荣誉页面查看本赛季总结
          </p>
        </div>
      )}

      {/* ═══════ Latest Results ═══════ */}
      {lastResults.length > 0 && (
        <div>
          <h3 className="text-md font-semibold text-slate-200 mb-3 flex items-center gap-2">
            <span className="w-1.5 h-5 bg-green-500 rounded-full inline-block" />
            最新战报
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {lastResults.map((r) => (
              <ResultCard
                key={r.fixtureId}
                result={r}
                world={world}
                onClick={() => handleResultClick(r)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ═══════ Two-column: News + Quick Standings ═══════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ──── News feed ──── */}
        <div>
          <h3 className="text-md font-semibold text-slate-200 mb-3 flex items-center gap-2">
            <span className="w-1.5 h-5 bg-amber-500 rounded-full inline-block" />
            新闻动态
          </h3>
          {lastNews.length === 0 && world.newsLog.length === 0 ? (
            <p className="text-sm text-slate-500">暂无新闻</p>
          ) : (
            <div className="space-y-2">
              {(lastNews.length > 0 ? lastNews : world.newsLog.slice(-10).reverse()).map(
                (news) => (
                  <div
                    key={news.id}
                    className="bg-slate-800 rounded-lg p-3 border border-slate-700 flex items-start gap-2"
                    style={{ borderLeftWidth: '3px', borderLeftColor: getNewsBorderColor(news.type) }}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-200">{news.title}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{news.description}</p>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>

        {/* ──── Quick standings ──── */}
        <div>
          <h3 className="text-md font-semibold text-slate-200 mb-3 flex items-center gap-2">
            <span className="w-1.5 h-5 bg-emerald-500 rounded-full inline-block" />
            积分榜快览
          </h3>
          <div className="space-y-3">
            {(
              [
                { standings: world.league1Standings, name: '顶级联赛', level: 1 },
                { standings: world.league2Standings, name: '甲级联赛', level: 2 },
                { standings: world.league3Standings, name: '乙级联赛', level: 3 },
              ] as const
            ).map(({ standings, name, level }) => (
              <div
                key={level}
                className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden"
              >
                <div className="px-3 py-2 border-b border-slate-700 flex items-center justify-between">
                  <Link
                    to={`/league/${level}`}
                    className="text-sm font-semibold text-slate-200 hover:text-blue-400"
                  >
                    {name}
                  </Link>
                  <Link
                    to={`/league/${level}`}
                    className="text-xs text-slate-500 hover:text-blue-400"
                  >
                    查看全部 &rarr;
                  </Link>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500">
                      <th className="text-left px-3 py-1 w-6">#</th>
                      <th className="text-left px-1 py-1">球队</th>
                      <th className="text-center px-1 py-1 w-8">赛</th>
                      <th className="text-center px-1 py-1 w-8">积分</th>
                      <th className="text-center px-1 py-1 w-20">近况</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.slice(0, 5).map((entry, i) => {
                      const teamBase = world.teamBases[entry.teamId];
                      return (
                        <tr
                          key={entry.teamId}
                          className="border-t border-slate-700/50 hover:bg-slate-700/30"
                        >
                          <td className="px-3 py-1.5 text-slate-400">{i + 1}</td>
                          <td className="px-1 py-1.5">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: teamBase?.color ?? '#64748b' }}
                              />
                              <Link
                                to={`/team/${entry.teamId}`}
                                className="text-slate-200 hover:text-blue-400"
                              >
                                {getTeamName(entry.teamId, world.teamBases)}
                              </Link>
                            </div>
                          </td>
                          <td className="text-center px-1 py-1.5 text-slate-400">
                            {entry.played}
                          </td>
                          <td className="text-center px-1 py-1.5 font-semibold text-slate-200">
                            {entry.points}
                          </td>
                          <td className="text-center px-1 py-1.5">
                            <div className="flex gap-0.5 justify-center">
                              {formatForm(entry.form.slice(-3)).map((f, fi) => (
                                <span
                                  key={fi}
                                  className={`inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-bold text-white ${f.color}`}
                                >
                                  {f.label}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══════ Match Detail Modal ═══════ */}
      <MatchDetailModal
        isOpen={selectedFixture !== null}
        onClose={closeModal}
        fixture={selectedFixture ?? undefined}
        result={selectedResult ?? undefined}
        world={world}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  Sub-components
// ══════════════════════════════════════════════════════════════════════

/** Fixture card (pre-match) with mini probability bar */
function FixtureCard({
  fixture,
  world,
  onClick,
}: {
  fixture: MatchFixture;
  world: GameWorld;
  onClick: () => void;
}) {
  const homeTeam = world.teamBases[fixture.homeTeamId];
  const awayTeam = world.teamBases[fixture.awayTeamId];
  const homeState = world.teamStates[fixture.homeTeamId];
  const awayState = world.teamStates[fixture.awayTeamId];

  if (!homeTeam || !awayTeam || !homeState || !awayState) return null;

  const homeCoach = homeState.currentCoachId
    ? world.coachBases[homeState.currentCoachId] ?? null
    : null;
  const awayCoach = awayState.currentCoachId
    ? world.coachBases[awayState.currentCoachId] ?? null
    : null;

  const pred = predictMatch(homeTeam, awayTeam, homeState, awayState, homeCoach, awayCoach);

  return (
    <div
      onClick={onClick}
      className="bg-slate-800 rounded-xl border border-slate-700 p-4 hover:border-slate-500 hover:bg-slate-800/80 transition-all cursor-pointer group"
    >
      <div className="flex items-center justify-between mb-3">
        {/* Home */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: homeTeam.color }}
            />
            <span className="text-sm font-bold text-slate-100 truncate group-hover:text-blue-400 transition-colors">
              {homeTeam.name}
            </span>
          </div>
          <span className="text-xs text-slate-500 ml-4">
            OVR{' '}
            <span className="text-slate-400 font-semibold">{homeTeam.overall}</span>
          </span>
        </div>

        {/* VS */}
        <div className="text-center px-3 shrink-0">
          <div className="text-base font-black text-slate-500 group-hover:text-slate-400">VS</div>
        </div>

        {/* Away */}
        <div className="flex-1 min-w-0 text-right">
          <div className="flex items-center gap-1.5 justify-end">
            <span className="text-sm font-bold text-slate-100 truncate group-hover:text-blue-400 transition-colors">
              {awayTeam.name}
            </span>
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: awayTeam.color }}
            />
          </div>
          <span className="text-xs text-slate-500 mr-4">
            OVR{' '}
            <span className="text-slate-400 font-semibold">{awayTeam.overall}</span>
          </span>
        </div>
      </div>

      {/* Mini probability bar */}
      <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-700">
        <div className="bg-green-500 transition-all" style={{ width: `${pred.homeWinPct}%` }} />
        <div className="bg-slate-400 transition-all" style={{ width: `${pred.drawPct}%` }} />
        <div className="bg-red-500 transition-all" style={{ width: `${pred.awayWinPct}%` }} />
      </div>
      <div className="flex justify-between text-[10px] mt-1 text-slate-500">
        <span className="text-green-400">胜 {pred.homeWinPct}%</span>
        <span>{pred.verdict}</span>
        <span className="text-red-400">负 {pred.awayWinPct}%</span>
      </div>
    </div>
  );
}

/** Result card (post-match) with score and key events */
function ResultCard({
  result,
  world,
  onClick,
}: {
  result: MatchResult;
  world: GameWorld;
  onClick: () => void;
}) {
  const homeTeam = world.teamBases[result.homeTeamId];
  const awayTeam = world.teamBases[result.awayTeamId];
  const homeWon = result.homeGoals > result.awayGoals;
  const awayWon = result.awayGoals > result.homeGoals;

  return (
    <div
      onClick={onClick}
      className="bg-slate-800 rounded-xl border border-slate-700 p-4 hover:border-slate-500 hover:bg-slate-800/80 transition-all cursor-pointer group"
    >
      <div className="flex items-center justify-between">
        {/* Home */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: homeTeam?.color ?? '#64748b' }}
          />
          <span
            className={`text-sm font-medium truncate group-hover:text-blue-400 transition-colors ${
              homeWon ? 'text-green-400 font-bold' : 'text-slate-200'
            }`}
          >
            {getTeamName(result.homeTeamId, world.teamBases)}
          </span>
        </div>

        {/* Score */}
        <div className="flex items-center gap-1.5 px-3 shrink-0">
          <span
            className={`text-xl font-bold ${
              homeWon ? 'text-green-400' : awayWon ? 'text-red-400' : 'text-slate-300'
            }`}
          >
            {result.homeGoals}
          </span>
          <span className="text-slate-500 text-sm">:</span>
          <span
            className={`text-xl font-bold ${
              awayWon ? 'text-green-400' : homeWon ? 'text-red-400' : 'text-slate-300'
            }`}
          >
            {result.awayGoals}
          </span>
          {result.extraTime && (
            <span className="text-xs text-amber-400 ml-1">
              {result.penalties
                ? `(P ${result.penaltyHome}-${result.penaltyAway})`
                : '(AET)'}
            </span>
          )}
        </div>

        {/* Away */}
        <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
          <span
            className={`text-sm font-medium truncate text-right group-hover:text-blue-400 transition-colors ${
              awayWon ? 'text-green-400 font-bold' : 'text-slate-200'
            }`}
          >
            {getTeamName(result.awayTeamId, world.teamBases)}
          </span>
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: awayTeam?.color ?? '#64748b' }}
          />
        </div>
      </div>

      {/* Competition + round */}
      <div className="text-xs text-slate-500 mt-2 text-center">
        {result.competitionName} - {result.roundLabel}
      </div>

      {/* Key goal events */}
      {result.events.filter(
        (e) => e.type === 'goal' || e.type === 'penalty_goal' || e.type === 'own_goal'
      ).length > 0 && (
        <div className="text-xs text-slate-500 mt-1 text-center space-x-2">
          {result.events
            .filter(
              (e) =>
                e.type === 'goal' || e.type === 'penalty_goal' || e.type === 'own_goal'
            )
            .map((e, i) => (
              <span key={i} className="text-slate-400">
                {e.minute}'{' '}
                {e.type === 'own_goal' ? '(OG)' : ''}
                {e.teamId === result.homeTeamId ? '\u2B05' : '\u27A1'}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

/** Get border color for news type */
function getNewsBorderColor(type: string): string {
  const colors: Record<string, string> = {
    match_result: '#059669',
    coach_fired: '#dc2626',
    coach_hired: '#2563eb',
    promotion: '#22c55e',
    relegation: '#ef4444',
    trophy: '#f59e0b',
    upset: '#a855f7',
    streak: '#0ea5e9',
  };
  return colors[type] ?? '#64748b';
}

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { predictMatch, MatchPrediction } from '../engine/match/prediction';
import type { StandingEntry } from '../types/league';
import type { MatchFixture, MatchResult } from '../types/match';
import type { GameWorld } from '../engine/season/season-manager';
import MatchDetailModal from '../components/MatchDetailModal';
import {
  getTeamName,
  formatForm,
  getLeagueName,
  getCoachName,
} from '../utils/format';
import { leagueConfigs } from '../config/competitions';

export default function League() {
  const { level } = useParams<{ level: string }>();
  const world = useGameStore((s) => s.world);
  const [expandedRound, setExpandedRound] = useState<number | null>(null);
  const [tab, setTab] = useState<'standings' | 'schedule' | 'trend'>('standings');

  // Modal state
  const [selectedFixture, setSelectedFixture] = useState<MatchFixture | null>(null);
  const [selectedResult, setSelectedResult] = useState<MatchResult | null>(null);

  const leagueLevel = parseInt(level ?? '1', 10) as 1 | 2 | 3;

  if (!world) {
    return <div className="text-slate-400">正在加载...</div>;
  }

  const config = leagueConfigs.find((c) => c.level === leagueLevel);
  if (!config) {
    return <div className="text-slate-400">未找到联赛配置</div>;
  }

  const standingsMap: Record<number, StandingEntry[]> = {
    1: world.league1Standings,
    2: world.league2Standings,
    3: world.league3Standings,
  };
  const standings = standingsMap[leagueLevel] ?? [];
  const totalTeams = standings.length;
  const directPromo = config.directPromotion;
  const playoffPromo = config.playoffPromotion;
  const directReleg = config.directRelegation;
  const playoffReleg = config.playoffRelegation;

  // Season stats
  const totalPlayed = standings.reduce((s, e) => s + e.played, 0) / 2;
  const totalGoals = standings.reduce((s, e) => s + e.goalsFor, 0);
  const avgGoals = totalPlayed > 0 ? (totalGoals / totalPlayed).toFixed(2) : '0.00';

  // Find top scorer team (most goals for)
  const topScorer = standings.length > 0
    ? standings.reduce((best, e) => (e.goalsFor > best.goalsFor ? e : best), standings[0])
    : null;

  function getRowZone(pos: number): 'promo' | 'playoff-promo' | 'playoff-releg' | 'releg' | 'mid' {
    if (leagueLevel > 1) {
      if (pos <= directPromo) return 'promo';
      if (pos <= directPromo + playoffPromo) return 'playoff-promo';
    }
    if (leagueLevel < 3) {
      if (pos > totalTeams - directReleg) return 'releg';
      if (pos > totalTeams - directReleg - playoffReleg) return 'playoff-releg';
    }
    return 'mid';
  }

  function getRowBgClass(zone: string): string {
    switch (zone) {
      case 'promo':
        return 'bg-green-900/20';
      case 'playoff-promo':
        return 'bg-amber-900/15';
      case 'releg':
        return 'bg-red-900/20';
      case 'playoff-releg':
        return 'bg-amber-900/15';
      default:
        return '';
    }
  }

  function getPosBadgeClass(zone: string): string {
    switch (zone) {
      case 'promo':
        return 'bg-green-600 text-white';
      case 'playoff-promo':
        return 'bg-amber-600 text-white';
      case 'releg':
        return 'bg-red-600 text-white';
      case 'playoff-releg':
        return 'bg-amber-600 text-white';
      default:
        return 'bg-slate-700 text-slate-400';
    }
  }

  // Check if zone changes at this position (for separators)
  function isZoneBoundary(pos: number): boolean {
    if (pos <= 1) return false;
    return getRowZone(pos) !== getRowZone(pos - 1);
  }

  // Collect league round data
  const leagueWindows = world.seasonState.calendar.filter((w) => w.type === 'league');

  type RoundData = {
    windowId: number;
    windowIndex: number;
    label: string;
    completed: boolean;
    fixtures: MatchFixture[];
    results: MatchResult[];
  };

  const rounds: RoundData[] = [];
  for (const win of leagueWindows) {
    const winIdx = world.seasonState.calendar.indexOf(win);
    const levelFixtures = win.fixtures.filter((f) => {
      const homeState = world.teamStates[f.homeTeamId];
      return homeState && homeState.leagueLevel === leagueLevel;
    });
    const levelResults = win.results.filter((r) => {
      const homeState = world.teamStates[r.homeTeamId];
      return homeState && homeState.leagueLevel === leagueLevel;
    });
    if (levelFixtures.length > 0 || levelResults.length > 0) {
      rounds.push({
        windowId: win.id,
        windowIndex: winIdx,
        label: win.label,
        completed: win.completed,
        fixtures: levelFixtures,
        results: levelResults,
      });
    }
  }

  // Find fixture for a result
  const findFixtureForResult = (result: MatchResult): MatchFixture => {
    for (const win of world.seasonState.calendar) {
      const f = win.fixtures.find((fx) => fx.id === result.fixtureId);
      if (f) return f;
    }
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
    setSelectedFixture(fixture);
    setSelectedResult(result);
  };

  const closeModal = () => {
    setSelectedFixture(null);
    setSelectedResult(null);
  };

  return (
    <div className="max-w-5xl space-y-6">
      {/* ═══════ Header ═══════ */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <h2 className="text-lg sm:text-xl font-bold text-slate-100">{getLeagueName(leagueLevel)}</h2>
        <div className="flex bg-slate-800 rounded-lg border border-slate-700 p-0.5">
          <button
            onClick={() => setTab('standings')}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer ${
              tab === 'standings'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            积分榜
          </button>
          <button
            onClick={() => setTab('schedule')}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer ${
              tab === 'schedule'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            赛程表
          </button>
          <button
            onClick={() => setTab('trend')}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer ${
              tab === 'trend' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            走势
          </button>
        </div>
      </div>

      {/* Zone legend */}
      <div className="flex gap-4 text-xs text-slate-400 flex-wrap">
        {leagueLevel > 1 && directPromo > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-green-600 inline-block" /> 直接升级
          </span>
        )}
        {(playoffPromo > 0 || playoffReleg > 0) && (
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-amber-600 inline-block" /> 附加赛
          </span>
        )}
        {leagueLevel < 3 && directReleg > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-red-600 inline-block" /> 直接降级
          </span>
        )}
        <span className="text-slate-600">|</span>
        <span className="text-slate-500">
          共 {config.rounds} 轮 - {totalTeams} 队 - 双循环
        </span>
      </div>

      {/* ═══════ TAB: 积分榜 ═══════ */}
      {tab === 'standings' && (
        <>
          {/* Season stats bar */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 flex flex-wrap gap-6 text-sm">
            <div>
              <span className="text-slate-500">已赛场次</span>
              <span className="ml-2 text-slate-200 font-semibold">{totalPlayed}</span>
            </div>
            <div>
              <span className="text-slate-500">总进球</span>
              <span className="ml-2 text-slate-200 font-semibold">{totalGoals}</span>
            </div>
            <div>
              <span className="text-slate-500">场均进球</span>
              <span className="ml-2 text-slate-200 font-semibold">{avgGoals}</span>
            </div>
            {topScorer && (
              <div>
                <span className="text-slate-500">进攻最强</span>
                <span className="ml-2 text-slate-200 font-semibold">
                  {getTeamName(topScorer.teamId, world.teamBases)} ({topScorer.goalsFor}球)
                </span>
              </div>
            )}
          </div>

          {/* Standings table */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-400 border-b border-slate-700">
                    <th className="text-center px-1.5 sm:px-2 py-2 w-8 sm:w-10">#</th>
                    <th className="text-left px-1.5 sm:px-2 py-2">球队</th>
                    <th className="text-center px-1 sm:px-2 py-2">赛</th>
                    <th className="hidden sm:table-cell text-center px-2 py-2">胜</th>
                    <th className="hidden sm:table-cell text-center px-2 py-2">平</th>
                    <th className="hidden sm:table-cell text-center px-2 py-2">负</th>
                    <th className="hidden md:table-cell text-center px-2 py-2">进</th>
                    <th className="hidden md:table-cell text-center px-2 py-2">失</th>
                    <th className="text-center px-1 sm:px-2 py-2">净胜</th>
                    <th className="text-center px-1.5 sm:px-2 py-2 font-semibold">分</th>
                    <th className="text-center px-1 sm:px-2 py-2">近况</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((entry, i) => {
                    const pos = i + 1;
                    const zone = getRowZone(pos);
                    const teamBase = world.teamBases[entry.teamId];
                    const boundary = isZoneBoundary(pos);

                    return (
                      <tr
                        key={entry.teamId}
                        className={`border-t hover:bg-slate-700/30 transition-all hover-lift ${
                          boundary ? 'border-t-2' : 'border-slate-700/50'
                        } ${
                          boundary && (zone === 'releg' || zone === 'playoff-releg')
                            ? 'border-t-red-600/40'
                            : boundary
                            ? 'border-t-green-600/40'
                            : ''
                        } ${getRowBgClass(zone)}`}
                      >
                        <td className="text-center px-1.5 sm:px-2 py-2">
                          <div className="flex items-center justify-center gap-0.5">
                            <span className={`inline-flex items-center justify-center w-5 h-5 sm:w-6 sm:h-6 rounded-md text-[10px] sm:text-xs font-bold ${getPosBadgeClass(zone)}`}>
                              {pos}
                            </span>
                            {entry.previousPosition != null && entry.played > 0 && (() => {
                              const diff = entry.previousPosition - pos;
                              if (diff > 0) return <span className="text-[9px] text-green-400">▲</span>;
                              if (diff < 0) return <span className="text-[9px] text-red-400">▼</span>;
                              return <span className="text-[9px] text-slate-600">—</span>;
                            })()}
                          </div>
                        </td>
                        <td className="px-1.5 sm:px-2 py-2">
                          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                            <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full shrink-0" style={{ backgroundColor: teamBase?.color ?? '#64748b' }} />
                            <Link to={`/team/${entry.teamId}`} className="text-slate-200 hover:text-blue-400 transition-colors truncate text-xs sm:text-sm">
                              {getTeamName(entry.teamId, world.teamBases)}
                            </Link>
                          </div>
                        </td>
                        <td className="text-center px-1 sm:px-2 py-2 text-slate-400 text-xs sm:text-sm">{entry.played}</td>
                        <td className="hidden sm:table-cell text-center px-2 py-2 text-slate-300">{entry.won}</td>
                        <td className="hidden sm:table-cell text-center px-2 py-2 text-slate-300">{entry.drawn}</td>
                        <td className="hidden sm:table-cell text-center px-2 py-2 text-slate-300">{entry.lost}</td>
                        <td className="hidden md:table-cell text-center px-2 py-2 text-slate-300">{entry.goalsFor}</td>
                        <td className="hidden md:table-cell text-center px-2 py-2 text-slate-300">{entry.goalsAgainst}</td>
                        <td className="text-center px-1 sm:px-2 py-2 text-slate-300 text-xs sm:text-sm">
                          {entry.goalDifference > 0 ? `+${entry.goalDifference}` : entry.goalDifference}
                        </td>
                        <td className="text-center px-1.5 sm:px-2 py-2 font-bold text-sm sm:text-lg text-slate-100">{entry.points}</td>
                        <td className="text-center px-1 sm:px-2 py-2">
                          <div className="flex gap-0.5 justify-center">
                            {formatForm(entry.form.slice(-5)).map((f, fi) => (
                              <span key={fi} className={`inline-flex items-center justify-center w-4 h-4 sm:w-5 sm:h-5 rounded text-[9px] sm:text-[10px] font-bold text-white ${f.color}`}>
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
          </div>
        </>
      )}

      {/* ═══════ TAB: 赛程表 ═══════ */}
      {tab === 'schedule' && (
        <div className="space-y-2">
          {rounds.length === 0 && (
            <p className="text-sm text-slate-500">暂无赛程数据</p>
          )}
          {rounds.map((round, roundIdx) => {
            const isExpanded = expandedRound === round.windowId;
            const isCurrent =
              round.windowIndex === world.seasonState.currentWindowIndex;

            return (
              <div
                key={round.windowId}
                className={`bg-slate-800 rounded-xl border overflow-hidden transition-colors ${
                  isCurrent
                    ? 'border-blue-500/50 shadow-lg shadow-blue-900/10'
                    : 'border-slate-700'
                }`}
              >
                <button
                  onClick={() =>
                    setExpandedRound(isExpanded ? null : round.windowId)
                  }
                  className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-slate-700/30 cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        round.completed
                          ? 'bg-green-500'
                          : isCurrent
                          ? 'bg-blue-500 animate-pulse'
                          : 'bg-slate-600'
                      }`}
                    />
                    <span
                      className={`font-medium ${
                        round.completed
                          ? 'text-slate-300'
                          : isCurrent
                          ? 'text-blue-300'
                          : 'text-slate-400'
                      }`}
                    >
                      第 {roundIdx + 1} 轮
                    </span>
                    {isCurrent && (
                      <span className="text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded-md font-semibold">
                        当前
                      </span>
                    )}
                    {round.completed && (
                      <span className="text-xs text-green-500">已完成</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">
                      {round.completed ? round.results.length : round.fixtures.length}{' '}
                      场
                    </span>
                    <span className="text-slate-500 text-lg">
                      {isExpanded ? '\u2212' : '+'}
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-700 p-3 space-y-2">
                    {round.completed
                      ? /* ──── Completed: show results ──── */
                        round.results.map((r) => {
                          const homeTeam = world.teamBases[r.homeTeamId];
                          const awayTeam = world.teamBases[r.awayTeamId];
                          const homeWon = r.homeGoals > r.awayGoals;
                          const awayWon = r.awayGoals > r.homeGoals;

                          return (
                            <div
                              key={r.fixtureId}
                              onClick={() => handleResultClick(r)}
                              className="flex items-center text-sm py-2 px-3 rounded-lg hover:bg-slate-700/40 cursor-pointer transition-colors"
                            >
                              <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0">
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{
                                    backgroundColor:
                                      homeTeam?.color ?? '#64748b',
                                  }}
                                />
                                <span
                                  className={`truncate pr-2 ${
                                    homeWon
                                      ? 'text-green-400 font-bold'
                                      : 'text-slate-200'
                                  }`}
                                >
                                  {getTeamName(r.homeTeamId, world.teamBases)}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 px-2 shrink-0">
                                <span
                                  className={`font-bold text-lg ${
                                    homeWon
                                      ? 'text-green-400'
                                      : awayWon
                                      ? 'text-red-400'
                                      : 'text-slate-300'
                                  }`}
                                >
                                  {r.homeGoals}
                                </span>
                                <span className="text-slate-600">:</span>
                                <span
                                  className={`font-bold text-lg ${
                                    awayWon
                                      ? 'text-green-400'
                                      : homeWon
                                      ? 'text-red-400'
                                      : 'text-slate-300'
                                  }`}
                                >
                                  {r.awayGoals}
                                </span>
                                {r.extraTime && (
                                  <span className="text-xs text-amber-400 ml-1">
                                    {r.penalties
                                      ? `(P ${r.penaltyHome}-${r.penaltyAway})`
                                      : '(加时)'}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                <span
                                  className={`truncate pl-2 ${
                                    awayWon
                                      ? 'text-green-400 font-bold'
                                      : 'text-slate-200'
                                  }`}
                                >
                                  {getTeamName(r.awayTeamId, world.teamBases)}
                                </span>
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{
                                    backgroundColor:
                                      awayTeam?.color ?? '#64748b',
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })
                      : /* ──── Upcoming: show fixtures with predictions ──── */
                        round.fixtures.map((fixture) => {
                          const homeTeam = world.teamBases[fixture.homeTeamId];
                          const awayTeam = world.teamBases[fixture.awayTeamId];
                          const homeState =
                            world.teamStates[fixture.homeTeamId];
                          const awayState =
                            world.teamStates[fixture.awayTeamId];
                          const homeCoach = homeState?.currentCoachId
                            ? world.coachBases[homeState.currentCoachId] ?? null
                            : null;
                          const awayCoach = awayState?.currentCoachId
                            ? world.coachBases[awayState.currentCoachId] ?? null
                            : null;

                          if (
                            !homeTeam ||
                            !awayTeam ||
                            !homeState ||
                            !awayState
                          )
                            return null;

                          const pred = predictMatch(
                            homeTeam,
                            awayTeam,
                            homeState,
                            awayState,
                            homeCoach,
                            awayCoach
                          );

                          return (
                            <div
                              key={fixture.id}
                              onClick={() => handleFixtureClick(fixture)}
                              className="bg-slate-700/20 rounded-lg p-3 space-y-2 hover:bg-slate-700/40 cursor-pointer transition-colors"
                            >
                              <div className="flex items-center">
                                <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0">
                                  <span
                                    className="w-2 h-2 rounded-full shrink-0"
                                    style={{
                                      backgroundColor: homeTeam.color,
                                    }}
                                  />
                                  <span className="text-sm font-medium text-slate-200 truncate">
                                    {homeTeam.name}
                                  </span>
                                  <span className="text-xs text-green-500 shrink-0">
                                    (主)
                                  </span>
                                </div>
                                <div className="text-center px-3 shrink-0">
                                  <div className="text-sm font-bold text-slate-400">
                                    VS
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                  <span className="text-xs text-slate-500 shrink-0">
                                    (客)
                                  </span>
                                  <span className="text-sm font-medium text-slate-200 truncate">
                                    {awayTeam.name}
                                  </span>
                                  <span
                                    className="w-2 h-2 rounded-full shrink-0"
                                    style={{
                                      backgroundColor: awayTeam.color,
                                    }}
                                  />
                                </div>
                              </div>
                              {/* Mini prediction bar */}
                              <div>
                                <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-700">
                                  <div
                                    className="bg-green-500"
                                    style={{
                                      width: `${pred.homeWinPct}%`,
                                    }}
                                  />
                                  <div
                                    className="bg-slate-400"
                                    style={{
                                      width: `${pred.drawPct}%`,
                                    }}
                                  />
                                  <div
                                    className="bg-red-500"
                                    style={{
                                      width: `${pred.awayWinPct}%`,
                                    }}
                                  />
                                </div>
                                <div className="flex justify-between text-[10px] mt-0.5">
                                  <span className="text-green-400">
                                    {pred.homeWinPct}%
                                  </span>
                                  <span className="text-slate-500">
                                    {pred.verdict}
                                  </span>
                                  <span className="text-red-400">
                                    {pred.awayWinPct}%
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ═══════ TAB: 走势 ═══════ */}
      {tab === 'trend' && (
        <TrendChart rounds={rounds} standings={standings} world={world} leagueLevel={leagueLevel} />
      )}

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

// ══════════════════════════════════════════════════════════════
//  Trend chart — points accumulation per round (pure CSS)
// ══════════════════════════════════════════════════════════════

function TrendChart({ rounds, standings, world, leagueLevel }: {
  rounds: any[];
  standings: StandingEntry[];
  world: GameWorld;
  leagueLevel: number;
}) {
  // Build cumulative points per team per round
  const completedRounds = rounds.filter(r => r.completed && r.results.length > 0);
  if (completedRounds.length === 0) {
    return <p className="text-sm text-slate-500 text-center py-8">暂无数据，至少完成一轮联赛后显示走势图</p>;
  }

  const teamIds = standings.map(s => s.teamId);
  // Only show top 6 teams for readability
  const showTeams = teamIds.slice(0, Math.min(6, teamIds.length));

  // Accumulate points round by round
  const cumPoints: Record<string, number[]> = {};
  for (const tid of showTeams) cumPoints[tid] = [];

  const runningPoints: Record<string, number> = {};
  for (const tid of showTeams) runningPoints[tid] = 0;

  for (const round of completedRounds) {
    for (const r of round.results) {
      if (!showTeams.includes(r.homeTeamId) && !showTeams.includes(r.awayTeamId)) continue;
      const hw = r.homeGoals > r.awayGoals;
      const aw = r.awayGoals > r.homeGoals;
      if (showTeams.includes(r.homeTeamId)) {
        runningPoints[r.homeTeamId] += hw ? 3 : (!hw && !aw) ? 1 : 0;
      }
      if (showTeams.includes(r.awayTeamId)) {
        runningPoints[r.awayTeamId] += aw ? 3 : (!hw && !aw) ? 1 : 0;
      }
    }
    for (const tid of showTeams) {
      cumPoints[tid].push(runningPoints[tid]);
    }
  }

  const maxPts = Math.max(...showTeams.map(tid => cumPoints[tid][cumPoints[tid].length - 1] ?? 0), 1);
  const chartH = 200;
  const roundCount = completedRounds.length;

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
        积分走势 (前{showTeams.length}名)
      </h3>

      {/* Chart area */}
      <div className="relative overflow-x-auto">
        <svg
          viewBox={`0 0 ${Math.max(roundCount * 30 + 20, 300)} ${chartH + 30}`}
          className="w-full min-w-[300px]"
          style={{ height: `${chartH + 30}px` }}
        >
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map(ratio => {
            const y = chartH - ratio * chartH + 10;
            const pts = Math.round(ratio * maxPts);
            return (
              <g key={ratio}>
                <line x1="30" y1={y} x2={roundCount * 30 + 20} y2={y} stroke="#334155" strokeWidth="0.5" />
                <text x="0" y={y + 3} fill="#64748b" fontSize="9">{pts}</text>
              </g>
            );
          })}

          {/* Team lines */}
          {showTeams.map((tid, ti) => {
            const pts = cumPoints[tid];
            const color = world.teamBases[tid]?.color ?? '#888';
            const points = pts.map((p, i) => {
              const x = 30 + i * ((roundCount > 1 ? (roundCount * 30 - 30) / (roundCount - 1) : 0));
              const y = chartH - (p / maxPts) * chartH + 10;
              return `${x},${y}`;
            }).join(' ');

            return (
              <g key={tid}>
                <polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" points={points} opacity="0.85" />
                {/* End dot */}
                {pts.length > 0 && (
                  <circle
                    cx={30 + (pts.length - 1) * ((roundCount > 1 ? (roundCount * 30 - 30) / (roundCount - 1) : 0))}
                    cy={chartH - (pts[pts.length - 1] / maxPts) * chartH + 10}
                    r="3" fill={color}
                  />
                )}
              </g>
            );
          })}

          {/* Round labels */}
          {completedRounds.map((_, i) => {
            if (roundCount > 15 && i % 3 !== 0) return null;
            const x = 30 + i * ((roundCount > 1 ? (roundCount * 30 - 30) / (roundCount - 1) : 0));
            return <text key={i} x={x} y={chartH + 25} fill="#64748b" fontSize="8" textAnchor="middle">{i + 1}</text>;
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3">
        {showTeams.map(tid => {
          const team = world.teamBases[tid];
          const pts = cumPoints[tid][cumPoints[tid].length - 1] ?? 0;
          return (
            <div key={tid} className="flex items-center gap-1.5 text-xs">
              <span className="w-3 h-1 rounded-full shrink-0" style={{ backgroundColor: world.teamBases[tid]?.color ?? '#888' }} />
              <Link to={`/team/${tid}`} className="text-slate-300 hover:text-blue-400">{getTeamName(tid, world.teamBases)}</Link>
              <span className="text-slate-500">{pts}分</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

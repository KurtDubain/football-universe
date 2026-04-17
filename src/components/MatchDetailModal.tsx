import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { MatchFixture, MatchResult, MatchEvent } from '../types/match';
import type { GameWorld } from '../engine/season/season-manager';
import { predictMatch, MatchPrediction } from '../engine/match/prediction';
import {
  getTeamName,
  getTeamShortName,
  getCoachName,
  getCoachStyleLabel,
  formatForm,
} from '../utils/format';

// ── Props ──────────────────────────────────────────────────────────

export interface MatchDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  fixture?: MatchFixture;
  result?: MatchResult;
  world: GameWorld;
}

// ── Component ──────────────────────────────────────────────────────

export default function MatchDetailModal({
  isOpen,
  onClose,
  fixture,
  result,
  world,
}: MatchDetailModalProps) {
  if (!isOpen || !fixture) return null;

  const homeTeam = world.teamBases[fixture.homeTeamId];
  const awayTeam = world.teamBases[fixture.awayTeamId];
  const homeState = world.teamStates[fixture.homeTeamId];
  const awayState = world.teamStates[fixture.awayTeamId];
  const homeCoach = homeState?.currentCoachId
    ? world.coachBases[homeState.currentCoachId] ?? null
    : null;
  const awayCoach = awayState?.currentCoachId
    ? world.coachBases[awayState.currentCoachId] ?? null
    : null;

  if (!homeTeam || !awayTeam) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl max-w-2xl w-full sm:mx-4 max-h-[85vh] sm:max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-200 text-xl leading-none cursor-pointer z-10 p-3"
          style={{ position: 'sticky', float: 'right', marginTop: '4px', marginRight: '4px' }}
        >
          &#x2715;
        </button>

        {result ? (
          <PostMatchView
            fixture={fixture}
            result={result}
            world={world}
            homeTeam={homeTeam}
            awayTeam={awayTeam}
          />
        ) : (
          <PreMatchView
            fixture={fixture}
            world={world}
            homeTeam={homeTeam}
            awayTeam={awayTeam}
            homeState={homeState}
            awayState={awayState}
            homeCoach={homeCoach}
            awayCoach={awayCoach}
          />
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  PRE-MATCH VIEW
// ══════════════════════════════════════════════════════════════════════

function PreMatchView({
  fixture,
  world,
  homeTeam,
  awayTeam,
  homeState,
  awayState,
  homeCoach,
  awayCoach,
}: {
  fixture: MatchFixture;
  world: GameWorld;
  homeTeam: any;
  awayTeam: any;
  homeState: any;
  awayState: any;
  homeCoach: any;
  awayCoach: any;
}) {
  const prediction: MatchPrediction | null = useMemo(() => {
    if (!homeState || !awayState) return null;
    return predictMatch(homeTeam, awayTeam, homeState, awayState, homeCoach, awayCoach);
  }, [homeTeam, awayTeam, homeState, awayState, homeCoach, awayCoach]);

  if (!prediction || !homeState || !awayState) return null;

  return (
    <div>
      {/* ──── Header with team colors ──── */}
      <div
        className="flex items-stretch rounded-t-2xl overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${homeTeam.color}22 0%, transparent 40%, transparent 60%, ${awayTeam.color}22 100%)`,
        }}
      >
        <div
          className="w-1.5 shrink-0"
          style={{ backgroundColor: homeTeam.color }}
        />
        <div className="flex-1 flex items-center justify-between px-3 sm:px-5 py-3 sm:py-5">
          {/* Home team */}
          <div className="flex-1 min-w-0">
            <Link
              to={`/team/${fixture.homeTeamId}`}
              className="text-lg font-bold text-slate-100 hover:text-blue-400 transition-colors"
            >
              {homeTeam.shortName}
            </Link>
            <span className="ml-2 text-xs font-semibold px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">
              综合 {homeTeam.overall}
            </span>
            <span className="ml-1.5 text-xs text-green-400">(主)</span>
          </div>

          {/* VS */}
          <div className="text-center px-4 shrink-0">
            <div className="text-2xl font-black text-slate-500">VS</div>
            <div className="text-xs text-slate-600 mt-0.5">
              {fixture.competitionName} - {fixture.roundLabel}
            </div>
          </div>

          {/* Away team */}
          <div className="flex-1 min-w-0 text-right">
            <span className="mr-1.5 text-xs text-slate-500">(客)</span>
            <span className="mr-2 text-xs font-semibold px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">
              综合 {awayTeam.overall}
            </span>
            <Link
              to={`/team/${fixture.awayTeamId}`}
              className="text-lg font-bold text-slate-100 hover:text-blue-400 transition-colors"
            >
              {awayTeam.shortName}
            </Link>
          </div>
        </div>
        <div
          className="w-1.5 shrink-0"
          style={{ backgroundColor: awayTeam.color }}
        />
      </div>

      {/* ──── Coach info row ──── */}
      <div className="flex items-center justify-between px-6 py-2 border-b border-slate-700/50 text-xs text-slate-400">
        <div>
          {homeCoach ? (
            <>
              <span className="text-slate-300">{homeCoach.name}</span>
              <span className="mx-1">-</span>
              <span>{getCoachStyleLabel(homeCoach.style)}</span>
              <span className="ml-1 text-slate-500">({homeCoach.rating})</span>
            </>
          ) : (
            <span className="text-slate-600">教练空缺</span>
          )}
        </div>
        <div>
          {awayCoach ? (
            <>
              <span className="text-slate-500">({awayCoach.rating})</span>
              <span className="mr-1">{getCoachStyleLabel(awayCoach.style)}</span>
              <span className="mx-1">-</span>
              <span className="text-slate-300">{awayCoach.name}</span>
            </>
          ) : (
            <span className="text-slate-600">教练空缺</span>
          )}
        </div>
      </div>

      {/* ──── Win probability bar ──── */}
      <div className="px-6 py-4">
        <div className="flex h-5 rounded-full overflow-hidden bg-slate-700 mb-2">
          <div
            className="bg-green-500 flex items-center justify-center text-[10px] font-bold text-white transition-all"
            style={{ width: `${prediction.homeWinPct}%` }}
          >
            {prediction.homeWinPct > 12 && `${prediction.homeWinPct}%`}
          </div>
          <div
            className="bg-slate-500 flex items-center justify-center text-[10px] font-bold text-white transition-all"
            style={{ width: `${prediction.drawPct}%` }}
          >
            {prediction.drawPct > 10 && `${prediction.drawPct}%`}
          </div>
          <div
            className="bg-red-500 flex items-center justify-center text-[10px] font-bold text-white transition-all"
            style={{ width: `${prediction.awayWinPct}%` }}
          >
            {prediction.awayWinPct > 12 && `${prediction.awayWinPct}%`}
          </div>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-green-400">主胜 {prediction.homeWinPct}%</span>
          <span className="text-slate-400">平局 {prediction.drawPct}%</span>
          <span className="text-red-400">客胜 {prediction.awayWinPct}%</span>
        </div>
        {/* Predicted score */}
        <div className="text-center mt-3">
          <span className="text-sm text-slate-500">预测比分</span>
          <div className="text-3xl font-black text-slate-200 tracking-wider mt-0.5">
            {prediction.predictedHomeGoals} - {prediction.predictedAwayGoals}
          </div>
        </div>
      </div>

      {/* ──── State comparison table ──── */}
      <div className="px-6 pb-4">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
          状态对比
        </h4>
        <div className="space-y-1.5">
          <ComparisonRow
            label="士气"
            homeVal={homeState.morale}
            awayVal={awayState.morale}
            max={100}
          />
          <ComparisonRow
            label="体能"
            homeVal={100 - homeState.fatigue}
            awayVal={100 - awayState.fatigue}
            max={100}
          />
          <MomentumRow
            label="势头"
            homeVal={homeState.momentum}
            awayVal={awayState.momentum}
          />
          <ComparisonRow
            label="阵容健康"
            homeVal={homeState.squadHealth}
            awayVal={awayState.squadHealth}
            max={100}
          />
          <ComparisonRow
            label="教练压力"
            homeVal={homeState.coachPressure}
            awayVal={awayState.coachPressure}
            max={100}
            invertColor
          />
          {/* Recent form */}
          <div className="flex items-center py-1">
            <div className="flex-1 flex justify-end gap-0.5 pr-3">
              {formatForm(homeState.recentForm?.slice(-5) ?? []).map((f, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold text-white ${f.color}`}
                >
                  {f.label}
                </span>
              ))}
              {(!homeState.recentForm || homeState.recentForm.length === 0) && (
                <span className="text-xs text-slate-600">-</span>
              )}
            </div>
            <span className="text-xs text-slate-500 w-16 text-center shrink-0">近况</span>
            <div className="flex-1 flex gap-0.5 pl-3">
              {formatForm(awayState.recentForm?.slice(-5) ?? []).map((f, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold text-white ${f.color}`}
                >
                  {f.label}
                </span>
              ))}
              {(!awayState.recentForm || awayState.recentForm.length === 0) && (
                <span className="text-xs text-slate-600">-</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ──── Base stats comparison (dual bar) ──── */}
      <div className="px-6 pb-4">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
          实力对比
        </h4>
        <div className="space-y-1.5">
          <DualBar label="进攻" homeVal={homeTeam.attack} awayVal={awayTeam.attack} homeColor={homeTeam.color} awayColor={awayTeam.color} />
          <DualBar label="中场" homeVal={homeTeam.midfield} awayVal={awayTeam.midfield} homeColor={homeTeam.color} awayColor={awayTeam.color} />
          <DualBar label="防守" homeVal={homeTeam.defense} awayVal={awayTeam.defense} homeColor={homeTeam.color} awayColor={awayTeam.color} />
          <DualBar label="稳定" homeVal={homeTeam.stability} awayVal={awayTeam.stability} homeColor={homeTeam.color} awayColor={awayTeam.color} />
          <DualBar label="深度" homeVal={homeTeam.depth} awayVal={awayTeam.depth} homeColor={homeTeam.color} awayColor={awayTeam.color} />
        </div>
      </div>

      {/* ──── Verdict + Hot Tip ──── */}
      <div className="px-6 pb-5">
        <div className="bg-slate-700/60 rounded-xl p-4 space-y-2">
          <div className="text-sm text-slate-200 font-medium">{prediction.verdict}</div>
          {prediction.hotTip && (
            <div className="text-xs text-amber-400 bg-amber-900/30 rounded-lg px-3 py-2">
              {prediction.hotTip}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  POST-MATCH VIEW
// ══════════════════════════════════════════════════════════════════════

function PostMatchView({
  fixture,
  result,
  world,
  homeTeam,
  awayTeam,
}: {
  fixture: MatchFixture;
  result: MatchResult;
  world: GameWorld;
  homeTeam: any;
  awayTeam: any;
}) {
  const totalHome = result.homeGoals + (result.etHomeGoals ?? 0);
  const totalAway = result.awayGoals + (result.etAwayGoals ?? 0);
  const homeWon = totalHome > totalAway;
  const awayWon = totalAway > totalHome;
  const isDraw = totalHome === totalAway;

  // For penalties, determine winner
  const penaltyHomeWon = result.penalties && (result.penaltyHome ?? 0) > (result.penaltyAway ?? 0);
  const penaltyAwayWon = result.penalties && (result.penaltyAway ?? 0) > (result.penaltyHome ?? 0);

  const goalEvents = result.events.filter(
    (e) => e.type === 'goal' || e.type === 'penalty_goal' || e.type === 'own_goal'
  );
  const homeGoalEvents = goalEvents.filter((e) =>
    (e.type === 'own_goal' ? e.teamId !== fixture.homeTeamId : e.teamId === fixture.homeTeamId)
  );
  const awayGoalEvents = goalEvents.filter((e) =>
    (e.type === 'own_goal' ? e.teamId !== fixture.awayTeamId : e.teamId === fixture.awayTeamId)
  );

  return (
    <div>
      {/* ──── Score header ──── */}
      <div
        className="rounded-t-2xl overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${homeTeam.color}22 0%, transparent 40%, transparent 60%, ${awayTeam.color}22 100%)`,
        }}
      >
        <div className="flex items-center justify-between px-6 py-6">
          {/* Home team name */}
          <div className="flex-1 min-w-0">
            <Link
              to={`/team/${fixture.homeTeamId}`}
              className={`text-lg font-bold transition-colors ${
                homeWon || penaltyHomeWon ? 'text-green-400' : 'text-slate-300'
              } hover:text-blue-400`}
            >
              {homeTeam.name}
            </Link>
          </div>

          {/* Score */}
          <div className="text-center px-4 shrink-0">
            <div className="flex items-center gap-3">
              <span
                className={`text-4xl font-black ${
                  homeWon || penaltyHomeWon ? 'text-green-400' : isDraw && !result.penalties ? 'text-slate-300' : 'text-slate-500'
                }`}
              >
                {result.homeGoals}
              </span>
              <span className="text-2xl text-slate-600">:</span>
              <span
                className={`text-4xl font-black ${
                  awayWon || penaltyAwayWon ? 'text-green-400' : isDraw && !result.penalties ? 'text-slate-300' : 'text-slate-500'
                }`}
              >
                {result.awayGoals}
              </span>
            </div>
            {/* ET / Penalty indicator */}
            <div className="text-xs text-slate-500 mt-1 space-x-2">
              <span>{result.competitionName} - {result.roundLabel}</span>
              {result.extraTime && (
                <span className="text-amber-400">
                  加时 {result.etHomeGoals ?? 0}-{result.etAwayGoals ?? 0}
                  {result.penalties && ` · 点球 ${result.penaltyHome}-${result.penaltyAway}`}
                </span>
              )}
            </div>
          </div>

          {/* Away team name */}
          <div className="flex-1 min-w-0 text-right">
            <Link
              to={`/team/${fixture.awayTeamId}`}
              className={`text-lg font-bold transition-colors ${
                awayWon || penaltyAwayWon ? 'text-green-400' : 'text-slate-300'
              } hover:text-blue-400`}
            >
              {awayTeam.name}
            </Link>
          </div>
        </div>
      </div>

      {/* ──── Half-time score ──── */}
      {(() => {
        const firstHalfGoals = goalEvents.filter(e => e.minute <= 45);
        const htHome = firstHalfGoals.filter(e => e.teamId === fixture.homeTeamId).length;
        const htAway = firstHalfGoals.filter(e => e.teamId === fixture.awayTeamId).length;
        return (
          <div className="px-6 py-2 border-b border-slate-700/50 flex items-center justify-center gap-4 text-xs">
            <span className="text-slate-500">上半场</span>
            <span className="font-bold text-slate-300">{htHome} - {htAway}</span>
            <span className="text-slate-700">|</span>
            <span className="text-slate-500">下半场</span>
            <span className="font-bold text-slate-300">{result.homeGoals - htHome} - {result.awayGoals - htAway}</span>
            {result.extraTime && (
              <>
                <span className="text-slate-700">|</span>
                <span className="text-slate-500">加时</span>
                <span className="font-bold text-amber-400">{result.etHomeGoals ?? 0} - {result.etAwayGoals ?? 0}</span>
              </>
            )}
          </div>
        );
      })()}

      {/* ──── Goal timeline ──── */}
      {goalEvents.length > 0 && (
        <div className="px-6 py-4 border-b border-slate-700/50">
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            进球时间线
          </h4>
          <div className="space-y-1.5">
            {goalEvents
              .sort((a, b) => a.minute - b.minute)
              .map((event, i) => {
                const isHomeGoal =
                  event.type === 'own_goal'
                    ? event.teamId !== fixture.homeTeamId
                    : event.teamId === fixture.homeTeamId;
                return (
                  <div key={i} className="flex items-center text-sm">
                    {isHomeGoal ? (
                      <>
                        <div className="flex-1 text-right pr-3">
                          <span className="text-slate-300">{event.description}</span>
                          {event.type === 'own_goal' && (
                            <span className="text-red-400 text-xs ml-1">(乌龙球)</span>
                          )}
                          {event.type === 'penalty_goal' && (
                            <span className="text-amber-400 text-xs ml-1">(P)</span>
                          )}
                        </div>
                        <span className="w-10 text-center text-xs font-mono text-amber-400 bg-slate-700 rounded px-1.5 py-0.5 shrink-0">
                          {event.minute}'
                        </span>
                        <div className="flex-1 pl-3" />
                      </>
                    ) : (
                      <>
                        <div className="flex-1 pr-3" />
                        <span className="w-10 text-center text-xs font-mono text-amber-400 bg-slate-700 rounded px-1.5 py-0.5 shrink-0">
                          {event.minute}'
                        </span>
                        <div className="flex-1 text-left pl-3">
                          <span className="text-slate-300">{event.description}</span>
                          {event.type === 'own_goal' && (
                            <span className="text-red-400 text-xs ml-1">(乌龙球)</span>
                          )}
                          {event.type === 'penalty_goal' && (
                            <span className="text-amber-400 text-xs ml-1">(P)</span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* ──── Match stats bars ──── */}
      <div className="px-6 py-4 border-b border-slate-700/50">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
          比赛数据
        </h4>
        <div className="space-y-2">
          <StatBar label="控球率" homeVal={result.stats.possession[0]} awayVal={result.stats.possession[1]} suffix="%" />
          <StatBar label="射门" homeVal={result.stats.shots[0]} awayVal={result.stats.shots[1]} />
          <StatBar label="射正" homeVal={result.stats.shotsOnTarget[0]} awayVal={result.stats.shotsOnTarget[1]} />
          <StatBar label="角球" homeVal={result.stats.corners[0]} awayVal={result.stats.corners[1]} />
          <StatBar label="犯规" homeVal={result.stats.fouls[0]} awayVal={result.stats.fouls[1]} />
          <StatBar label="黄牌" homeVal={result.stats.yellowCards[0]} awayVal={result.stats.yellowCards[1]} warnColor />
          <StatBar label="红牌" homeVal={result.stats.redCards[0]} awayVal={result.stats.redCards[1]} warnColor />
        </div>
      </div>

      {/* ──── Full events list ──── */}
      {result.events.length > 0 && (
        <div className="px-6 py-4 pb-5">
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            赛事回顾
          </h4>
          <div className="space-y-1">
            {result.events
              .sort((a, b) => a.minute - b.minute)
              .map((event, i) => (
                <div
                  key={i}
                  className="flex items-center text-xs py-1 border-b border-slate-700/30 last:border-0"
                >
                  <span className="w-8 text-right font-mono text-slate-500 shrink-0">
                    {event.minute}'
                  </span>
                  <span className="mx-2 shrink-0">{getEventIcon(event.type)}</span>
                  <span
                    className={`${
                      event.teamId === fixture.homeTeamId ? 'text-slate-300' : 'text-slate-400'
                    }`}
                  >
                    {event.description}
                  </span>
                  <span className="ml-auto text-slate-600 text-[10px] shrink-0">
                    {getTeamShortName(event.teamId, world.teamBases)}
                  </span>
                </div>
              ))}
          </div>

          {/* MOTM */}
          {result.motm && (
            <div className="mt-3 bg-amber-900/20 rounded-lg px-3 py-2 text-xs text-amber-400">
              <span className="font-semibold">全场最佳:</span> {result.motm}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  Sub-components
// ══════════════════════════════════════════════════════════════════════

/** Comparison row: two bars going outward from center label */
function ComparisonRow({
  label,
  homeVal,
  awayVal,
  max,
  invertColor,
}: {
  label: string;
  homeVal: number;
  awayVal: number;
  max: number;
  invertColor?: boolean;
}) {
  const homeColor = invertColor
    ? homeVal > 60
      ? 'bg-red-500'
      : homeVal > 35
      ? 'bg-amber-500'
      : 'bg-blue-500'
    : 'bg-blue-500';
  const awayColor = invertColor
    ? awayVal > 60
      ? 'bg-red-500'
      : awayVal > 35
      ? 'bg-amber-500'
      : 'bg-orange-500'
    : 'bg-orange-500';

  return (
    <div className="flex items-center py-0.5">
      <span className="text-xs text-slate-400 w-8 text-right shrink-0">
        {Math.round(homeVal)}
      </span>
      <div className="flex-1 flex justify-end px-2">
        <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div
            className={`h-full ${homeColor} rounded-full float-right`}
            style={{ width: `${(homeVal / max) * 100}%` }}
          />
        </div>
      </div>
      <span className="text-xs text-slate-500 w-16 text-center shrink-0">{label}</span>
      <div className="flex-1 px-2">
        <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div
            className={`h-full ${awayColor} rounded-full`}
            style={{ width: `${(awayVal / max) * 100}%` }}
          />
        </div>
      </div>
      <span className="text-xs text-slate-400 w-8 shrink-0">
        {Math.round(awayVal)}
      </span>
    </div>
  );
}

/** Momentum row with colored +/- */
function MomentumRow({
  label,
  homeVal,
  awayVal,
}: {
  label: string;
  homeVal: number;
  awayVal: number;
}) {
  const fmt = (v: number) => (v > 0 ? `+${v}` : `${v}`);
  const clr = (v: number) =>
    v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-slate-500';

  return (
    <div className="flex items-center py-0.5">
      <span className={`text-xs font-semibold w-8 text-right shrink-0 ${clr(homeVal)}`}>
        {fmt(homeVal)}
      </span>
      <div className="flex-1 px-2" />
      <span className="text-xs text-slate-500 w-16 text-center shrink-0">{label}</span>
      <div className="flex-1 px-2" />
      <span className={`text-xs font-semibold w-8 shrink-0 ${clr(awayVal)}`}>
        {fmt(awayVal)}
      </span>
    </div>
  );
}

/** Dual bar meeting in the middle (base stats) */
function DualBar({
  label,
  homeVal,
  awayVal,
  homeColor,
  awayColor,
}: {
  label: string;
  homeVal: number;
  awayVal: number;
  homeColor: string;
  awayColor: string;
}) {
  const maxVal = 100;
  return (
    <div className="flex items-center py-0.5">
      <span className="text-xs text-slate-400 w-8 text-right shrink-0">{homeVal}</span>
      <div className="flex-1 flex justify-end px-2">
        <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full float-right"
            style={{
              width: `${(homeVal / maxVal) * 100}%`,
              backgroundColor: homeColor,
              opacity: 0.7,
            }}
          />
        </div>
      </div>
      <span className="text-xs text-slate-500 w-10 text-center shrink-0 font-mono">
        {label}
      </span>
      <div className="flex-1 px-2">
        <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${(awayVal / maxVal) * 100}%`,
              backgroundColor: awayColor,
              opacity: 0.7,
            }}
          />
        </div>
      </div>
      <span className="text-xs text-slate-400 w-8 shrink-0">{awayVal}</span>
    </div>
  );
}

/** Post-match stat comparison bar */
function StatBar({
  label,
  homeVal,
  awayVal,
  suffix,
  warnColor,
}: {
  label: string;
  homeVal: number;
  awayVal: number;
  suffix?: string;
  warnColor?: boolean;
}) {
  const total = homeVal + awayVal || 1;
  const homePct = (homeVal / total) * 100;
  const awayPct = (awayVal / total) * 100;

  return (
    <div>
      <div className="flex justify-between text-xs mb-0.5">
        <span className={`font-medium ${homeVal > awayVal ? 'text-slate-200' : 'text-slate-400'}`}>
          {homeVal}{suffix ?? ''}
        </span>
        <span className="text-slate-500">{label}</span>
        <span className={`font-medium ${awayVal > homeVal ? 'text-slate-200' : 'text-slate-400'}`}>
          {awayVal}{suffix ?? ''}
        </span>
      </div>
      <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-700 gap-0.5">
        <div
          className={`rounded-l-full ${warnColor ? 'bg-amber-500' : 'bg-blue-500'}`}
          style={{ width: `${homePct}%` }}
        />
        <div
          className={`rounded-r-full ${warnColor ? 'bg-amber-500' : 'bg-orange-500'}`}
          style={{ width: `${awayPct}%` }}
        />
      </div>
    </div>
  );
}

/** Event type icon */
function getEventIcon(type: MatchEvent['type']): string {
  switch (type) {
    case 'goal':
      return '\u26BD';
    case 'penalty_goal':
      return '\u26BD';
    case 'own_goal':
      return '\u26BD';
    case 'penalty_miss':
      return '\u274C';
    case 'miss':
      return '\u274C';
    case 'yellow_card':
      return '\uD83D\uDFE8';
    case 'red_card':
      return '\uD83D\uDFE5';
    case 'save':
      return '\uD83E\uDDE4';
    case 'assist':
      return '\uD83C\uDFA5';
    default:
      return '\u2022';
  }
}

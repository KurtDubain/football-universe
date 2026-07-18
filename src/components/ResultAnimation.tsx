import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { MatchResult } from '../types/match';
import type { TeamBase } from '../types/team';
import TeamName from './TeamName';
import { isDerby, getDerbyName } from '../config/derbies';
import { EnergyWave } from './CanvasEffects';
import { getDramaticRevealDelay, getOrdinaryRevealPlan } from './result-reveal-timing';

interface ResultAnimationProps {
  results: MatchResult[];
  teamBases: Record<string, TeamBase>;
  priorityTeamIds?: string[];
  onComplete: () => void;
  onResultClick: (r: MatchResult) => void;
  onLiveView?: (r: MatchResult) => void;
}

const EMPTY_TEAM_IDS: string[] = [];

/**
 * Animated results reveal — shows match results one by one with dramatic timing.
 * Key matches (derbies, upsets, big scores) get extra fanfare.
 */
function resultBatchKey(results: MatchResult[]): string {
  return results.map(result =>
    `${result.fixtureId}:${result.homeGoals}:${result.awayGoals}:${result.etHomeGoals ?? 0}:${result.etAwayGoals ?? 0}`,
  ).join('|');
}

export default function ResultAnimation(props: ResultAnimationProps) {
  return <ResultAnimationBatch key={resultBatchKey(props.results)} {...props} />;
}

function ResultAnimationBatch({ results, teamBases, priorityTeamIds = EMPTY_TEAM_IDS, onComplete, onResultClick, onLiveView }: ResultAnimationProps) {
  const [revealedCount, setRevealedCount] = useState(0);
  const completionCalledRef = useRef(false);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Sort: normal matches first, key matches last for dramatic reveal
  const sorted = useMemo(() => [...results].sort((a, b) => {
      const aKey = getMatchImportance(a, teamBases);
      const bKey = getMatchImportance(b, teamBases);
      return aKey - bKey; // lower importance first
    }), [results, teamBases]);
  const prioritySet = useMemo(() => new Set(priorityTeamIds), [priorityTeamIds]);
  const pinned = useMemo(() => sorted.filter(result => (
    prioritySet.has(result.homeTeamId) || prioritySet.has(result.awayTeamId)
  )), [prioritySet, sorted]);
  const sequence = useMemo(() => sorted.filter(result => (
    !prioritySet.has(result.homeTeamId) && !prioritySet.has(result.awayTeamId)
  )), [prioritySet, sorted]);
  const ordinaryCount = useMemo(() => sequence.filter(result => getMatchImportance(result, teamBases) < 2).length, [sequence, teamBases]);
  const ordinaryPlan = useMemo(() => getOrdinaryRevealPlan(ordinaryCount), [ordinaryCount]);
  const hasDramaticResult = useMemo(() => sequence.some(result => getMatchImportance(result, teamBases) >= 2), [sequence, teamBases]);
  const done = revealedCount >= sequence.length;

  const completeOnce = useCallback(() => {
    if (completionCalledRef.current) return;
    completionCalledRef.current = true;
    onCompleteRef.current();
  }, []);

  useEffect(() => {
    if (done) {
      const timer = window.setTimeout(completeOnce, hasDramaticResult ? 600 : 200);
      return () => clearTimeout(timer);
    }

    const current = sequence[revealedCount];
    const importance = getMatchImportance(current, teamBases);
    const dramaticDelay = getDramaticRevealDelay(importance);
    const delay = dramaticDelay || ordinaryPlan.delayMs;
    const revealStep = dramaticDelay
      ? 1
      : Math.min(ordinaryPlan.step, Math.max(1, ordinaryCount - revealedCount));

    const timer = window.setTimeout(() => {
      setRevealedCount(prev => prev + revealStep);
    }, delay);

    return () => clearTimeout(timer);
  }, [completeOnce, done, hasDramaticResult, ordinaryCount, ordinaryPlan, revealedCount, sequence, teamBases]);

  const handleSkip = useCallback(() => {
    setRevealedCount(sequence.length);
    completeOnce();
  }, [completeOnce, sequence.length]);

  return (
    <div className="space-y-4">
      {pinned.length > 0 && (
        <section aria-labelledby="favorite-results-heading" className="space-y-2">
          <h3 id="favorite-results-heading" className="flex items-center gap-2 text-sm font-semibold text-[var(--text-secondary)]">
            <span className="h-4 w-1 rounded-full bg-[var(--action)]" aria-hidden="true" />
            我的球队本轮赛果
          </h3>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {pinned.map(result => {
              const importance = getMatchImportance(result, teamBases);
              return (
                <AnimatedResultCard
                  key={result.fixtureId}
                  result={result}
                  teamBases={teamBases}
                  importance={importance}
                  isNew={false}
                  onClick={() => onResultClick(result)}
                  onLiveView={onLiveView && importance >= 2 ? () => onLiveView(result) : undefined}
                />
              );
            })}
          </div>
        </section>
      )}

      {pinned.length > 0 && sequence.length > 0 && (
        <h3 className="text-xs font-semibold text-[var(--text-muted)]">其他赛果</h3>
      )}

      {/* Skip button */}
      {!done && (
        <div className="flex justify-end">
          <button data-testid="skip-result-animation" onClick={handleSkip} className="min-h-11 px-3 text-xs text-slate-500 hover:text-slate-300 cursor-pointer">
            跳过动画
          </button>
        </div>
      )}

      {/* Results grid */}
      <div data-testid="result-sequence" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-1.5">
        {sequence.slice(0, revealedCount).map((r, i) => {
          const importance = getMatchImportance(r, teamBases);
          const isNew = i === revealedCount - 1 && !done;
          return (
            <AnimatedResultCard
              key={r.fixtureId}
              result={r}
              teamBases={teamBases}
              importance={importance}
              isNew={isNew}
              onClick={() => onResultClick(r)}
              onLiveView={onLiveView && importance >= 2 ? () => onLiveView(r) : undefined}
            />
          );
        })}
      </div>

      {/* Reveal progress */}
      {!done && (
        <div className="flex items-center gap-2 justify-center pt-2">
          <div className="w-24 h-1 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-200"
              style={{ width: `${(revealedCount / sequence.length) * 100}%` }}
            />
          </div>
          <span className="text-xs text-slate-500">{revealedCount}/{sequence.length}</span>
        </div>
      )}
    </div>
  );
}

function AnimatedResultCard({ result: r, teamBases, importance, isNew, onClick, onLiveView }: {
  result: MatchResult;
  teamBases: Record<string, TeamBase>;
  importance: number;
  isNew: boolean;
  onClick: () => void;
  onLiveView?: () => void;
}) {
  const ht = teamBases[r.homeTeamId];
  const at = teamBases[r.awayTeamId];
  const totalHome = r.homeGoals + (r.etHomeGoals ?? 0);
  const totalAway = r.awayGoals + (r.etAwayGoals ?? 0);
  const homeWon = totalHome > totalAway || (r.penalties && (r.penaltyHome ?? 0) > (r.penaltyAway ?? 0));
  const awayWon = totalAway > totalHome || (r.penalties && (r.penaltyAway ?? 0) > (r.penaltyHome ?? 0));
  const derbyName = isDerby(r.homeTeamId, r.awayTeamId, teamBases) ? getDerbyName(r.homeTeamId, r.awayTeamId, teamBases) : null;
  const probabilityGap = Math.abs((r.prediction?.homeWinPct ?? 0) - (r.prediction?.awayWinPct ?? 0));
  const isUpset = r.prediction
    ? probabilityGap >= 10 && (homeWon
      ? r.prediction.homeWinPct < r.prediction.awayWinPct
      : awayWon && r.prediction.awayWinPct < r.prediction.homeWinPct)
    : Math.abs((ht?.overall ?? 0) - (at?.overall ?? 0)) > 12
      && ((ht?.overall ?? 0) > (at?.overall ?? 0) ? awayWon : homeWon);
  const totalGoals = totalHome + totalAway;
  const isHighScoring = totalGoals >= 5;

  // Determine card style based on importance
  const isKeyMatch = importance >= 3;
  const baseClass = isKeyMatch
    ? 'bg-gradient-to-r from-slate-800 via-slate-800 to-slate-800 border-amber-600/30'
    : 'bg-slate-800 border-slate-700';

  return (
    <div
      className={`w-full rounded-lg border text-left transition-all hover-lift relative overflow-hidden ${baseClass} ${
        isNew ? 'animate-scale-in' : ''
      }`}
    >
      {/* Energy wave on key match reveal */}
      {isKeyMatch && isNew && <EnergyWave color={ht?.color ?? '#f59e0b'} />}
      <button
        type="button"
        onClick={onClick}
        className="w-full p-2 text-left cursor-pointer"
        aria-label={`查看 ${ht?.name ?? r.homeTeamId} 对 ${at?.name ?? r.awayTeamId} 战报`}
      >
        {/* Tags row — compact */}
        {(derbyName || isUpset || isHighScoring || r.competitionType !== 'league') && (
          <div className="flex gap-1 mb-1 flex-wrap">
            {derbyName && <span className="text-[10px] sm:text-[8px] px-1 py-0.5 rounded font-semibold bg-orange-600 text-white">{derbyName}</span>}
            {isUpset && <span className="text-[10px] sm:text-[8px] px-1 py-0.5 rounded font-semibold bg-purple-600 text-white">爆冷</span>}
            {isHighScoring && <span className="text-[10px] sm:text-[8px] px-1 py-0.5 rounded font-semibold bg-red-600 text-white">进球大战</span>}
            {r.competitionType !== 'league' && (
              <span className="text-[10px] sm:text-[8px] px-1 py-0.5 rounded bg-slate-700 text-slate-300">{r.competitionName}</span>
            )}
          </div>
        )}

        {/* Score line */}
        <div className="flex items-center">
          <div className="flex-1 min-w-0">
            <TeamName teamId={r.homeTeamId} teamBases={teamBases} showTier link={false} compact
              className={`text-xs ${homeWon ? 'text-green-400 font-bold' : 'text-slate-200'}`} />
          </div>

          <div className="flex items-center gap-1 px-2 shrink-0">
            <span className={`text-base font-black tabular-nums ${isNew ? 'animate-score-pop' : ''} ${homeWon ? 'text-green-400' : 'text-slate-300'}`}>
              {totalHome}
            </span>
            <span className="text-slate-600 text-[10px]">:</span>
            <span className={`text-base font-black tabular-nums ${isNew ? 'animate-score-pop' : ''} ${awayWon ? 'text-green-400' : 'text-slate-300'}`}>
              {totalAway}
            </span>
            {r.extraTime && (
              <span className="text-[10px] sm:text-[8px] text-amber-400 ml-0.5">
                {r.penalties ? `P` : '加时'}
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0 text-right">
            <TeamName teamId={r.awayTeamId} teamBases={teamBases} showTier link={false} compact
              className={`text-xs ${awayWon ? 'text-green-400 font-bold' : 'text-slate-200'} justify-end`} />
          </div>
        </div>

        {/* Key goal events — only for key matches, max 3 */}
        {isKeyMatch && r.events.length > 0 && (
          <div className="mt-1 flex gap-1.5 text-[11px] sm:text-[9px] text-slate-500 overflow-hidden">
            {r.events
              .filter(e => e.type === 'goal' || e.type === 'penalty_goal')
              .slice(0, 3)
              .map((e, i) => (
                <span key={i}>
                  {e.minute}'{e.playerName ? ` ${e.playerName}` : (e.playerNumber ? ` ${e.playerNumber}号` : '')}
                </span>
              ))}
          </div>
        )}
      </button>

      {/* Live replay button for important matches */}
      {onLiveView && (
        <div className="mx-2 pb-2 pt-1 border-t border-slate-700/30">
          <button
            type="button"
            onClick={onLiveView}
            className="min-h-11 sm:min-h-0 text-[11px] sm:text-[9px] text-emerald-400 hover:text-emerald-300 cursor-pointer flex items-center gap-1"
          >
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-breathe" />
            观看直播回放
          </button>
        </div>
      )}
    </div>
  );
}

function getMatchImportance(r: MatchResult, teamBases: Record<string, TeamBase>): number {
  let score = 0;
  const ht = teamBases[r.homeTeamId];
  const at = teamBases[r.awayTeamId];
  const totalHome = r.homeGoals + (r.etHomeGoals ?? 0);
  const totalAway = r.awayGoals + (r.etAwayGoals ?? 0);

  // Derby
  if (isDerby(r.homeTeamId, r.awayTeamId, teamBases)) score += 2;
  // Cup match
  if (r.competitionType !== 'league') score += 1;
  // Final
  if (r.roundLabel === 'Final' || r.roundLabel === '决赛') score += 3;
  // Upset
  if (ht && at && Math.abs(ht.overall - at.overall) > 12) score += 1;
  // High scoring
  if (totalHome + totalAway >= 5) score += 1;
  // ET/Penalties
  if (r.extraTime) score += 1;

  return score;
}

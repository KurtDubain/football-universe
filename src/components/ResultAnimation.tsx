import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { MatchResult } from '../types/match';
import type { TeamBase } from '../types/team';
import { getTeamName } from '../utils/format';
import { isDerby, getDerbyName } from '../config/derbies';
import { EnergyWave } from './CanvasEffects';

interface ResultAnimationProps {
  results: MatchResult[];
  teamBases: Record<string, TeamBase>;
  onComplete: () => void;
  onResultClick: (r: MatchResult) => void;
}

/**
 * Animated results reveal — shows match results one by one with dramatic timing.
 * Key matches (derbies, upsets, big scores) get extra fanfare.
 */
export default function ResultAnimation({ results, teamBases, onComplete, onResultClick }: ResultAnimationProps) {
  const [revealedCount, setRevealedCount] = useState(0);
  const [phase, setPhase] = useState<'revealing' | 'done'>('revealing');

  // Sort: normal matches first, key matches last for dramatic reveal
  const sorted = [...results].sort((a, b) => {
    const aKey = getMatchImportance(a, teamBases);
    const bKey = getMatchImportance(b, teamBases);
    return aKey - bKey; // lower importance first
  });

  useEffect(() => {
    if (phase !== 'revealing') return;
    if (revealedCount >= sorted.length) {
      setPhase('done');
      const timer = setTimeout(onComplete, 800);
      return () => clearTimeout(timer);
    }

    const current = sorted[revealedCount];
    const importance = getMatchImportance(current, teamBases);
    // Key matches pause longer
    const delay = importance >= 3 ? 600 : importance >= 2 ? 400 : 200;

    const timer = setTimeout(() => {
      setRevealedCount(prev => prev + 1);
    }, delay);

    return () => clearTimeout(timer);
  }, [revealedCount, phase, sorted.length]);

  const handleSkip = useCallback(() => {
    setRevealedCount(sorted.length);
    setPhase('done');
    onComplete();
  }, [sorted.length, onComplete]);

  return (
    <div className="space-y-2">
      {/* Skip button */}
      {phase === 'revealing' && (
        <div className="flex justify-end">
          <button onClick={handleSkip} className="text-[10px] text-slate-500 hover:text-slate-300 cursor-pointer px-2 py-1">
            跳过动画 →
          </button>
        </div>
      )}

      {/* Results grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-1.5">
        {sorted.slice(0, revealedCount).map((r, i) => {
          const importance = getMatchImportance(r, teamBases);
          const isNew = i === revealedCount - 1 && phase === 'revealing';
          return (
            <AnimatedResultCard
              key={r.fixtureId}
              result={r}
              teamBases={teamBases}
              importance={importance}
              isNew={isNew}
              onClick={() => onResultClick(r)}
            />
          );
        })}
      </div>

      {/* Reveal progress */}
      {phase === 'revealing' && (
        <div className="flex items-center gap-2 justify-center pt-2">
          <div className="w-24 h-1 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-200"
              style={{ width: `${(revealedCount / sorted.length) * 100}%` }}
            />
          </div>
          <span className="text-[10px] text-slate-500">{revealedCount}/{sorted.length}</span>
        </div>
      )}
    </div>
  );
}

function AnimatedResultCard({ result: r, teamBases, importance, isNew, onClick }: {
  result: MatchResult;
  teamBases: Record<string, TeamBase>;
  importance: number;
  isNew: boolean;
  onClick: () => void;
}) {
  const ht = teamBases[r.homeTeamId];
  const at = teamBases[r.awayTeamId];
  const totalHome = r.homeGoals + (r.etHomeGoals ?? 0);
  const totalAway = r.awayGoals + (r.etAwayGoals ?? 0);
  const homeWon = totalHome > totalAway || (r.penalties && (r.penaltyHome ?? 0) > (r.penaltyAway ?? 0));
  const awayWon = totalAway > totalHome || (r.penalties && (r.penaltyAway ?? 0) > (r.penaltyHome ?? 0));
  const derbyName = isDerby(r.homeTeamId, r.awayTeamId) ? getDerbyName(r.homeTeamId, r.awayTeamId) : null;
  const isUpset = Math.abs((ht?.overall ?? 0) - (at?.overall ?? 0)) > 12 &&
    ((ht?.overall ?? 0) > (at?.overall ?? 0) ? awayWon : homeWon);
  const totalGoals = totalHome + totalAway;
  const isHighScoring = totalGoals >= 5;

  // Determine card style based on importance
  const isKeyMatch = importance >= 3;
  const baseClass = isKeyMatch
    ? 'bg-gradient-to-r from-slate-800 via-slate-800 to-slate-800 border-amber-600/30'
    : 'bg-slate-800 border-slate-700';

  return (
    <button
      onClick={onClick}
      className={`w-full rounded-lg border p-2 text-left cursor-pointer transition-all hover-lift relative overflow-hidden ${baseClass} ${
        isNew ? 'animate-scale-in' : ''
      }`}
    >
      {/* Energy wave on key match reveal */}
      {isKeyMatch && isNew && <EnergyWave color={ht?.color ?? '#f59e0b'} />}
      {/* Tags row — compact */}
      {(derbyName || isUpset || isHighScoring || r.competitionType !== 'league') && (
        <div className="flex gap-1 mb-1 flex-wrap">
          {derbyName && <span className="text-[8px] px-1 py-0.5 rounded font-semibold bg-orange-600 text-white">{derbyName}</span>}
          {isUpset && <span className="text-[8px] px-1 py-0.5 rounded font-semibold bg-purple-600 text-white">爆冷</span>}
          {isHighScoring && <span className="text-[8px] px-1 py-0.5 rounded font-semibold bg-red-600 text-white">进球大战</span>}
          {r.competitionType !== 'league' && (
            <span className="text-[8px] px-1 py-0.5 rounded bg-slate-700 text-slate-300">{r.competitionName}</span>
          )}
        </div>
      )}

      {/* Score line */}
      <div className="flex items-center">
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ht?.color ?? '#666' }} />
          <span className={`text-xs truncate ${homeWon ? 'text-green-400 font-bold' : 'text-slate-200'}`}>
            {getTeamName(r.homeTeamId, teamBases)}
          </span>
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
            <span className="text-[8px] text-amber-400 ml-0.5">
              {r.penalties ? `P` : '加时'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 flex-1 min-w-0 justify-end">
          <span className={`text-xs truncate text-right ${awayWon ? 'text-green-400 font-bold' : 'text-slate-200'}`}>
            {getTeamName(r.awayTeamId, teamBases)}
          </span>
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: at?.color ?? '#666' }} />
        </div>
      </div>

      {/* Key goal events — only for key matches, max 3 */}
      {isKeyMatch && r.events.length > 0 && (
        <div className="mt-1 flex gap-1.5 text-[9px] text-slate-500 overflow-hidden">
          {r.events
            .filter(e => e.type === 'goal' || e.type === 'penalty_goal')
            .slice(0, 3)
            .map((e, i) => (
              <span key={i}>
                {e.minute}'{e.playerNumber ? ` ${e.playerNumber}号` : ''}
              </span>
            ))}
        </div>
      )}
    </button>
  );
}

function getMatchImportance(r: MatchResult, teamBases: Record<string, TeamBase>): number {
  let score = 0;
  const ht = teamBases[r.homeTeamId];
  const at = teamBases[r.awayTeamId];
  const totalHome = r.homeGoals + (r.etHomeGoals ?? 0);
  const totalAway = r.awayGoals + (r.etAwayGoals ?? 0);

  // Derby
  if (isDerby(r.homeTeamId, r.awayTeamId)) score += 2;
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

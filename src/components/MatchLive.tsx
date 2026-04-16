import { useState, useEffect, useRef, useCallback } from 'react';
import type { MatchResult, MatchEvent } from '../types/match';
import type { TeamBase } from '../types/team';
import { getTeamName } from '../utils/format';

interface Props {
  result: MatchResult;
  teamBases: Record<string, TeamBase>;
  onClose: () => void;
}

const EVENT_ICONS: Record<string, string> = {
  goal: '⚽', penalty_goal: '⚽', own_goal: '🔴',
  yellow_card: '🟨', red_card: '🟥',
  save: '🧤', miss: '💨',
};

export default function MatchLive({ result, teamBases, onClose }: Props) {
  const [minute, setMinute] = useState(0);
  const [speed, setSpeed] = useState(1); // 1=normal, 2=fast, 4=turbo
  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState(false);
  const [shownEvents, setShownEvents] = useState<MatchEvent[]>([]);
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [flashEvent, setFlashEvent] = useState<MatchEvent | null>(null);
  const timerRef = useRef<number>(0);

  const ht = teamBases[result.homeTeamId];
  const at = teamBases[result.awayTeamId];
  const maxMin = result.extraTime ? 120 : 90;

  // All events sorted
  const allEvents = [...result.events]
    .filter(e => e.minute <= maxMin)
    .sort((a, b) => a.minute - b.minute);

  // Tick
  useEffect(() => {
    if (paused || finished) return;
    const interval = Math.max(30, 150 / speed);
    timerRef.current = window.setInterval(() => {
      setMinute(prev => {
        const next = prev + 1;
        if (next > maxMin) {
          setFinished(true);
          return maxMin;
        }
        return next;
      });
    }, interval);
    return () => clearInterval(timerRef.current);
  }, [paused, finished, speed, maxMin]);

  // Process events at current minute
  useEffect(() => {
    const newEvents = allEvents.filter(
      e => e.minute <= minute && !shownEvents.find(s => s === e)
    );
    if (newEvents.length > 0) {
      const latest = newEvents[newEvents.length - 1];
      setShownEvents(prev => [...prev, ...newEvents]);
      setFlashEvent(latest);

      // Update score
      let h = 0, a = 0;
      for (const e of [...shownEvents, ...newEvents]) {
        if (e.type === 'goal' || e.type === 'penalty_goal') {
          if (e.teamId === result.homeTeamId) h++;
          else a++;
        }
      }
      setHomeScore(h);
      setAwayScore(a);

      // Clear flash after delay
      setTimeout(() => setFlashEvent(null), 2000);
    }
  }, [minute]);

  const skip = useCallback(() => {
    setMinute(maxMin);
    setFinished(true);
    const h = allEvents.filter(e => (e.type === 'goal' || e.type === 'penalty_goal') && e.teamId === result.homeTeamId).length;
    const a = allEvents.filter(e => (e.type === 'goal' || e.type === 'penalty_goal') && e.teamId === result.awayTeamId).length;
    setHomeScore(h);
    setAwayScore(a);
    setShownEvents(allEvents);
  }, [allEvents, maxMin, result]);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl animate-scale-in">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-800 via-emerald-900/20 to-slate-800 px-4 py-3 flex items-center justify-between">
          <span className="text-xs text-slate-400">{result.competitionName} · {result.roundLabel}</span>
          <span className={`text-xs px-2 py-0.5 rounded ${finished ? 'bg-red-900/50 text-red-400' : 'bg-green-900/50 text-green-400 animate-breathe'}`}>
            {finished ? '全场结束' : '直播中'}
          </span>
        </div>

        {/* Score board */}
        <div className="flex items-center justify-center py-5 px-6 gap-4 relative"
          style={{ background: `linear-gradient(90deg, ${ht?.color ?? '#333'}15 0%, transparent 30%, transparent 70%, ${at?.color ?? '#333'}15 100%)` }}
        >
          <div className="flex-1 text-right">
            <div className="flex items-center gap-2 justify-end">
              <div className="text-lg font-bold text-slate-100">{ht?.name ?? '主队'}</div>
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: ht?.color ?? '#666' }} />
            </div>
            <div className="text-[10px] text-slate-500">主场</div>
          </div>
          <div className="flex items-center gap-4 px-4">
            <span className={`text-5xl font-black tabular-nums transition-colors ${homeScore > awayScore ? 'text-green-400' : 'text-slate-100'} ${flashEvent && flashEvent.teamId === result.homeTeamId ? 'animate-score-pop' : ''}`}>
              {homeScore}
            </span>
            <div className="flex flex-col items-center">
              <span className="text-lg text-slate-600">:</span>
              <span className="text-[10px] text-emerald-400 font-mono mt-1">{minute}'</span>
            </div>
            <span className={`text-5xl font-black tabular-nums transition-colors ${awayScore > homeScore ? 'text-green-400' : 'text-slate-100'} ${flashEvent && flashEvent.teamId === result.awayTeamId ? 'animate-score-pop' : ''}`}>
              {awayScore}
            </span>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: at?.color ?? '#666' }} />
              <div className="text-lg font-bold text-slate-100">{at?.name ?? '客队'}</div>
            </div>
            <div className="text-[10px] text-slate-500">客场</div>
          </div>
        </div>

        {/* Mini pitch + time */}
        <div className="px-4 pb-2">
          <div className="relative bg-gradient-to-b from-emerald-900/40 to-emerald-900/20 rounded-xl border border-emerald-800/30 h-28 overflow-hidden">
            {/* Pitch lines */}
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 100" preserveAspectRatio="none">
              <rect x="2" y="2" width="196" height="96" fill="none" stroke="#16653480" strokeWidth="1" rx="3" />
              <line x1="100" y1="2" x2="100" y2="98" stroke="#16653460" strokeWidth="0.8" />
              <circle cx="100" cy="50" r="18" fill="none" stroke="#16653460" strokeWidth="0.6" />
              <circle cx="100" cy="50" r="1.5" fill="#16653480" />
              {/* Left penalty area */}
              <rect x="2" y="22" width="28" height="56" fill="none" stroke="#16653460" strokeWidth="0.6" />
              <rect x="2" y="32" width="12" height="36" fill="none" stroke="#16653440" strokeWidth="0.5" />
              {/* Right penalty area */}
              <rect x="170" y="22" width="28" height="56" fill="none" stroke="#16653460" strokeWidth="0.6" />
              <rect x="186" y="32" width="12" height="36" fill="none" stroke="#16653440" strokeWidth="0.5" />
              {/* Corner arcs */}
              <path d="M2 6 A4 4 0 0 1 6 2" fill="none" stroke="#16653440" strokeWidth="0.5" />
              <path d="M194 2 A4 4 0 0 1 198 6" fill="none" stroke="#16653440" strokeWidth="0.5" />
              <path d="M2 94 A4 4 0 0 0 6 98" fill="none" stroke="#16653440" strokeWidth="0.5" />
              <path d="M198 94 A4 4 0 0 1 194 98" fill="none" stroke="#16653440" strokeWidth="0.5" />
            </svg>

            {/* Grass stripes */}
            <div className="absolute inset-0 opacity-5" style={{
              backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 12.5%, rgba(255,255,255,0.3) 12.5%, rgba(255,255,255,0.3) 25%)',
            }} />

            {/* Ball position indicator */}
            <div
              className="absolute w-2.5 h-2.5 bg-white rounded-full shadow-lg shadow-white/30 transition-all duration-500"
              style={{
                left: `${20 + Math.sin(minute * 0.3) * 30 + 30}%`,
                top: `${25 + Math.cos(minute * 0.5) * 25 + 25}%`,
              }}
            />

            {/* Team color bars */}
            <div className="absolute left-1 top-1 bottom-1 w-1 rounded" style={{ backgroundColor: ht?.color ?? '#666' }} />
            <div className="absolute right-1 top-1 bottom-1 w-1 rounded" style={{ backgroundColor: at?.color ?? '#666' }} />

            {/* Flash event overlay */}
            {flashEvent && (
              <div className="absolute inset-0 flex items-center justify-center animate-scale-in">
                <div className={`px-4 py-2 rounded-lg text-sm font-bold ${
                  flashEvent.type === 'goal' || flashEvent.type === 'penalty_goal'
                    ? 'bg-amber-500/90 text-white'
                    : flashEvent.type === 'yellow_card'
                    ? 'bg-yellow-500/80 text-black'
                    : flashEvent.type === 'red_card'
                    ? 'bg-red-600/90 text-white'
                    : 'bg-slate-700/80 text-slate-200'
                }`}>
                  {EVENT_ICONS[flashEvent.type] ?? ''} {flashEvent.minute}' {flashEvent.description}
                </div>
              </div>
            )}

            {/* Minute display */}
            <div className="absolute top-1 right-2 text-xs font-mono text-emerald-400/80">
              {minute}'
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[10px] text-slate-500 w-6">0'</span>
            <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${(minute / maxMin) * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-slate-500 w-8 text-right">{maxMin}'</span>
          </div>
        </div>

        {/* Event log */}
        <div className="px-4 pb-2 max-h-28 overflow-y-auto">
          {shownEvents.filter(e => e.type === 'goal' || e.type === 'penalty_goal' || e.type === 'yellow_card' || e.type === 'red_card').map((e, i) => (
            <div key={i} className="flex items-center gap-2 text-xs py-0.5">
              <span className="text-slate-500 w-6 text-right font-mono">{e.minute}'</span>
              <span>{EVENT_ICONS[e.type] ?? '•'}</span>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: e.teamId === result.homeTeamId ? ht?.color : at?.color }} />
              <span className="text-slate-300 truncate">{e.description}</span>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div className="px-4 py-3 border-t border-slate-800 flex items-center justify-between">
          <div className="flex gap-1">
            {[1, 2, 4].map(s => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`px-2 py-1 text-[10px] rounded cursor-pointer ${speed === s ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
              >
                {s}x
              </button>
            ))}
            <button
              onClick={() => setPaused(!paused)}
              className="px-2 py-1 text-[10px] rounded bg-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              {paused ? '▶' : '⏸'}
            </button>
          </div>
          <div className="flex gap-2">
            {!finished && (
              <button onClick={skip} className="px-3 py-1 text-[10px] text-slate-500 hover:text-slate-300 cursor-pointer">
                跳过 →
              </button>
            )}
            <button onClick={onClose} className="px-3 py-1 text-[10px] bg-slate-800 text-slate-300 hover:bg-slate-700 rounded cursor-pointer">
              {finished ? '关闭' : '退出直播'}
            </button>
          </div>
        </div>

        {/* Penalty shootout result */}
        {finished && result.penalties && (
          <div className="px-4 pb-3 text-center">
            <span className="text-xs text-amber-400">点球大战: {result.penaltyHome} - {result.penaltyAway}</span>
          </div>
        )}
      </div>
    </div>
  );
}

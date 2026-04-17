import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { MatchResult, MatchEvent } from '../types/match';
import type { TeamBase } from '../types/team';
import { getTeamName } from '../utils/format';
import PitchCanvas from './PitchCanvas';

interface Props {
  result: MatchResult;
  teamBases: Record<string, TeamBase>;
  onClose: () => void;
}

const EVENT_ICONS: Record<string, string> = {
  goal: '⚽', penalty_goal: '⚽', own_goal: '🔴',
  yellow_card: '🟨', red_card: '🟥', save: '🧤', miss: '💨',
};

export default function MatchLive({ result, teamBases, onClose }: Props) {
  const [minute, setMinute] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState(false);
  const [shownEvents, setShownEvents] = useState<MatchEvent[]>([]);
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [flashEvent, setFlashEvent] = useState<MatchEvent | null>(null);
  const [goalFlash, setGoalFlash] = useState<'home' | 'away' | null>(null);
  const [htShow, setHtShow] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const ht = teamBases[result.homeTeamId];
  const at = teamBases[result.awayTeamId];
  const maxMin = result.extraTime ? 120 : 90;

  const allEvents = useMemo(() =>
    [...result.events].filter(e => e.minute <= maxMin).sort((a, b) => a.minute - b.minute),
    [result.events, maxMin]
  );

  // Tick
  useEffect(() => {
    if (paused || finished) return;
    const interval = Math.max(25, 120 / speed);
    const timer = window.setInterval(() => {
      setMinute(prev => {
        const next = prev + 1;
        if (next > maxMin) { setFinished(true); return maxMin; }
        // Half-time pause
        if (next === 45 && !htShow) {
          setPaused(true);
          setHtShow(true);
          setTimeout(() => { setPaused(false); }, 1500);
        }
        return next;
      });
    }, interval);
    return () => clearInterval(timer);
  }, [paused, finished, speed, maxMin, htShow]);

  // Process events
  useEffect(() => {
    const newEvents = allEvents.filter(e => e.minute <= minute && !shownEvents.includes(e));
    if (newEvents.length === 0) return;

    const latest = newEvents[newEvents.length - 1];
    setShownEvents(prev => [...prev, ...newEvents]);
    setFlashEvent(latest);

    // Score update
    let h = 0, a = 0;
    for (const e of [...shownEvents, ...newEvents]) {
      if (e.type === 'goal' || e.type === 'penalty_goal') {
        if (e.teamId === result.homeTeamId) h++; else a++;
      }
    }
    setHomeScore(h);
    setAwayScore(a);

    // Goal flash effect
    if (latest.type === 'goal' || latest.type === 'penalty_goal') {
      const side = latest.teamId === result.homeTeamId ? 'home' : 'away';
      setGoalFlash(side);
      setTimeout(() => setGoalFlash(null), 2500);
    }

    setTimeout(() => setFlashEvent(null), 3000);
    // Auto-scroll log
    setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }), 100);
  }, [minute]);

  const skip = useCallback(() => {
    setMinute(maxMin); setFinished(true);
    setHomeScore(allEvents.filter(e => (e.type === 'goal' || e.type === 'penalty_goal') && e.teamId === result.homeTeamId).length);
    setAwayScore(allEvents.filter(e => (e.type === 'goal' || e.type === 'penalty_goal') && e.teamId === result.awayTeamId).length);
    setShownEvents(allEvents);
  }, [allEvents, maxMin, result]);

  // Commentary text for current state
  const commentary = useMemo(() => {
    if (finished) return '比赛结束！全场战罢。';
    if (htShow && minute === 45) return '中场休息 — 双方回到更衣室';
    if (minute < 3) return '开球！比赛正式开始';
    if (minute >= 85) return '比赛进入伤停补时阶段...';
    if (minute >= 70) return '比赛进入最后阶段';
    if (minute === 46) return '下半场开始！';
    if (flashEvent?.type === 'goal' || flashEvent?.type === 'penalty_goal') return '进球了！！！';
    if (flashEvent?.type === 'save') return '门将做出精彩扑救！';
    if (flashEvent?.type === 'yellow_card') return '裁判出示黄牌警告';
    if (flashEvent?.type === 'red_card') return '红牌！有球员被罚下！';
    return '';
  }, [minute, finished, htShow, flashEvent]);

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[200] flex items-center justify-center p-3">
      <div className={`bg-slate-900 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-scale-in border ${
        goalFlash ? (goalFlash === 'home' ? 'border-green-500/50' : 'border-green-500/50') : 'border-slate-800'
      } transition-colors duration-500`}>

        {/* Header bar */}
        <div className="bg-slate-800/80 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${finished ? 'bg-red-500' : 'bg-green-500 animate-breathe'}`} />
            <span className="text-[11px] text-slate-400">{result.competitionName} · {result.roundLabel}</span>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${finished ? 'bg-red-900/40 text-red-400' : 'bg-green-900/40 text-green-400'}`}>
            {finished ? '全场结束' : `${minute}'`}
          </span>
        </div>

        {/* Scoreboard with team colors */}
        <div className="relative overflow-hidden"
          style={{ background: `linear-gradient(90deg, ${ht?.color ?? '#333'}18 0%, #0f172a 40%, #0f172a 60%, ${at?.color ?? '#333'}18 100%)` }}
        >
          {/* Goal flash overlay */}
          {goalFlash && (
            <div className="absolute inset-0 animate-fade-in" style={{
              background: goalFlash === 'home'
                ? `radial-gradient(circle at 25% 50%, ${ht?.color ?? '#22c55e'}30, transparent 70%)`
                : `radial-gradient(circle at 75% 50%, ${at?.color ?? '#22c55e'}30, transparent 70%)`,
            }} />
          )}

          <div className="relative flex items-center justify-center py-5 px-4 gap-2">
            {/* Home */}
            <div className="flex-1 text-right">
              <div className="flex items-center gap-2 justify-end">
                <span className="text-sm sm:text-lg font-bold text-slate-100 truncate">{ht?.name ?? '主队'}</span>
                <span className="w-4 h-4 rounded-full shrink-0 border border-white/20" style={{ backgroundColor: ht?.color ?? '#666' }} />
              </div>
            </div>

            {/* Score */}
            <div className="flex items-center gap-3 px-4 min-w-[90px] justify-center">
              <span className={`text-4xl sm:text-5xl font-black tabular-nums transition-all duration-300 ${
                homeScore > awayScore ? 'text-green-400' : 'text-white'
              } ${goalFlash === 'home' ? 'animate-score-pop scale-110' : ''}`}>
                {homeScore}
              </span>
              <span className="text-2xl text-slate-700 font-light">-</span>
              <span className={`text-4xl sm:text-5xl font-black tabular-nums transition-all duration-300 ${
                awayScore > homeScore ? 'text-green-400' : 'text-white'
              } ${goalFlash === 'away' ? 'animate-score-pop scale-110' : ''}`}>
                {awayScore}
              </span>
            </div>

            {/* Away */}
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full shrink-0 border border-white/20" style={{ backgroundColor: at?.color ?? '#666' }} />
                <span className="text-sm sm:text-lg font-bold text-slate-100 truncate">{at?.name ?? '客队'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Pitch */}
        <div className="px-3 py-2">
          <PitchCanvas
            minute={minute}
            maxMinute={maxMin}
            homeColor={ht?.color ?? '#ef4444'}
            awayColor={at?.color ?? '#3b82f6'}
            homeTeamId={result.homeTeamId}
            flashEvent={flashEvent}
            allEvents={allEvents}
            finished={finished}
            halftime={htShow && minute >= 45 && minute <= 46}
          />
        </div>

        {/* Commentary line */}
        {commentary && (
          <div className="px-4 py-1">
            <p className="text-[11px] text-emerald-400/80 italic animate-slide-up" key={commentary}>{commentary}</p>
          </div>
        )}

        {/* Progress bar with markers */}
        <div className="px-4 py-1">
          <div className="relative h-2 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all duration-300" style={{ width: `${(minute / maxMin) * 100}%` }} />
            {/* HT marker */}
            <div className="absolute top-0 bottom-0 w-px bg-slate-600" style={{ left: `${(45 / maxMin) * 100}%` }} />
            {/* Goal markers */}
            {shownEvents.filter(e => e.type === 'goal' || e.type === 'penalty_goal').map((e, i) => (
              <div key={i} className="absolute top-0 w-1 h-full bg-amber-400 rounded-full" style={{ left: `${(e.minute / maxMin) * 100}%` }} />
            ))}
          </div>
          <div className="flex justify-between text-[9px] text-slate-600 mt-0.5">
            <span>0'</span><span>45'</span><span>{maxMin}'</span>
          </div>
        </div>

        {/* Event log */}
        <div ref={logRef} className="px-4 py-1 max-h-24 overflow-y-auto scroll-smooth">
          {[...shownEvents].reverse().filter(e =>
            e.type === 'goal' || e.type === 'penalty_goal' || e.type === 'yellow_card' || e.type === 'red_card' || e.type === 'save'
          ).slice(0, 6).map((e, i) => (
            <div key={i} className={`flex items-center gap-2 text-[11px] py-0.5 ${i === 0 ? 'text-slate-200' : 'text-slate-500'}`}>
              <span className="w-6 text-right font-mono text-[10px]">{e.minute}'</span>
              <span className="text-sm">{EVENT_ICONS[e.type] ?? '•'}</span>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: e.teamId === result.homeTeamId ? ht?.color : at?.color }} />
              <span className="truncate">{e.description}</span>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div className="px-4 py-2.5 border-t border-slate-800/60 flex items-center justify-between">
          <div className="flex gap-1">
            {[1, 2, 4].map(s => (
              <button key={s} onClick={() => setSpeed(s)}
                className={`px-2.5 py-1 text-[10px] rounded-md cursor-pointer transition-colors ${speed === s ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
              >{s}x</button>
            ))}
            <button onClick={() => setPaused(!paused)}
              className="px-2.5 py-1 text-[10px] rounded-md bg-slate-800 text-slate-400 hover:bg-slate-700 cursor-pointer"
            >{paused ? '继续' : '暂停'}</button>
          </div>
          <div className="flex gap-2">
            {!finished && <button onClick={skip} className="px-3 py-1 text-[10px] text-slate-500 hover:text-slate-300 cursor-pointer">跳过 →</button>}
            <button onClick={onClose} className="px-3 py-1 text-[10px] bg-slate-800 text-slate-300 hover:bg-slate-700 rounded-md cursor-pointer">
              {finished ? '关闭' : '退出'}
            </button>
          </div>
        </div>

        {/* Final results */}
        {finished && (
          <div className="px-4 pb-3 text-center space-y-1 animate-slide-up">
            {result.extraTime && <span className="text-[10px] text-amber-400 block">加时赛 {result.etHomeGoals ?? 0} - {result.etAwayGoals ?? 0}</span>}
            {result.penalties && <span className="text-[10px] text-amber-400 block">点球大战 {result.penaltyHome} - {result.penaltyAway}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

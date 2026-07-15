import { useEffect, useReducer, useRef, useCallback, useMemo } from 'react';
import { useSwipe } from '../utils/use-swipe';
import type { MatchResult, MatchEvent } from '../types/match';
import type { TeamBase } from '../types/team';
import PitchCanvas from './PitchCanvas';
import { Icon, IconName } from './Icon';

interface Props {
  result: MatchResult;
  teamBases: Record<string, TeamBase>;
  onClose: () => void;
}

const EVENT_ICONS: Record<string, { name: IconName; accent?: string }> = {
  goal:         { name: 'ball' },
  penalty_goal: { name: 'ball', accent: '#fbbf24' },
  own_goal:     { name: 'ball', accent: '#ef4444' },
  yellow_card:  { name: 'warning', accent: '#facc15' },
  red_card:     { name: 'warning', accent: '#ef4444' },
  save:         { name: 'gloves' },
  miss:         { name: 'x' },
  penalty_miss: { name: 'x', accent: '#fbbf24' },
  gk_save:      { name: 'gloves', accent: '#3b82f6' },
  df_block:     { name: 'shield', accent: '#3b82f6' },
  assist:       { name: 'sparkle', accent: '#a78bfa' },
  substitution: { name: 'refresh', accent: '#38bdf8' },
};

type PlaybackPhase = 'playing' | 'paused' | 'halftime' | 'finished';

interface PlaybackState {
  minute: number;
  speed: number;
  phase: PlaybackPhase;
  consumedEventCount: number;
  homeScore: number;
  awayScore: number;
  flashEvent: MatchEvent | null;
  goalFlash: 'home' | 'away' | null;
  flashVersion: number;
  goalFlashVersion: number;
  hasHadHalftime: boolean;
}

type PlaybackAction =
  | { type: 'tick'; events: MatchEvent[]; maxMinute: number; homeTeamId: string }
  | { type: 'skip'; events: MatchEvent[]; maxMinute: number; homeTeamId: string }
  | { type: 'setSpeed'; speed: number }
  | { type: 'togglePause' }
  | { type: 'resumeHalftime' }
  | { type: 'clearEventFlash'; version: number }
  | { type: 'clearGoalFlash'; version: number };

const initialPlaybackState: PlaybackState = {
  minute: 0,
  speed: 1,
  phase: 'playing',
  consumedEventCount: 0,
  homeScore: 0,
  awayScore: 0,
  flashEvent: null,
  goalFlash: null,
  flashVersion: 0,
  goalFlashVersion: 0,
  hasHadHalftime: false,
};

function isScoreEvent(event: MatchEvent): boolean {
  return event.type === 'goal' || event.type === 'own_goal' || event.type === 'penalty_goal';
}

function revealThroughMinute(
  state: PlaybackState,
  targetMinute: number,
  events: MatchEvent[],
  homeTeamId: string,
): PlaybackState {
  let nextEventCount = state.consumedEventCount;
  let homeScore = state.homeScore;
  let awayScore = state.awayScore;
  let latestEvent: MatchEvent | null = null;
  let latestGoal: MatchEvent | null = null;

  while (nextEventCount < events.length && events[nextEventCount].minute <= targetMinute) {
    const event = events[nextEventCount];
    latestEvent = event;
    if (isScoreEvent(event)) {
      latestGoal = event;
      if (event.teamId === homeTeamId) homeScore++;
      else awayScore++;
    }
    nextEventCount++;
  }

  if (!latestEvent) return { ...state, minute: targetMinute };
  return {
    ...state,
    minute: targetMinute,
    consumedEventCount: nextEventCount,
    homeScore,
    awayScore,
    flashEvent: latestGoal ?? latestEvent,
    goalFlash: latestGoal ? (latestGoal.teamId === homeTeamId ? 'home' : 'away') : state.goalFlash,
    flashVersion: state.flashVersion + 1,
    goalFlashVersion: latestGoal ? state.goalFlashVersion + 1 : state.goalFlashVersion,
  };
}

function playbackReducer(state: PlaybackState, action: PlaybackAction): PlaybackState {
  switch (action.type) {
    case 'tick': {
      if (state.phase !== 'playing') return state;
      const nextMinute = Math.min(action.maxMinute, state.minute + 1);
      const next = revealThroughMinute(state, nextMinute, action.events, action.homeTeamId);
      if (nextMinute === 45 && !state.hasHadHalftime) {
        return { ...next, phase: 'halftime', hasHadHalftime: true };
      }
      if (nextMinute >= action.maxMinute) return { ...next, phase: 'finished' };
      return next;
    }
    case 'skip': {
      const completed = revealThroughMinute(state, action.maxMinute, action.events, action.homeTeamId);
      return {
        ...completed,
        phase: 'finished',
        hasHadHalftime: true,
        flashEvent: null,
        goalFlash: null,
      };
    }
    case 'setSpeed':
      return { ...state, speed: action.speed };
    case 'togglePause':
      if (state.phase === 'playing') return { ...state, phase: 'paused' };
      if (state.phase === 'paused') return { ...state, phase: 'playing' };
      return state;
    case 'resumeHalftime':
      return state.phase === 'halftime' ? { ...state, phase: 'playing' } : state;
    case 'clearEventFlash':
      return action.version === state.flashVersion ? { ...state, flashEvent: null } : state;
    case 'clearGoalFlash':
      return action.version === state.goalFlashVersion ? { ...state, goalFlash: null } : state;
  }
}

function playbackKey(result: MatchResult): string {
  const eventKey = result.events.map(event =>
    `${event.minute}:${event.type}:${event.teamId}:${event.playerId ?? ''}`,
  ).join(',');
  return `${result.fixtureId}:${result.homeGoals}:${result.awayGoals}:${result.etHomeGoals ?? 0}:${result.etAwayGoals ?? 0}:${eventKey}`;
}

export default function MatchLive(props: Props) {
  return <MatchLiveSession key={playbackKey(props.result)} {...props} />;
}

function MatchLiveSession({ result, teamBases, onClose }: Props) {
  const [playback, dispatch] = useReducer(playbackReducer, initialPlaybackState);
  const logRef = useRef<HTMLDivElement>(null);

  const ht = teamBases[result.homeTeamId];
  const at = teamBases[result.awayTeamId];
  const maxMin = result.extraTime ? 120 : 90;

  const allEvents = useMemo(() =>
    [...result.events].filter(e => e.minute <= maxMin).sort((a, b) => a.minute - b.minute),
    [result.events, maxMin]
  );
  const shownEvents = allEvents.slice(0, playback.consumedEventCount);
  const finished = playback.phase === 'finished';
  const paused = playback.phase === 'paused';
  const halftime = playback.phase === 'halftime';

  // Tick — slowed down for broadcast-style pacing
  // At 1x: 280ms per game minute → ~25s for 90 mins (was 10.8s, too fast)
  useEffect(() => {
    if (playback.phase !== 'playing') return;
    const interval = Math.max(60, 280 / playback.speed);
    const timer = window.setInterval(() => {
      dispatch({ type: 'tick', events: allEvents, maxMinute: maxMin, homeTeamId: result.homeTeamId });
    }, interval);
    return () => clearInterval(timer);
  }, [playback.phase, playback.speed, allEvents, maxMin, result.homeTeamId]);

  useEffect(() => {
    if (!halftime) return;
    const timer = window.setTimeout(() => dispatch({ type: 'resumeHalftime' }), 2000);
    return () => clearTimeout(timer);
  }, [halftime]);

  useEffect(() => {
    if (!playback.flashEvent) return;
    const version = playback.flashVersion;
    const timer = window.setTimeout(() => dispatch({ type: 'clearEventFlash', version }), 3000);
    return () => clearTimeout(timer);
  }, [playback.flashEvent, playback.flashVersion]);

  useEffect(() => {
    if (!playback.goalFlash) return;
    const version = playback.goalFlashVersion;
    const timer = window.setTimeout(() => dispatch({ type: 'clearGoalFlash', version }), 2500);
    return () => clearTimeout(timer);
  }, [playback.goalFlash, playback.goalFlashVersion]);

  useEffect(() => {
    if (playback.consumedEventCount === 0) return;
    const timer = window.setTimeout(() => {
      logRef.current?.scrollTo?.({ top: logRef.current.scrollHeight, behavior: 'smooth' });
    }, 100);
    return () => clearTimeout(timer);
  }, [playback.consumedEventCount]);

  const skip = useCallback(() => {
    dispatch({ type: 'skip', events: allEvents, maxMinute: maxMin, homeTeamId: result.homeTeamId });
  }, [allEvents, maxMin, result.homeTeamId]);

  // Commentary text for current state
  const commentary = useMemo(() => {
    if (finished) return '比赛结束！全场战罢。';
    if (halftime) return '中场休息 — 双方回到更衣室';
    if (playback.flashEvent?.type === 'goal' || playback.flashEvent?.type === 'penalty_goal' || playback.flashEvent?.type === 'own_goal') return '进球了！！！';
    if (playback.flashEvent?.type === 'save' || playback.flashEvent?.type === 'gk_save') return '门将做出精彩扑救！';
    if (playback.flashEvent?.type === 'df_block') return '后卫在门线上完成关键封堵！';
    if (playback.flashEvent?.type === 'miss' || playback.flashEvent?.type === 'penalty_miss') return '射门偏出，错失机会';
    if (playback.flashEvent?.type === 'yellow_card') return '裁判出示黄牌警告';
    if (playback.flashEvent?.type === 'red_card') return '红牌！有球员被罚下！';
    if (playback.flashEvent?.type === 'substitution') return playback.flashEvent.description;
    if (playback.minute < 3) return '开球！比赛正式开始';
    if (playback.minute >= 85) return '比赛进入伤停补时阶段...';
    if (playback.minute >= 70) return '比赛进入最后阶段';
    if (playback.minute === 46) return '下半场开始！';
    return '';
  }, [playback.minute, playback.flashEvent, finished, halftime]);

  // Mobile — swipe down on overlay or content to close
  const swipeRef = useSwipe<HTMLDivElement>({
    onSwipeDown: onClose,
    threshold: 60,
  });

  return (
    <div
      ref={swipeRef}
      className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[200] flex items-center justify-center p-3"
    >
      <div className={`bg-slate-900 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-scale-in border ${
        playback.goalFlash ? 'border-green-500/50' : 'border-slate-800'
      } transition-colors duration-500`}>

        {/* Header bar */}
        <div className="bg-slate-800/80 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${finished ? 'bg-red-500' : 'bg-green-500 animate-breathe'}`} />
            <span className="text-[11px] text-slate-400">{result.competitionName} · {result.roundLabel}</span>
          </div>
          <span data-testid="live-minute" className={`text-[10px] px-2 py-0.5 rounded-full ${finished ? 'bg-red-900/40 text-red-400' : 'bg-green-900/40 text-green-400'}`}>
            {finished ? '全场结束' : `${playback.minute}'`}
          </span>
        </div>

        {/* Scoreboard with team colors */}
        <div className="relative overflow-hidden"
          style={{ background: `linear-gradient(90deg, ${ht?.color ?? '#333'}18 0%, #0f172a 40%, #0f172a 60%, ${at?.color ?? '#333'}18 100%)` }}
        >
          {/* Goal flash overlay */}
          {playback.goalFlash && (
            <div className="absolute inset-0 animate-fade-in" style={{
              background: playback.goalFlash === 'home'
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
              <span aria-label="主队比分" className={`text-4xl sm:text-5xl font-black tabular-nums transition-all duration-300 ${
                playback.homeScore > playback.awayScore ? 'text-green-400' : 'text-white'
              } ${playback.goalFlash === 'home' ? 'animate-score-pop scale-110' : ''}`}>
                {playback.homeScore}
              </span>
              <span className="text-2xl text-slate-700 font-light">-</span>
              <span aria-label="客队比分" className={`text-4xl sm:text-5xl font-black tabular-nums transition-all duration-300 ${
                playback.awayScore > playback.homeScore ? 'text-green-400' : 'text-white'
              } ${playback.goalFlash === 'away' ? 'animate-score-pop scale-110' : ''}`}>
                {playback.awayScore}
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
            minute={playback.minute}
            maxMinute={maxMin}
            homeColor={ht?.color ?? '#ef4444'}
            awayColor={at?.color ?? '#3b82f6'}
            homeTeamId={result.homeTeamId}
            flashEvent={playback.flashEvent}
            allEvents={allEvents}
            homeMatchday={result.homeMatchday}
            awayMatchday={result.awayMatchday}
            finished={finished}
            halftime={halftime}
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
            <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all duration-300" style={{ width: `${(playback.minute / maxMin) * 100}%` }} />
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
            e.type === 'goal' || e.type === 'penalty_goal' || e.type === 'own_goal'
            || e.type === 'yellow_card' || e.type === 'red_card'
            || e.type === 'save' || e.type === 'gk_save' || e.type === 'df_block'
            || e.type === 'miss' || e.type === 'penalty_miss' || e.type === 'substitution'
          ).slice(0, 6).map((e, i) => (
            <div key={i} className={`flex items-center gap-2 text-[11px] py-0.5 ${i === 0 ? 'text-slate-200' : 'text-slate-500'}`}>
              <span className="w-6 text-right font-mono text-[10px]">{e.minute}'</span>
              <span className="text-sm inline-flex items-center justify-center w-4 h-4">
                {EVENT_ICONS[e.type]
                  ? <Icon name={EVENT_ICONS[e.type].name} size={14} accent={EVENT_ICONS[e.type].accent} />
                  : <span>•</span>}
              </span>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: e.teamId === result.homeTeamId ? ht?.color : at?.color }} />
              <span className="truncate">{e.description}</span>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div className="px-4 py-2.5 border-t border-slate-800/60 flex items-center justify-between">
          <div className="flex gap-1">
            {[1, 2, 4].map(s => (
              <button key={s} onClick={() => dispatch({ type: 'setSpeed', speed: s })}
                className={`px-2.5 py-1 text-[10px] rounded-md cursor-pointer transition-colors ${playback.speed === s ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
              >{s}x</button>
            ))}
            <button onClick={() => dispatch({ type: 'togglePause' })} disabled={halftime}
              className="px-2.5 py-1 text-[10px] rounded-md bg-slate-800 text-slate-400 hover:bg-slate-700 cursor-pointer disabled:cursor-default disabled:opacity-60"
            >{halftime ? '中场' : paused ? '继续' : '暂停'}</button>
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

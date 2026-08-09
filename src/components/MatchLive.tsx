import { useEffect, useReducer, useRef, useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MatchResult, MatchEvent } from '../types/match';
import type { TeamBase } from '../types/team';
import PitchCanvas from './PitchCanvas';
import { Icon, IconName } from './Icon';
import {
  isHighlightEvent,
  nextPlaybackStep,
  playbackBreakDelay,
  playbackTickDelay,
  PLAYBACK_MODE_OPTIONS,
  type PlaybackMode,
} from './match-live/playback-mode';
import { playGameFeedback, unlockGameAudio } from '../feedback/game-feedback';
import { createMatchSoundscape, type MatchSoundscape } from '../feedback/match-soundscape';
import {
  setFeedbackPreferences,
  useFeedbackPreferences,
} from '../feedback/preferences';
import liveScoreboardArtwork from '../assets/visual/live-scoreboard-v1.webp';
import keyMatchOpenerArtwork from '../assets/visual/key-match-opener-v1.webp';
import { DecorativeImage } from './DecorativeImage';
import TeamBadge from './TeamBadge';
import {
  buildLiveCommentary,
  buildLiveCommentaryHistory,
  shootoutEventLabel,
} from './match-live/live-commentary';

interface Props {
  result: MatchResult;
  teamBases: Record<string, TeamBase>;
  onClose: () => void;
  /** Opens with a spoiler-free broadcast slate before revealing the 0-0 clock. */
  featured?: boolean;
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
  corner:       { name: 'flag', accent: '#fbbf24' },
  free_kick:    { name: 'whistle', accent: '#7dd3fc' },
};

type PlaybackPhase = 'playing' | 'paused' | 'halftime' | 'extra_time_break' | 'shootout_break' | 'finished';

interface PlaybackState {
  minute: number;
  mode: PlaybackMode;
  phase: PlaybackPhase;
  consumedEventCount: number;
  homeScore: number;
  awayScore: number;
  penaltyHomeScore: number;
  penaltyAwayScore: number;
  flashEvent: MatchEvent | null;
  goalFlash: 'home' | 'away' | null;
  flashVersion: number;
  goalFlashVersion: number;
  hasHadHalftime: boolean;
  hasHadExtraTimeBreak: boolean;
  hasHadShootoutBreak: boolean;
}

type PlaybackAction =
  | { type: 'tick'; events: MatchEvent[]; maxMinute: number; homeTeamId: string }
  | { type: 'skip'; events: MatchEvent[]; maxMinute: number; homeTeamId: string }
  | { type: 'setMode'; mode: PlaybackMode }
  | { type: 'togglePause' }
  | { type: 'resumeBreak' }
  | { type: 'clearEventFlash'; version: number }
  | { type: 'clearGoalFlash'; version: number };

const initialPlaybackState: PlaybackState = {
  minute: 0,
  mode: 'live',
  phase: 'playing',
  consumedEventCount: 0,
  homeScore: 0,
  awayScore: 0,
  penaltyHomeScore: 0,
  penaltyAwayScore: 0,
  flashEvent: null,
  goalFlash: null,
  flashVersion: 0,
  goalFlashVersion: 0,
  hasHadHalftime: false,
  hasHadExtraTimeBreak: false,
  hasHadShootoutBreak: false,
};

function getPlaybackStageLabel(
  state: Pick<PlaybackState, 'minute' | 'phase'>,
  hasPenalties: boolean,
): string {
  if (state.phase === 'finished') return '全场';
  if (state.phase === 'halftime') return '中场';
  if (state.phase === 'extra_time_break') return '加时前';
  if (state.phase === 'shootout_break') return '点球前';
  if (hasPenalties && state.minute > 120) return '点球大战';
  if (state.minute > 90) return '加时赛';
  if (state.minute > 45) return '下半场';
  return '上半场';
}

function isScoreEvent(event: MatchEvent): boolean {
  return event.type === 'goal' || event.type === 'own_goal';
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
  let penaltyHomeScore = state.penaltyHomeScore;
  let penaltyAwayScore = state.penaltyAwayScore;
  let latestEvent: MatchEvent | null = null;
  let latestGoal: MatchEvent | null = null;

  while (nextEventCount < events.length && events[nextEventCount].minute <= targetMinute) {
    const event = events[nextEventCount];
    latestEvent = event;
    if (isScoreEvent(event)) {
      latestGoal = event;
      if (event.teamId === homeTeamId) homeScore++;
      else awayScore++;
    } else if (event.type === 'penalty_goal') {
      latestGoal = event;
      if (event.teamId === homeTeamId) penaltyHomeScore++;
      else penaltyAwayScore++;
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
    penaltyHomeScore,
    penaltyAwayScore,
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
      const requestedMinute = Math.min(
        action.maxMinute,
        state.minute + nextPlaybackStep(state.minute, action.maxMinute, action.events, state.mode),
      );
      let nextMinute = requestedMinute;
      if (state.minute < 45 && requestedMinute >= 45 && !state.hasHadHalftime) nextMinute = 45;
      else if (state.minute < 90 && requestedMinute >= 90 && action.maxMinute > 90 && !state.hasHadExtraTimeBreak) nextMinute = 90;
      else if (state.minute < 120 && requestedMinute >= 120 && action.maxMinute > 120 && !state.hasHadShootoutBreak) nextMinute = 120;
      const next = revealThroughMinute(state, nextMinute, action.events, action.homeTeamId);
      if (nextMinute === 45 && !state.hasHadHalftime) {
        return { ...next, phase: 'halftime', hasHadHalftime: true };
      }
      if (nextMinute === 90 && action.maxMinute > 90 && !state.hasHadExtraTimeBreak) {
        return { ...next, phase: 'extra_time_break', hasHadExtraTimeBreak: true };
      }
      if (nextMinute === 120 && action.maxMinute > 120 && !state.hasHadShootoutBreak) {
        return { ...next, phase: 'shootout_break', hasHadShootoutBreak: true };
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
        hasHadExtraTimeBreak: action.maxMinute > 90,
        hasHadShootoutBreak: action.maxMinute > 120,
        flashEvent: null,
        goalFlash: null,
      };
    }
    case 'setMode':
      return { ...state, mode: action.mode };
    case 'togglePause':
      if (state.phase === 'playing') return { ...state, phase: 'paused' };
      if (state.phase === 'paused') return { ...state, phase: 'playing' };
      return state;
    case 'resumeBreak':
      return state.phase === 'halftime' || state.phase === 'extra_time_break' || state.phase === 'shootout_break'
        ? { ...state, phase: 'playing' }
        : state;
    case 'clearEventFlash':
      return action.version === state.flashVersion ? { ...state, flashEvent: null } : state;
    case 'clearGoalFlash':
      return action.version === state.goalFlashVersion ? { ...state, goalFlash: null } : state;
  }
}

function playbackKey(result: MatchResult): string {
  const eventKey = result.events.map((event, index) =>
    `${index}:${event.minute}:${event.type}:${event.teamId}:${event.playerId ?? ''}`,
  ).join(',');
  return `${result.fixtureId}:${result.homeGoals}:${result.awayGoals}:${result.etHomeGoals ?? 0}:${result.etAwayGoals ?? 0}:${eventKey}`;
}

function ShootoutTracker({
  events,
  homeTeamId,
  homeName,
  awayName,
  homeColor,
  awayColor,
  homeScore,
  awayScore,
  nextEvent,
}: {
  events: MatchEvent[];
  homeTeamId: string;
  homeName: string;
  awayName: string;
  homeColor: string;
  awayColor: string;
  homeScore: number;
  awayScore: number;
  nextEvent?: MatchEvent;
}) {
  const homeKicks = events.filter(event => event.teamId === homeTeamId);
  const awayKicks = events.filter(event => event.teamId !== homeTeamId);
  const slotCount = Math.max(5, homeKicks.length, awayKicks.length);
  const latest = events.at(-1);
  const stage = latest?.shootout?.suddenDeath
    ? `突然死亡 · 第${latest.shootout.round - 5}轮`
    : `点球大战 · 第${latest?.shootout?.round ?? 1}轮`;
  const nextTeamName = nextEvent?.teamId === homeTeamId ? homeName : awayName;
  const nextTeamScore = nextEvent?.teamId === homeTeamId ? homeScore : awayScore;
  const opponentScore = nextEvent?.teamId === homeTeamId ? awayScore : homeScore;
  const nextTeamTaken = Math.max(0, (nextEvent?.shootout?.teamKickNumber ?? 1) - 1);
  const opponentTaken = events.filter(event => event.teamId !== nextEvent?.teamId).length;
  const nextKickWins = Boolean(nextEvent && !nextEvent.shootout?.suddenDeath
    && nextTeamScore + 1 > opponentScore + Math.max(0, 5 - opponentTaken));
  const mustScore = Boolean(nextEvent && !nextEvent.shootout?.suddenDeath
    && nextTeamScore + Math.max(0, 5 - nextTeamTaken) <= opponentScore);
  const pressure = !nextEvent
    ? '逐罚结束'
    : nextEvent.shootout?.suddenDeath
      ? `${nextTeamName}进入突然死亡主罚`
      : mustScore
        ? `${nextTeamName}必须罚进`
        : nextKickWins
          ? `${nextTeamName}命中即可结束`
          : `${nextTeamName}即将主罚`;

  const row = (name: string, color: string, kicks: MatchEvent[], score: number) => (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate text-[11px] font-semibold text-slate-300" title={name}>{name}</span>
      </div>
      <div className="flex flex-wrap justify-end gap-1" aria-label={`${name}点球记录`}>
        {Array.from({ length: slotCount }, (_, index) => {
          const kick = kicks[index];
          const scored = kick?.type === 'penalty_goal';
          return (
            <span
              key={index}
              title={kick?.description ?? '尚未主罚'}
              className={`h-3 w-3 rounded-full border ${
                !kick
                  ? 'border-slate-600 bg-transparent'
                  : scored
                    ? 'border-emerald-300 bg-emerald-400'
                    : 'border-rose-300 bg-rose-500'
              }`}
            />
          );
        })}
      </div>
      <span className="w-5 text-right text-sm font-black tabular-nums text-amber-300">{score}</span>
    </div>
  );

  return (
    <div data-testid="shootout-tracker" className="border-y border-amber-400/15 bg-amber-400/[0.04] px-4 py-2.5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold text-amber-300">{stage}</span>
        <span className="text-[10px] text-slate-500">{pressure} · <span className="tabular-nums">{homeScore} - {awayScore}</span></span>
      </div>
      <div className="space-y-1.5">
        {row(homeName, homeColor, homeKicks, homeScore)}
        {row(awayName, awayColor, awayKicks, awayScore)}
      </div>
    </div>
  );
}

export default function MatchLive(props: Props) {
  return <MatchLiveSession key={`${playbackKey(props.result)}:${props.featured ? 'featured' : 'standard'}`} {...props} />;
}

function MatchLiveSession({ result, teamBases, onClose, featured = false }: Props) {
  const [playback, dispatch] = useReducer(playbackReducer, initialPlaybackState);
  const [locallyMuted, setLocallyMuted] = useState(false);
  const feedbackPreferences = useFeedbackPreferences();
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== 'hidden');
  const [reducedMotion, setReducedMotion] = useState(() =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );
  const [followingLiveFeed, setFollowingLiveFeed] = useState(true);
  const [unseenEventCount, setUnseenEventCount] = useState(0);
  const [presentationHolding, setPresentationHolding] = useState(false);
  const prestigeOpener = featured || result.roundLabel === 'Final' || result.roundLabel === '决赛';
  const [showOpener, setShowOpener] = useState(prestigeOpener);
  const logRef = useRef<HTMLDivElement>(null);
  const previousCommentaryCountRef = useRef<number | null>(null);
  const soundscapeRef = useRef<MatchSoundscape | null>(null);
  const previousPhaseRef = useRef<PlaybackPhase>(initialPlaybackState.phase);

  const ht = teamBases[result.homeTeamId];
  const at = teamBases[result.awayTeamId];
  const maxMin = result.extraTime ? 120 : 90;
  const timelineMax = result.penalties
    ? Math.max(121, ...result.events.filter(event => event.type === 'penalty_goal' || event.type === 'penalty_miss').map(event => event.minute))
    : maxMin;

  const allEvents = useMemo(() => {
    let homeKickCount = 0;
    let awayKickCount = 0;
    return result.events.map((sourceEvent, order) => {
      let event = sourceEvent;
      if ((event.type === 'penalty_goal' || event.type === 'penalty_miss') && !event.shootout) {
        const isHome = event.teamId === result.homeTeamId;
        const teamKickNumber = isHome ? ++homeKickCount : ++awayKickCount;
        event = {
          ...event,
          shootout: {
            kickNumber: homeKickCount + awayKickCount,
            round: teamKickNumber,
            teamKickNumber,
            suddenDeath: teamKickNumber > 5,
            outcome: event.type === 'penalty_goal' ? 'scored' : 'off_target',
          },
        };
      }
      return { event, order };
    })
      .filter(({ event }) => event.minute <= timelineMax)
      .sort((a, b) => a.event.minute - b.event.minute || a.order - b.order)
      .map(({ event }) => event);
  }, [result.events, result.homeTeamId, timelineMax]);
  const shownEvents = allEvents.slice(0, playback.consumedEventCount);
  const finished = playback.phase === 'finished';
  const paused = playback.phase === 'paused';
  const halftime = playback.phase === 'halftime';
  const extraTimeBreak = playback.phase === 'extra_time_break';
  const shootoutBreak = playback.phase === 'shootout_break';
  const isBreak = halftime || extraTimeBreak || shootoutBreak;
  const stageLabel = getPlaybackStageLabel(playback, Boolean(result.penalties));
  const shootoutEvents = shownEvents.filter(event => event.type === 'penalty_goal' || event.type === 'penalty_miss');
  const inShootout = Boolean(result.penalties && playback.minute > 120);

  useEffect(() => {
    if (!showOpener) return;
    const timer = window.setTimeout(
      () => setShowOpener(false),
      reducedMotion ? 650 : 2200,
    );
    return () => window.clearTimeout(timer);
  }, [reducedMotion, showOpener]);

  useEffect(() => {
    const soundscape = createMatchSoundscape({
      result,
      featured: prestigeOpener,
      muted: !feedbackPreferences.soundEnabled || locallyMuted,
    });
    soundscapeRef.current = soundscape;
    if (feedbackPreferences.soundEnabled && !locallyMuted) soundscape.start();
    return () => {
      soundscape.stop();
      if (soundscapeRef.current === soundscape) soundscapeRef.current = null;
    };
    // Each MatchLiveSession is keyed by result and presentation, so this owns
    // exactly one soundscape lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    soundscapeRef.current?.setMuted(!feedbackPreferences.soundEnabled || locallyMuted || !pageVisible);
  }, [feedbackPreferences.soundEnabled, locallyMuted, pageVisible]);

  useEffect(() => {
    soundscapeRef.current?.update({
      minute: playback.minute,
      maxMinute: timelineMax,
      homeScore: playback.homeScore,
      awayScore: playback.awayScore,
      inShootout,
      paused: playback.phase !== 'playing' || showOpener,
    });
  }, [
    inShootout,
    playback.awayScore,
    playback.homeScore,
    playback.minute,
    playback.phase,
    showOpener,
    timelineMax,
  ]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    const handleVisibilityChange = () => setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const handleChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener?.('change', handleChange);
    return () => query.removeEventListener?.('change', handleChange);
  }, []);

  useEffect(() => {
    if (playback.phase !== 'playing' || !pageVisible || showOpener || presentationHolding) return;
    const nextHighlight = allEvents.find(event =>
      event.minute > playback.minute && isHighlightEvent(event)
    );
    const delay = playbackTickDelay(
      playback.mode,
      playback.minute,
      playback.flashEvent,
      reducedMotion,
      nextHighlight,
    );
    const timer = window.setTimeout(() => {
      dispatch({ type: 'tick', events: allEvents, maxMinute: timelineMax, homeTeamId: result.homeTeamId });
    }, delay);
    return () => clearTimeout(timer);
  }, [
    allEvents,
    pageVisible,
    playback.flashEvent,
    playback.minute,
    playback.mode,
    playback.phase,
    presentationHolding,
    reducedMotion,
    result.homeTeamId,
    showOpener,
    timelineMax,
  ]);

  useEffect(() => {
    if (!isBreak || !pageVisible) return;
    const timer = window.setTimeout(
      () => dispatch({ type: 'resumeBreak' }),
      playbackBreakDelay(playback.mode, reducedMotion),
    );
    return () => clearTimeout(timer);
  }, [isBreak, pageVisible, playback.mode, reducedMotion]);

  useEffect(() => {
    if (!feedbackPreferences.soundEnabled || locallyMuted || !playback.flashEvent) return;
    const soundscape = soundscapeRef.current;
    soundscape?.playEvent(playback.flashEvent);
    const isGoal = playback.flashEvent.type === 'goal'
      || playback.flashEvent.type === 'own_goal'
      || playback.flashEvent.type === 'penalty_goal';
    if (isGoal && !soundscape?.started) playGameFeedback('goal');
  }, [
    feedbackPreferences.soundEnabled,
    locallyMuted,
    playback.flashEvent,
    playback.flashVersion,
  ]);

  useEffect(() => {
    const previous = previousPhaseRef.current;
    previousPhaseRef.current = playback.phase;
    if (previous === playback.phase || !feedbackPreferences.soundEnabled || locallyMuted) return;
    if (playback.phase === 'halftime') soundscapeRef.current?.playStage('halftime');
    else if (playback.phase === 'extra_time_break') soundscapeRef.current?.playStage('extra_time');
    else if (playback.phase === 'shootout_break') soundscapeRef.current?.playStage('shootout');
    else if (playback.phase === 'finished') soundscapeRef.current?.playStage('fulltime');
  }, [feedbackPreferences.soundEnabled, locallyMuted, playback.phase]);

  useEffect(() => {
    if (!playback.flashEvent) return;
    const version = playback.flashVersion;
    const timer = window.setTimeout(
      () => dispatch({ type: 'clearEventFlash', version }),
      reducedMotion ? 400 : 3000,
    );
    return () => clearTimeout(timer);
  }, [playback.flashEvent, playback.flashVersion, reducedMotion]);

  useEffect(() => {
    if (!playback.goalFlash) return;
    const version = playback.goalFlashVersion;
    const timer = window.setTimeout(
      () => dispatch({ type: 'clearGoalFlash', version }),
      reducedMotion ? 350 : 2500,
    );
    return () => clearTimeout(timer);
  }, [playback.goalFlash, playback.goalFlashVersion, reducedMotion]);

  const commentaryEntries = useMemo(() => buildLiveCommentaryHistory({
    events: shownEvents,
    currentMinute: playback.minute,
    homeTeamId: result.homeTeamId,
    homeTeamName: ht?.name ?? '主队',
    awayTeamName: at?.name ?? '客队',
  }), [at?.name, ht?.name, playback.minute, result.homeTeamId, shownEvents]);

  useEffect(() => {
    const previousCount = previousCommentaryCountRef.current;
    previousCommentaryCountRef.current = commentaryEntries.length;
    if (previousCount === null) return;
    const added = Math.max(0, commentaryEntries.length - previousCount);
    if (added === 0) return;
    if (!followingLiveFeed) {
      setUnseenEventCount(count => count + added);
      return;
    }
    const timer = window.setTimeout(() => {
      logRef.current?.scrollTo?.({
        top: 0,
        behavior: 'auto',
      });
    }, 100);
    return () => clearTimeout(timer);
  }, [commentaryEntries.length, followingLiveFeed, reducedMotion]);

  const skip = useCallback(() => {
    dispatch({ type: 'skip', events: allEvents, maxMinute: timelineMax, homeTeamId: result.homeTeamId });
  }, [allEvents, timelineMax, result.homeTeamId]);

  // Commentary text for current state
  const commentary = useMemo(() => {
    if (finished) return `比赛结束，最终比分 ${playback.homeScore}:${playback.awayScore}${result.penalties ? `，点球 ${playback.penaltyHomeScore}:${playback.penaltyAwayScore}` : ''}。`;
    if (halftime) return `中场休息，比分 ${playback.homeScore}:${playback.awayScore}。`;
    if (extraTimeBreak) return '九十分钟未分胜负，双方准备进入加时赛。';
    if (shootoutBreak) return '加时赛仍未分胜负，点球大战即将开始。';
    return buildLiveCommentary({
      event: playback.flashEvent,
      minute: playback.minute,
      homeScore: playback.homeScore,
      awayScore: playback.awayScore,
      penaltyHomeScore: playback.penaltyHomeScore,
      penaltyAwayScore: playback.penaltyAwayScore,
      homeTeamId: result.homeTeamId,
      homeTeamName: ht?.name ?? '主队',
      awayTeamName: at?.name ?? '客队',
    });
  }, [
    at?.name,
    extraTimeBreak,
    finished,
    halftime,
    ht?.name,
    playback.awayScore,
    playback.flashEvent,
    playback.homeScore,
    playback.minute,
    playback.penaltyAwayScore,
    playback.penaltyHomeScore,
    result.homeTeamId,
    result.penalties,
    shootoutBreak,
  ]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="比赛直播回放"
      data-fixture-id={result.fixtureId}
      className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[500] flex items-center justify-center p-3"
    >
      <div className={`relative flex max-h-[calc(100dvh-24px)] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-slate-900 shadow-2xl animate-scale-in motion-reduce:animate-none border ${
        playback.goalFlash ? 'border-green-500/50' : 'border-slate-800'
      } transition-colors duration-500`}>

        {showOpener && (
          <div
            data-testid="key-match-opener"
            className="absolute inset-0 z-30 flex min-h-0 flex-col justify-end overflow-hidden bg-slate-950"
          >
            <DecorativeImage
              src={keyMatchOpenerArtwork}
              testId="key-match-opener-art"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.1),rgba(2,6,23,0.42)_50%,rgba(2,6,23,0.96))]" aria-hidden="true" />
            <button
              type="button"
              onClick={() => setShowOpener(false)}
              aria-label="跳过转播开场"
              title="跳过转播开场"
              className="absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-md border border-white/15 bg-black/40 text-slate-200 hover:bg-black/65"
            >
              <Icon name="x" size={18} />
            </button>
            <div className="relative px-5 pb-8 pt-20 sm:px-10 sm:pb-10">
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold text-amber-300">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-breathe motion-reduce:animate-none" />
                {result.roundLabel === 'Final' || result.roundLabel === '决赛'
                  ? '决赛现场 · 比分未揭晓'
                  : '焦点观战 · 比分未揭晓'}
              </div>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-8">
                <div className="flex min-w-0 items-center justify-end gap-2 text-right">
                  <div className="min-w-0">
                    <div className="truncate text-xl font-black text-white sm:text-3xl" title={ht?.name ?? '主队'}>
                      <span className="sm:hidden">{ht?.shortName ?? ht?.name ?? '主队'}</span>
                      <span className="hidden sm:inline">{ht?.name ?? '主队'}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">{result.isNeutralVenue ? '中立场' : '主队'}</div>
                  </div>
                  {ht && <TeamBadge teamId={ht.id} shortName={ht.shortName} color={ht.color} size={34} />}
                </div>
                <div className="text-sm font-black text-slate-500 sm:text-lg">VS</div>
                <div className="flex min-w-0 items-center gap-2">
                  {at && <TeamBadge teamId={at.id} shortName={at.shortName} color={at.color} size={34} />}
                  <div className="min-w-0">
                    <div className="truncate text-xl font-black text-white sm:text-3xl" title={at?.name ?? '客队'}>
                      <span className="sm:hidden">{at?.shortName ?? at?.name ?? '客队'}</span>
                      <span className="hidden sm:inline">{at?.name ?? '客队'}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">{result.isNeutralVenue ? '中立场' : '客队'}</div>
                  </div>
                </div>
              </div>
              <div className="mt-4 text-center text-xs text-slate-300">{result.competitionName} · {result.roundLabel}</div>
            </div>
          </div>
        )}

        <div data-testid="live-scroll-region" className="min-h-0 overflow-y-auto overscroll-y-contain">

        {/* Header bar */}
        <div className="bg-slate-800/80 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${finished ? 'bg-red-500' : 'bg-green-500 animate-breathe'}`} />
            <span className="truncate text-[11px] text-slate-400">{result.competitionName} · {result.roundLabel}</span>
          </div>
          <span data-testid="live-minute" className={`text-[10px] px-2 py-0.5 rounded-full ${finished ? 'bg-red-900/40 text-red-400' : 'bg-green-900/40 text-green-400'}`}>
            {finished
              ? '全场结束'
              : inShootout
                ? shootoutEventLabel(shootoutEvents.at(-1) ?? { minute: 121, type: 'penalty_miss', teamId: result.homeTeamId, description: '' })
                : `${playback.minute}'`}
          </span>
        </div>

        {/* Scoreboard with team colors */}
        <div className="live-scoreboard relative overflow-hidden"
          style={{ background: `linear-gradient(90deg, ${ht?.color ?? '#333'}18 0%, #0f172a 40%, #0f172a 60%, ${at?.color ?? '#333'}18 100%)` }}
        >
          <DecorativeImage
            src={liveScoreboardArtwork}
            testId="live-scoreboard-art"
            className="absolute inset-0 h-full w-full object-cover opacity-55"
          />
          <div
            className="absolute inset-0"
            aria-hidden="true"
            style={{ background: `linear-gradient(90deg, ${ht?.color ?? '#333'}2e 0%, transparent 38%, transparent 62%, ${at?.color ?? '#333'}2e 100%)` }}
          />
          {/* Goal flash overlay */}
          {playback.goalFlash && (
            <div className="absolute inset-0 animate-fade-in" style={{
              background: playback.goalFlash === 'home'
                ? `radial-gradient(circle at 25% 50%, ${ht?.color ?? '#22c55e'}30, transparent 70%)`
                : `radial-gradient(circle at 75% 50%, ${at?.color ?? '#22c55e'}30, transparent 70%)`,
            }} />
          )}

          <div className="relative flex items-center justify-center gap-2 px-4 pb-8 pt-5">
            {/* Home */}
            <div className="flex-1 text-right">
              <div className="flex items-center gap-2 justify-end">
                <span className="min-w-0 truncate text-sm font-bold text-slate-100 sm:text-lg" title={ht?.name ?? '主队'}>
                  <span className="sm:hidden">{ht?.shortName ?? ht?.name ?? '主队'}</span>
                  <span className="hidden sm:inline">{ht?.name ?? '主队'}</span>
                </span>
                {ht && <TeamBadge teamId={ht.id} shortName={ht.shortName} color={ht.color} size={26} />}
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
                {at && <TeamBadge teamId={at.id} shortName={at.shortName} color={at.color} size={26} />}
                <span className="min-w-0 truncate text-sm font-bold text-slate-100 sm:text-lg" title={at?.name ?? '客队'}>
                  <span className="sm:hidden">{at?.shortName ?? at?.name ?? '客队'}</span>
                  <span className="hidden sm:inline">{at?.name ?? '客队'}</span>
                </span>
              </div>
            </div>
          </div>
          <div
            data-testid="live-stage"
            className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded-sm border border-white/10 bg-black/45 px-2 py-0.5 text-[10px] font-semibold tracking-normal text-slate-300"
          >
            {stageLabel}{paused ? ' · 已暂停' : ''}
          </div>
        </div>

        <div className="lg:grid lg:grid-cols-[minmax(0,1.7fr)_minmax(18rem,0.8fr)]">
          <div className="min-w-0">
            {inShootout && (
              <ShootoutTracker
                events={shootoutEvents}
                homeTeamId={result.homeTeamId}
                homeName={ht?.name ?? '主队'}
                awayName={at?.name ?? '客队'}
                homeColor={ht?.color ?? '#ef4444'}
                awayColor={at?.color ?? '#3b82f6'}
                homeScore={playback.penaltyHomeScore}
                awayScore={playback.penaltyAwayScore}
                nextEvent={allEvents[playback.consumedEventCount]}
              />
            )}

            <div className="px-3 py-2 lg:px-4 lg:py-3">
              <PitchCanvas
                minute={Math.min(playback.minute, maxMin)}
                maxMinute={maxMin}
                homeColor={ht?.color ?? '#ef4444'}
                awayColor={at?.color ?? '#3b82f6'}
                homeTeamId={result.homeTeamId}
                flashEvent={playback.flashEvent}
                allEvents={allEvents}
                homeMatchday={result.homeMatchday}
                awayMatchday={result.awayMatchday}
                finished={finished}
                halftime={isBreak}
                breakLabel={shootoutBreak
                  ? { label: '点球大战', sublabel: 'PENALTY SHOOTOUT' }
                  : extraTimeBreak
                    ? { label: '加时赛', sublabel: 'EXTRA TIME' }
                    : { label: '中场休息', sublabel: 'HALF TIME' }}
                active={playback.phase === 'playing' && pageVisible}
                playbackMode={playback.mode}
                shootout={inShootout}
                possession={result.stats.possession}
                onPlaybackHoldChange={setPresentationHolding}
              />
            </div>

            {!inShootout && (
              <div className="px-4 pb-3 pt-1">
                <div className="relative h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-300 motion-reduce:transition-none"
                    style={{ width: `${(Math.min(playback.minute, maxMin) / maxMin) * 100}%` }}
                  />
                  <div className="absolute inset-y-0 w-px bg-slate-600" style={{ left: `${(45 / maxMin) * 100}%` }} />
                  {maxMin > 90 && <div className="absolute inset-y-0 w-px bg-slate-600" style={{ left: `${(90 / maxMin) * 100}%` }} />}
                  {shownEvents.filter(e => e.type === 'goal' || e.type === 'own_goal').map((e, i) => (
                    <div key={`${e.minute}:${e.type}:${i}`} className="absolute top-0 h-full w-1 rounded-full bg-amber-400" style={{ left: `${(e.minute / maxMin) * 100}%` }} />
                  ))}
                </div>
                <div className="mt-0.5 flex justify-between text-[9px] text-slate-600">
                  <span>0'</span><span>45'</span><span>{maxMin}'</span>
                </div>
              </div>
            )}
          </div>

          <aside className="min-w-0 border-t border-slate-800/70 lg:border-l lg:border-t-0">
            <div className="min-h-16 border-b border-slate-800/70 px-4 py-3">
              <div className="mb-1 text-[9px] font-semibold text-slate-500">当前播报</div>
              <p className="text-[12px] leading-5 text-emerald-300/90 animate-slide-up" key={commentary}>{commentary}</p>
            </div>

            <div className="relative">
              <div className="flex h-8 items-center justify-between border-b border-slate-800/50 px-4 text-[9px] font-semibold text-slate-500">
                <span>本场完整播报</span>
                <span className="tabular-nums">{commentaryEntries.length} 条</span>
              </div>
              {unseenEventCount > 0 && (
                <button
                  type="button"
                  data-testid="new-live-events"
                  onClick={() => {
                    setFollowingLiveFeed(true);
                    setUnseenEventCount(0);
                    logRef.current?.scrollTo?.({ top: 0, behavior: 'auto' });
                  }}
                  className="absolute right-3 top-2 z-10 min-h-9 rounded-md border border-emerald-500/30 bg-emerald-950 px-2 text-[10px] text-emerald-300 shadow-lg"
                >{unseenEventCount} 条新战况</button>
              )}
              <div
                ref={logRef}
                data-testid="live-event-log"
                onPointerDown={() => setFollowingLiveFeed(false)}
                onTouchStart={() => setFollowingLiveFeed(false)}
                onWheel={() => setFollowingLiveFeed(false)}
                onScroll={event => {
                  const atTop = event.currentTarget.scrollTop <= 8;
                  setFollowingLiveFeed(atTop);
                  if (atTop) setUnseenEventCount(0);
                }}
                aria-label="本场完整播报"
                className="h-36 touch-pan-y overflow-y-auto overscroll-y-contain px-4 py-2 lg:h-[228px]"
              >
                {commentaryEntries.map((entry, index) => (
                  <div
                    key={entry.id}
                    data-testid="live-commentary-entry"
                    className={`flex min-h-8 items-start gap-2 border-b border-slate-800/30 py-1.5 text-[11px] last:border-b-0 ${index === 0 ? 'text-slate-200' : 'text-slate-500'}`}
                  >
                    <span className="w-7 shrink-0 pt-0.5 text-right font-mono text-[10px]">{entry.label}</span>
                    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-sm">
                      {entry.event && EVENT_ICONS[entry.event.type]
                        ? <Icon name={EVENT_ICONS[entry.event.type].name} size={14} accent={EVENT_ICONS[entry.event.type].accent} />
                        : <span className="text-emerald-500/60">•</span>}
                    </span>
                    {entry.event
                      ? <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: entry.event.teamId === result.homeTeamId ? ht?.color : at?.color }} />
                      : <span className="w-2 shrink-0" />}
                    <span className="min-w-0 leading-4">{entry.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>

        {/* Final results */}
        {finished && (
          <div className="px-4 pb-3 text-center space-y-1 animate-slide-up">
            {result.extraTime && <span className="text-[10px] text-amber-400 block">加时赛 {result.etHomeGoals ?? 0} - {result.etAwayGoals ?? 0}</span>}
            {result.penalties && <span className="text-[10px] text-amber-400 block">点球大战 {result.penaltyHome} - {result.penaltyAway}</span>}
          </div>
        )}
        </div>

        {/* Controls */}
        <div
          data-testid="live-controls"
          className="grid shrink-0 grid-cols-1 gap-2 border-t border-slate-800/60 bg-slate-900 px-4 py-2.5 min-[480px]:grid-cols-[minmax(0,1fr)_auto]"
        >
          <div className="flex min-w-0 gap-1">
            <div
              role="group"
              aria-label="播放模式"
              className="flex overflow-hidden rounded-md border border-slate-700 bg-slate-800"
            >
              {PLAYBACK_MODE_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={playback.mode === option.value}
                  data-testid={`playback-mode-${option.value}`}
                  onClick={() => dispatch({ type: 'setMode', mode: option.value })}
                  className={`min-h-11 min-w-11 cursor-pointer px-2.5 py-1 text-[10px] transition-colors sm:min-h-9 ${
                    playback.mode === option.value
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button onClick={() => dispatch({ type: 'togglePause' })} disabled={isBreak}
              className="min-h-11 min-w-11 rounded-md bg-slate-800 px-2.5 py-1 text-[10px] text-slate-400 hover:bg-slate-700 cursor-pointer disabled:cursor-default disabled:opacity-60 sm:min-h-9"
            >{isBreak ? '休息' : paused ? '继续' : '暂停'}</button>
            <button
              type="button"
              data-testid="live-sound-toggle"
              aria-label={!feedbackPreferences.soundEnabled
                ? '开启全局声音'
                : locallyMuted ? '开启本场声音' : '关闭本场声音'}
              aria-pressed={feedbackPreferences.soundEnabled && !locallyMuted}
              onClick={() => {
                if (!feedbackPreferences.soundEnabled) {
                  setFeedbackPreferences({ soundEnabled: true });
                  setLocallyMuted(false);
                  unlockGameAudio();
                  soundscapeRef.current?.start();
                  soundscapeRef.current?.setMuted(false);
                  return;
                }
                setLocallyMuted(value => !value);
              }}
              className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1 rounded-md bg-slate-800 px-2 py-1 text-[10px] text-slate-400 hover:bg-slate-700 sm:min-h-9"
            >
              <Icon
                name={feedbackPreferences.soundEnabled && !locallyMuted ? 'volume' : 'volume-off'}
                size={14}
              />
              <span>{!feedbackPreferences.soundEnabled ? '全局静音' : locallyMuted ? '本场静音' : '声音'}</span>
            </button>
          </div>
          <div className="flex justify-end gap-2">
            {!finished && <button onClick={skip} className="min-h-11 px-3 py-1 text-[10px] text-slate-500 hover:text-slate-300 cursor-pointer">跳过 →</button>}
            <button onClick={onClose} className="min-w-11 min-h-11 px-3 py-1 text-[10px] bg-slate-800 text-slate-300 hover:bg-slate-700 rounded-md cursor-pointer">
              {finished ? '关闭' : '退出'}
            </button>
          </div>
        </div>

      </div>
    </div>,
    document.body,
  );
}

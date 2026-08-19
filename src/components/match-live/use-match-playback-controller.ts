import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import type { MatchEvent, MatchResult } from '../../types/match';
import type { MatchPresentationCue } from '../../types/match-presentation';
import {
  isHighlightEvent,
  playbackBreakDelay,
  playbackTickDelay,
  type PlaybackMode,
} from './playback-mode';
import {
  initialPlaybackState,
  playbackReducer,
  type PlaybackPhase,
} from './playback-state';

interface PlaybackControllerOptions {
  result: MatchResult;
  openerVisible: boolean;
}

export function getPlaybackStageLabel(
  state: { minute: number; phase: PlaybackPhase },
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

export function buildPlaybackTimeline(result: MatchResult): {
  events: MatchEvent[];
  maxMinute: number;
  timelineMax: number;
} {
  const maxMinute = result.extraTime ? 120 : 90;
  const timelineMax = result.penalties
    ? Math.max(
      121,
      ...result.events
        .filter(event => event.type === 'penalty_goal' || event.type === 'penalty_miss')
        .map(event => event.minute),
    )
    : maxMinute;
  let homeKickCount = 0;
  let awayKickCount = 0;
  const events = result.events.map((sourceEvent, order) => {
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

  return { events, maxMinute, timelineMax };
}

export function useMatchPlaybackController({
  result,
  openerVisible,
}: PlaybackControllerOptions) {
  const [playback, dispatch] = useReducer(playbackReducer, initialPlaybackState);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== 'hidden');
  const [reducedMotion, setReducedMotion] = useState(() =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );
  const [presentationHolding, setPresentationHolding] = useState(false);
  const [pitchAvailable, setPitchAvailable] = useState(true);
  const timeline = useMemo(() => buildPlaybackTimeline(result), [result]);
  const { events: allEvents, maxMinute, timelineMax } = timeline;

  const shownEvents = allEvents.slice(0, playback.consumedEventCount);
  const pendingPresentationEvent = playback.pendingEventIndex === null
    ? null
    : allEvents[playback.pendingEventIndex] ?? null;
  const finished = playback.phase === 'finished';
  const paused = playback.phase === 'paused';
  const halftime = playback.phase === 'halftime';
  const extraTimeBreak = playback.phase === 'extra_time_break';
  const shootoutBreak = playback.phase === 'shootout_break';
  const isBreak = halftime || extraTimeBreak || shootoutBreak;
  const inShootout = Boolean(result.penalties && playback.minute > 120);

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
    if (
      playback.phase !== 'playing'
      || playback.pendingEventIndex !== null
      || !pageVisible
      || !pitchAvailable
      || openerVisible
      || presentationHolding
    ) return;
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
    return () => window.clearTimeout(timer);
  }, [
    allEvents,
    openerVisible,
    pageVisible,
    pitchAvailable,
    playback.flashEvent,
    playback.minute,
    playback.mode,
    playback.pendingEventIndex,
    playback.phase,
    presentationHolding,
    reducedMotion,
    result.homeTeamId,
    timelineMax,
  ]);

  useEffect(() => {
    if (!isBreak || !pageVisible) return;
    const timer = window.setTimeout(
      () => dispatch({ type: 'resumeBreak' }),
      playbackBreakDelay(playback.mode, reducedMotion),
    );
    return () => window.clearTimeout(timer);
  }, [isBreak, pageVisible, playback.mode, reducedMotion]);

  useEffect(() => {
    if (!playback.flashEvent) return;
    const version = playback.flashVersion;
    const timer = window.setTimeout(
      () => dispatch({ type: 'clearEventFlash', version }),
      reducedMotion ? 400 : 3000,
    );
    return () => window.clearTimeout(timer);
  }, [playback.flashEvent, playback.flashVersion, reducedMotion]);

  useEffect(() => {
    if (!playback.goalFlash) return;
    const version = playback.goalFlashVersion;
    const timer = window.setTimeout(
      () => dispatch({ type: 'clearGoalFlash', version }),
      reducedMotion ? 350 : 2500,
    );
    return () => window.clearTimeout(timer);
  }, [playback.goalFlash, playback.goalFlashVersion, reducedMotion]);

  const commitPresentationCue = useCallback((cue: MatchPresentationCue) => {
    if (cue.moment !== 'outcome') return;
    const eventIndex = allEvents.indexOf(cue.event);
    if (eventIndex < 0) return;
    dispatch({
      type: 'commitPresentation',
      events: allEvents,
      eventIndex,
      homeTeamId: result.homeTeamId,
    });
  }, [allEvents, result.homeTeamId]);

  const skip = useCallback(() => {
    dispatch({ type: 'skip', events: allEvents, maxMinute: timelineMax, homeTeamId: result.homeTeamId });
  }, [allEvents, result.homeTeamId, timelineMax]);
  const setMode = useCallback((mode: PlaybackMode) => dispatch({ type: 'setMode', mode }), []);
  const togglePause = useCallback(() => dispatch({ type: 'togglePause' }), []);

  return {
    playback,
    allEvents,
    shownEvents,
    pendingPresentationEvent,
    maxMinute,
    timelineMax,
    pageVisible,
    reducedMotion,
    finished,
    paused,
    halftime,
    extraTimeBreak,
    shootoutBreak,
    isBreak,
    inShootout,
    stageLabel: getPlaybackStageLabel(playback, Boolean(result.penalties)),
    setPresentationHolding,
    setPitchAvailable,
    commitPresentationCue,
    setMode,
    togglePause,
    skip,
  };
}

import type { MatchEvent } from '../../types/match';
import { isShotEvent } from '../../engine/match/event-taxonomy';
import { nextPlaybackStep, type PlaybackMode } from './playback-mode';

export type PlaybackPhase = 'playing' | 'paused' | 'halftime' | 'extra_time_break' | 'shootout_break' | 'finished';

export interface PlaybackState {
  minute: number;
  mode: PlaybackMode;
  phase: PlaybackPhase;
  consumedEventCount: number;
  pendingEventIndex: number | null;
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

export type PlaybackAction =
  | { type: 'tick'; events: MatchEvent[]; maxMinute: number; homeTeamId: string }
  | { type: 'commitPresentation'; events: MatchEvent[]; eventIndex: number; homeTeamId: string }
  | { type: 'skip'; events: MatchEvent[]; maxMinute: number; homeTeamId: string }
  | { type: 'setMode'; mode: PlaybackMode }
  | { type: 'togglePause' }
  | { type: 'resumeBreak' }
  | { type: 'clearEventFlash'; version: number }
  | { type: 'clearGoalFlash'; version: number };

export const initialPlaybackState: PlaybackState = {
  minute: 0,
  mode: 'live',
  phase: 'playing',
  consumedEventCount: 0,
  pendingEventIndex: null,
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

export function requiresPresentationCommit(event: MatchEvent): boolean {
  return isShotEvent(event) || event.type === 'corner' || event.type === 'free_kick';
}

function isMatchScoreEvent(event: MatchEvent): boolean {
  return event.type === 'goal' || event.type === 'own_goal';
}

function commitEvent(
  state: PlaybackState,
  event: MatchEvent,
  eventIndex: number,
  homeTeamId: string,
): PlaybackState {
  let homeScore = state.homeScore;
  let awayScore = state.awayScore;
  let penaltyHomeScore = state.penaltyHomeScore;
  let penaltyAwayScore = state.penaltyAwayScore;
  const scoresInMatch = isMatchScoreEvent(event);
  const scoresInShootout = event.type === 'penalty_goal';

  if (scoresInMatch) {
    if (event.teamId === homeTeamId) homeScore++;
    else awayScore++;
  } else if (scoresInShootout) {
    if (event.teamId === homeTeamId) penaltyHomeScore++;
    else penaltyAwayScore++;
  }

  const scoreChanged = scoresInMatch || scoresInShootout;
  return {
    ...state,
    consumedEventCount: eventIndex + 1,
    pendingEventIndex: null,
    homeScore,
    awayScore,
    penaltyHomeScore,
    penaltyAwayScore,
    flashEvent: event,
    goalFlash: scoreChanged ? (event.teamId === homeTeamId ? 'home' : 'away') : state.goalFlash,
    flashVersion: state.flashVersion + 1,
    goalFlashVersion: scoreChanged ? state.goalFlashVersion + 1 : state.goalFlashVersion,
  };
}

function revealUntilPresentation(
  state: PlaybackState,
  targetMinute: number,
  events: MatchEvent[],
  homeTeamId: string,
): PlaybackState {
  let next = state;
  let eventIndex = state.consumedEventCount;

  while (eventIndex < events.length && events[eventIndex].minute <= targetMinute) {
    const event = events[eventIndex];
    if (requiresPresentationCommit(event)) {
      return {
        ...next,
        minute: event.minute,
        pendingEventIndex: eventIndex,
      };
    }
    next = commitEvent({ ...next, minute: event.minute }, event, eventIndex, homeTeamId);
    eventIndex++;
  }

  return { ...next, minute: targetMinute };
}

function breakAtCurrentBoundary(state: PlaybackState, maxMinute: number): PlaybackState | null {
  if (state.minute === 45 && !state.hasHadHalftime) {
    return { ...state, phase: 'halftime', hasHadHalftime: true };
  }
  if (state.minute === 90 && maxMinute > 90 && !state.hasHadExtraTimeBreak) {
    return { ...state, phase: 'extra_time_break', hasHadExtraTimeBreak: true };
  }
  if (state.minute === 120 && maxMinute > 120 && !state.hasHadShootoutBreak) {
    return { ...state, phase: 'shootout_break', hasHadShootoutBreak: true };
  }
  return null;
}

export function playbackReducer(state: PlaybackState, action: PlaybackAction): PlaybackState {
  switch (action.type) {
    case 'tick': {
      if (state.phase !== 'playing' || state.pendingEventIndex !== null) return state;
      const boundaryBreak = breakAtCurrentBoundary(state, action.maxMinute);
      if (boundaryBreak) return boundaryBreak;

      const requestedMinute = Math.min(
        action.maxMinute,
        state.minute + nextPlaybackStep(state.minute, action.maxMinute, action.events, state.mode),
      );
      let nextMinute = requestedMinute;
      if (state.minute < 45 && requestedMinute >= 45 && !state.hasHadHalftime) nextMinute = 45;
      else if (state.minute < 90 && requestedMinute >= 90 && action.maxMinute > 90 && !state.hasHadExtraTimeBreak) nextMinute = 90;
      else if (state.minute < 120 && requestedMinute >= 120 && action.maxMinute > 120 && !state.hasHadShootoutBreak) nextMinute = 120;

      const next = revealUntilPresentation(state, nextMinute, action.events, action.homeTeamId);
      if (next.pendingEventIndex !== null) return next;
      const reachedBreak = breakAtCurrentBoundary(next, action.maxMinute);
      if (reachedBreak) return reachedBreak;
      if (nextMinute >= action.maxMinute && next.consumedEventCount >= action.events.length) {
        return { ...next, phase: 'finished' };
      }
      return next;
    }
    case 'commitPresentation': {
      if (state.pendingEventIndex !== action.eventIndex) return state;
      const event = action.events[action.eventIndex];
      if (!event) return { ...state, pendingEventIndex: null };
      return commitEvent(state, event, action.eventIndex, action.homeTeamId);
    }
    case 'skip': {
      let completed: PlaybackState = { ...state, pendingEventIndex: null };
      for (let eventIndex = completed.consumedEventCount; eventIndex < action.events.length; eventIndex++) {
        completed = commitEvent(completed, action.events[eventIndex], eventIndex, action.homeTeamId);
      }
      return {
        ...completed,
        minute: action.maxMinute,
        phase: 'finished',
        hasHadHalftime: true,
        hasHadExtraTimeBreak: action.maxMinute > 90,
        hasHadShootoutBreak: action.maxMinute > 120,
        pendingEventIndex: null,
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

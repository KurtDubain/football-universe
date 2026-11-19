import { editionStorageKey } from '../../edition/policy';
import type { MatchEvent } from '../../types/match';
import type { RoutineBeat, RoutineBeatKind } from './routine-timeline';

export type PlaybackMode = 'highlights' | 'live' | 'immersive';

export const PLAYBACK_MODE_OPTIONS: ReadonlyArray<{
  value: PlaybackMode;
  label: string;
  description: string;
  recommended?: boolean;
}> = [
  { value: 'highlights', label: '精华', description: '跳过平淡时段，保留关键攻防', recommended: true },
  { value: 'live', label: '完整', description: '逐分钟推进整场比赛' },
  { value: 'immersive', label: '沉浸', description: '完整播放，节奏更舒缓' },
];

const PLAYBACK_MODE_STORAGE_KEY = editionStorageKey('football-universe:match-playback-mode');

export function isPlaybackMode(value: unknown): value is PlaybackMode {
  return value === 'highlights' || value === 'live' || value === 'immersive';
}

export function readPlaybackModePreference(storage?: Pick<Storage, 'getItem'>): PlaybackMode {
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    const stored = target?.getItem(PLAYBACK_MODE_STORAGE_KEY);
    return isPlaybackMode(stored) ? stored : 'highlights';
  } catch {
    return 'highlights';
  }
}

export function writePlaybackModePreference(
  mode: PlaybackMode,
  storage?: Pick<Storage, 'setItem'>,
): void {
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    target?.setItem(PLAYBACK_MODE_STORAGE_KEY, mode);
  } catch {
    // Storage can be unavailable in private browsing; playback remains usable.
  }
}

const HIGHLIGHT_EVENT_TYPES = new Set<MatchEvent['type']>([
  'goal',
  'own_goal',
  'penalty_goal',
  'penalty_miss',
  'red_card',
  'gk_save',
  'df_block',
  'corner',
  'free_kick',
]);

function isSetPieceHighlight(event: MatchEvent | null | undefined): boolean {
  return Boolean(event && (
    event.type === 'corner'
    || event.type === 'free_kick'
    || event.playOrigin === 'corner'
    || event.playOrigin === 'direct_free_kick'
    || event.playOrigin === 'crossed_free_kick'
  ));
}

function isShotHighlight(event: MatchEvent | null | undefined): boolean {
  return Boolean(event && (
    event.type === 'goal'
    || event.type === 'own_goal'
    || event.type === 'penalty_goal'
    || event.type === 'penalty_miss'
    || event.type === 'gk_save'
    || event.type === 'df_block'
  ));
}

export function isHighlightEvent(event: MatchEvent | null): boolean {
  return Boolean(event && HIGHLIGHT_EVENT_TYPES.has(event.type));
}

export function nextPlaybackStep(
  minute: number,
  maxMinute: number,
  events: MatchEvent[],
  mode: PlaybackMode,
): number {
  if (mode !== 'highlights') return 1;

  const nextHighlight = events.find(event =>
    event.minute > minute && HIGHLIGHT_EVENT_TYPES.has(event.type)
  );
  const preludeMinutes = isSetPieceHighlight(nextHighlight)
    ? 5
    : isShotHighlight(nextHighlight)
      ? 5
      : 2;
  const target = nextHighlight
    ? Math.max(minute + 1, nextHighlight.minute - preludeMinutes)
    : maxMinute;
  const step = Math.max(1, Math.min(5, target - minute, maxMinute - minute));
  // A card or a substitution is committed without a presentation, so the
  // only way the canvas ever shows one is the clock landing on its minute.
  // A five-minute step walked straight over them: the player was replaced,
  // the shape on the pitch changed, and nothing was ever shown. Land on
  // the minute instead and the beat gets its frame.
  const nextBeat = events.find(event =>
    event.minute > minute
    && event.minute <= minute + step
    && (event.type === 'substitution' || event.type === 'yellow_card')
  );
  return nextBeat ? Math.max(1, nextBeat.minute - minute) : step;
}

/**
 * How long a routine beat is allowed to own the screen.
 *
 * Each of the four needs a different amount of real time to read as itself.
 * A whistle plus a referee walking over is the longest; a shot that misses is
 * the shortest, because the ball is already on its way and there is nothing
 * left to wait for.
 */
const ROUTINE_BEAT_HOLD_MS: Readonly<Record<RoutineBeatKind, number>> = {
  foul: 1480,
  corner: 1580,
  save: 1400,
  shot_off_target: 1300,
};

/**
 * A minute with nothing in it.
 *
 * This used to be the default state of the live modes and it was tuned as
 * one: 540 ms of the same passing loop, minute after minute. Round one cut
 * it to 430 ms on the grounds that a quiet minute is connective tissue, and
 * that was right when a directed attack was two passes and a second long —
 * the match had nowhere to put the time. An attack is now eight to ten
 * passes and ten seconds, so the connective tissue is the part that has to
 * hold the rhythm together: at 430 ms the canvas advanced eighteen frames
 * per minute, which is half a pass, and a passage of play took three minutes
 * of match clock to cross the screen.
 */
const QUIET_MINUTE_MS = 1150;

/** Immersive stretches every beat; live plays it at the tempo it was cut for. */
const IMMERSIVE_BEAT_SCALE = 1.45;
const IMMERSIVE_QUIET_MS = 1780;

function routineBeatHold(kind: RoutineBeatKind, scale: number, reducedMotion: boolean): number {
  const base = ROUTINE_BEAT_HOLD_MS[kind] * scale;
  return reducedMotion ? Math.round(base * 0.42) : Math.round(base);
}

export function playbackTickDelay(
  mode: PlaybackMode,
  minute: number,
  flashEvent: MatchEvent | null,
  reducedMotion: boolean,
  nextHighlight?: MatchEvent,
  routineBeat?: RoutineBeat | null,
): number {
  const eventJustRevealed = flashEvent?.minute === minute;
  // The live modes used to slow the five minutes before a shot to 720 ms so
  // the attack had time to play before the clock reached the goal. A scene
  // is now prepared on the event minute itself and holds the clock while it
  // runs, so that crutch is gone — and it was costing more than it bought:
  // it outranked the routine beat for thirty of the ninety minutes, which is
  // a third of the match where the timeline built in round one was thrown
  // away and every minute looked the same.
  if (mode === 'live') {
    if (eventJustRevealed && isHighlightEvent(flashEvent)) return reducedMotion ? 450 : 2400;
    if (eventJustRevealed) return reducedMotion ? 320 : 1400;
    if (routineBeat) return routineBeatHold(routineBeat.kind, 1, reducedMotion);
    return reducedMotion ? 240 : QUIET_MINUTE_MS;
  }
  if (mode === 'immersive') {
    if (eventJustRevealed && isHighlightEvent(flashEvent)) return reducedMotion ? 550 : 3200;
    if (eventJustRevealed) return reducedMotion ? 380 : 1900;
    if (routineBeat) return routineBeatHold(routineBeat.kind, IMMERSIVE_BEAT_SCALE, reducedMotion);
    return reducedMotion ? 300 : IMMERSIVE_QUIET_MS;
  }

  const approachingShot = !flashEvent
    && isShotHighlight(nextHighlight)
    && nextHighlight!.minute - minute <= 5;

  if (!flashEvent
    && isSetPieceHighlight(nextHighlight)
    && nextHighlight!.minute - minute <= 5) {
    return reducedMotion ? 180 : 320;
  }
  if (approachingShot) return reducedMotion ? 180 : 520;
  if (isSetPieceHighlight(flashEvent)) return reducedMotion ? 500 : 1800;

  const holdingHighlight = isHighlightEvent(flashEvent)
    && minute <= (flashEvent?.minute ?? -1) + 1;
  if (holdingHighlight) return reducedMotion ? 300 : 1200;
  return reducedMotion ? 90 : 120;
}

/**
 * Canvas simulation frames advanced per rendered frame. Highlights retain the
 * concise cut while live modes give passes, carries and defensive recovery
 * enough screen time to read as one football action rather than a fast replay.
 */
export function playbackMotionRate(mode: PlaybackMode): number {
  if (mode === 'immersive') return 0.58;
  if (mode === 'live') return 0.72;
  return 1;
}

export function playbackBreakDelay(
  mode: PlaybackMode,
  reducedMotion: boolean,
): number {
  if (reducedMotion) return 250;
  if (mode === 'live') return 2400;
  if (mode === 'immersive') return 3600;
  return 650;
}

import type { MatchEvent } from '../../types/match';

export type PlaybackMode = 'highlights' | 'live' | 'immersive';

export const PLAYBACK_MODE_OPTIONS: ReadonlyArray<{
  value: PlaybackMode;
  label: string;
}> = [
  { value: 'highlights', label: '精华' },
  { value: 'live', label: '直播' },
  { value: 'immersive', label: '沉浸' },
];

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
  return Math.max(1, Math.min(5, target - minute, maxMinute - minute));
}

export function playbackTickDelay(
  mode: PlaybackMode,
  minute: number,
  flashEvent: MatchEvent | null,
  reducedMotion: boolean,
  nextHighlight?: MatchEvent,
): number {
  const eventJustRevealed = flashEvent?.minute === minute;
  const approachingShot = !flashEvent
    && isShotHighlight(nextHighlight)
    && nextHighlight!.minute - minute <= 5;
  if (mode === 'live') {
    if (eventJustRevealed && isHighlightEvent(flashEvent)) return reducedMotion ? 450 : 1650;
    if (eventJustRevealed) return reducedMotion ? 320 : 900;
    if (approachingShot) return reducedMotion ? 280 : 720;
    return reducedMotion ? 240 : 540;
  }
  if (mode === 'immersive') {
    if (eventJustRevealed && isHighlightEvent(flashEvent)) return reducedMotion ? 550 : 2300;
    if (eventJustRevealed) return reducedMotion ? 380 : 1300;
    if (approachingShot) return reducedMotion ? 340 : 980;
    return reducedMotion ? 300 : 820;
  }

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

import type { MatchEvent } from '../../types/match';

export type PlaybackMode = 'highlights' | 'normal' | 'fast';

export const PLAYBACK_MODE_OPTIONS: ReadonlyArray<{
  value: PlaybackMode;
  label: string;
}> = [
  { value: 'highlights', label: '精华' },
  { value: 'normal', label: '1x' },
  { value: 'fast', label: '3x' },
];

const HIGHLIGHT_EVENT_TYPES = new Set<MatchEvent['type']>([
  'goal',
  'own_goal',
  'penalty_goal',
  'penalty_miss',
  'red_card',
  'gk_save',
  'df_block',
]);

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
  const target = nextHighlight
    ? Math.max(minute + 1, nextHighlight.minute - 2)
    : maxMinute;
  return Math.max(1, Math.min(5, target - minute, maxMinute - minute));
}

export function playbackTickDelay(
  mode: PlaybackMode,
  minute: number,
  flashEvent: MatchEvent | null,
  reducedMotion: boolean,
): number {
  if (mode === 'normal') return 280;
  if (mode === 'fast') return 280 / 3;

  const holdingHighlight = isHighlightEvent(flashEvent)
    && minute <= (flashEvent?.minute ?? -1) + 1;
  if (holdingHighlight) return reducedMotion ? 300 : 900;
  return reducedMotion ? 90 : 120;
}

export function playbackBreakDelay(
  mode: PlaybackMode,
  reducedMotion: boolean,
): number {
  if (reducedMotion) return 250;
  if (mode === 'normal') return 2000;
  if (mode === 'fast') return 800;
  return 650;
}

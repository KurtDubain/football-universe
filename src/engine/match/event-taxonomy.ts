import type { MatchEvent, MatchPlayOrigin } from '../../types/match';

export type MatchSetPieceOrigin = Extract<
  MatchPlayOrigin,
  'corner' | 'direct_free_kick' | 'crossed_free_kick' | 'penalty'
>;

const SHOT_EVENT_TYPES = new Set<MatchEvent['type']>([
  'goal', 'penalty_goal', 'own_goal',
  'save', 'gk_save', 'df_block',
  'miss', 'penalty_miss',
]);

const DEFENDING_SHOT_EVENT_TYPES = new Set<MatchEvent['type']>(['save', 'gk_save', 'df_block']);

export function isShotEvent(event: MatchEvent): boolean {
  return SHOT_EVENT_TYPES.has(event.type);
}

export function isDefendingShotEvent(event: MatchEvent): boolean {
  return DEFENDING_SHOT_EVENT_TYPES.has(event.type);
}

export function playOriginForEvent(event: MatchEvent): MatchPlayOrigin {
  if (event.playOrigin) return event.playOrigin;
  if (event.type === 'penalty_goal' || event.type === 'penalty_miss') return 'penalty';
  if (event.type === 'corner') return 'corner';
  if (event.type === 'free_kick') return 'crossed_free_kick';
  return 'open_play';
}

export function isSetPieceOrigin(origin: MatchPlayOrigin): origin is MatchSetPieceOrigin {
  return origin === 'corner'
    || origin === 'direct_free_kick'
    || origin === 'crossed_free_kick'
    || origin === 'penalty';
}

export function isSetPieceEvent(event: MatchEvent): boolean {
  return isSetPieceOrigin(playOriginForEvent(event));
}

export function attackingTeamIdForEvent(
  event: MatchEvent,
  homeTeamId: string,
  awayTeamId: string,
): string {
  if (!isDefendingShotEvent(event)) return event.teamId;
  return event.teamId === homeTeamId ? awayTeamId : homeTeamId;
}

export function eventAttacksForHome(event: MatchEvent, homeTeamId: string): boolean {
  const eventBelongsToHome = event.teamId === homeTeamId;
  return isDefendingShotEvent(event) ? !eventBelongsToHome : eventBelongsToHome;
}

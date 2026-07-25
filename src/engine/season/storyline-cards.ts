import type { GameWorld } from './season-manager';
import {
  describeStoryline,
  detectStorylineSignals,
  type StorylinePhase,
  type StorylineSignal,
  type StorylineType,
} from './storylines';

export type StorylineCardType = StorylineType;
export type StorylineCardPhase = Exclude<StorylinePhase, '落幕'>;

export interface StorylineCard extends StorylineSignal {
  scope: 'focus' | 'world';
}

function signalForActiveStories(world: GameWorld): StorylineSignal[] {
  return (world.activeStorylines ?? [])
    .map(storyline => describeStoryline(world, storyline))
    .filter((signal): signal is StorylineSignal => Boolean(signal));
}

/**
 * Keep the Dashboard quiet: at most one story for the primary observed team
 * and one separate world story. Persisted stories take precedence; a derived
 * fallback keeps current saves informative before their next advance.
 */
export function generateStorylineCards(
  world: GameWorld,
  favoriteTeamIds: string[],
): StorylineCard[] {
  const primaryId = favoriteTeamIds[0];
  const activeSignals = signalForActiveStories(world);
  const signals = activeSignals.length > 0 ? activeSignals : detectStorylineSignals(world);
  const focused = primaryId
    ? signals
      .filter(signal => signal.teamId === primaryId)
      .sort((a, b) => b.priority - a.priority)[0]
    : undefined;
  const global = signals
    .filter(signal => signal.teamId !== primaryId)
    .sort((a, b) => b.priority - a.priority
      || a.teamId.localeCompare(b.teamId)
      || a.type.localeCompare(b.type))[0];

  return [
    ...(focused ? [{ ...focused, scope: 'focus' as const }] : []),
    ...(global ? [{ ...global, scope: 'world' as const }] : []),
  ];
}

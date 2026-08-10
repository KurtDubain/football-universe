import type { MatchEvent } from '../../types/match';
import { eventAttacksForHome, isDefendingShotEvent, isShotEvent } from '../../engine/match/event-taxonomy';
import { seededRand } from './math';

export type ShotOutcome = 'goal' | 'save' | 'block' | 'miss';
export type SceneOutcome = ShotOutcome | 'delivery';

export interface EventScene {
  key: string;
  event: MatchEvent;
  attackingHome: boolean;
  outcome: SceneOutcome;
  target: { x: number; y: number };
  seed: number;
}

export interface EventActors {
  attackerId?: string;
  creatorId?: string;
  defenderId?: string;
}

function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function outcomeFor(event: MatchEvent): SceneOutcome {
  if (event.type === 'corner' || event.type === 'free_kick') return 'delivery';
  if (event.type === 'goal' || event.type === 'penalty_goal' || event.type === 'own_goal') return 'goal';
  if (event.type === 'penalty_miss' && event.shootout?.outcome === 'saved') return 'save';
  if (event.type === 'df_block') return 'block';
  if (event.type === 'miss' || event.type === 'penalty_miss') return 'miss';
  return 'save';
}

export function sceneForEvent(event: MatchEvent, homeTeamId: string, ordinal?: number): EventScene | null {
  if (!isShotEvent(event) && event.type !== 'corner' && event.type !== 'free_kick') return null;

  const attackingHome = eventAttacksForHome(event, homeTeamId);
  const outcome = outcomeFor(event);
  const key = `${ordinal ?? 'direct'}:${event.minute}:${event.type}:${event.teamId}:${event.playerId ?? ''}`;
  const seed = hashText(key);
  const attackGoalX = outcome === 'delivery'
    ? (attackingHome ? 0.89 : 0.11)
    : outcome === 'miss'
    ? (attackingHome ? 1.015 : -0.015)
    : (attackingHome ? 0.985 : 0.015);
  const targetY = outcome === 'delivery'
    ? event.setPiece?.delivery === 'near_post'
      ? (event.setPiece.side === 'left' ? 0.39 : 0.61)
      : event.setPiece?.delivery === 'far_post'
        ? (event.setPiece.side === 'left' ? 0.62 : 0.38)
        : 0.46 + seededRand(seed + 4) * 0.08
    : outcome === 'miss'
    ? (seededRand(seed + 1) > 0.5 ? 0.34 : 0.66)
    : outcome === 'block'
      ? 0.46 + seededRand(seed + 2) * 0.08
      : outcome === 'save' && event.type === 'save'
        ? 0.46 + seededRand(seed + 3) * 0.08
        : 0.4 + seededRand(seed + 3) * 0.2;

  return {
    key,
    event,
    attackingHome,
    outcome,
    target: { x: attackGoalX, y: targetY },
    seed,
  };
}

export function findEventScene(
  events: MatchEvent[],
  minute: number,
  homeTeamId: string,
  flashEvent?: MatchEvent | null,
): EventScene | null {
  const flashIndex = flashEvent ? events.indexOf(flashEvent) : -1;
  const flashScene = flashEvent ? sceneForEvent(flashEvent, homeTeamId, flashIndex >= 0 ? flashIndex : undefined) : null;
  if (flashScene) return flashScene;

  const nearby = events
    .filter(event => {
      const lead = event.minute - minute;
      return lead >= 0 && lead <= 5;
    })
    .map(event => sceneForEvent(event, homeTeamId, events.indexOf(event)))
    .filter((scene): scene is EventScene => scene !== null)
    .sort((a, b) => a.event.minute - b.event.minute || a.key.localeCompare(b.key));
  return nearby[0] ?? null;
}

export function actorsForEvent(event: MatchEvent, events: MatchEvent[]): EventActors {
  const eventIndex = events.indexOf(event);
  const nextEvent = eventIndex >= 0 ? events[eventIndex + 1] : undefined;
  const pairedAssist = nextEvent?.minute === event.minute
    && nextEvent.teamId === event.teamId
    && nextEvent.type === 'assist'
    ? nextEvent
    : undefined;
  const defendingEvent = isDefendingShotEvent(event);

  return {
    attackerId: defendingEvent ? event.deniedScorerId : event.playerId,
    creatorId: defendingEvent ? event.deniedAssisterId : pairedAssist?.playerId,
    defenderId: event.shootout?.goalkeeperId ?? (defendingEvent ? event.playerId : undefined),
  };
}

import type { MatchEvent } from '../../types/match';
import { seededRand } from './math';

export type ShotOutcome = 'goal' | 'save' | 'block' | 'miss';

export interface EventScene {
  key: string;
  event: MatchEvent;
  attackingHome: boolean;
  outcome: ShotOutcome;
  target: { x: number; y: number };
  seed: number;
}

const SHOT_EVENT_TYPES = new Set<MatchEvent['type']>([
  'goal', 'penalty_goal', 'own_goal',
  'save', 'gk_save', 'df_block',
  'miss', 'penalty_miss',
]);

const DEFENDING_TEAM_EVENT_TYPES = new Set<MatchEvent['type']>(['save', 'gk_save', 'df_block']);

function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function outcomeFor(event: MatchEvent): ShotOutcome {
  if (event.type === 'goal' || event.type === 'penalty_goal' || event.type === 'own_goal') return 'goal';
  if (event.type === 'df_block') return 'block';
  if (event.type === 'miss' || event.type === 'penalty_miss') return 'miss';
  return 'save';
}

export function sceneForEvent(event: MatchEvent, homeTeamId: string, ordinal?: number): EventScene | null {
  if (!SHOT_EVENT_TYPES.has(event.type)) return null;

  const eventBelongsToHome = event.teamId === homeTeamId;
  const attackingHome = DEFENDING_TEAM_EVENT_TYPES.has(event.type)
    ? !eventBelongsToHome
    : eventBelongsToHome;
  const outcome = outcomeFor(event);
  const key = `${ordinal ?? 'direct'}:${event.minute}:${event.type}:${event.teamId}:${event.playerId ?? ''}`;
  const seed = hashText(key);
  const attackGoalX = outcome === 'miss'
    ? (attackingHome ? 1.015 : -0.015)
    : (attackingHome ? 0.985 : 0.015);
  const targetY = outcome === 'miss'
    ? (seededRand(seed + 1) > 0.5 ? 0.34 : 0.66)
    : outcome === 'block'
      ? 0.46 + seededRand(seed + 2) * 0.08
      : 0.42 + seededRand(seed + 3) * 0.16;

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
    .filter(event => event.minute - minute >= 0 && event.minute - minute <= 2)
    .map(event => sceneForEvent(event, homeTeamId, events.indexOf(event)))
    .filter((scene): scene is EventScene => scene !== null)
    .sort((a, b) => a.event.minute - b.event.minute || a.key.localeCompare(b.key));
  return nearby[0] ?? null;
}

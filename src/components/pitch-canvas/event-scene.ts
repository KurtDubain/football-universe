import type { MatchEvent } from '../../types/match';
import { eventAttacksForHome, isDefendingShotEvent, isShotEvent } from '../../engine/match/event-taxonomy';
import { GOAL_MOUTH_SPAN } from './keeper-action';
import { seededRand } from './math';

export type ShotOutcome = 'goal' | 'save' | 'block' | 'miss';

/**
 * The three moments that stop a match without the ball doing anything.
 *
 * None of them has a ball path, so none of them can borrow the shot
 * machinery: a card is shown at a touchline, not struck at a goal.
 */
export type BeatKind = 'yellow_card' | 'red_card' | 'substitution';

export type SceneOutcome = ShotOutcome | 'delivery' | 'beat';

export interface EventScene {
  key: string;
  event: MatchEvent;
  /**
   * Which side of the pitch the scene belongs to.
   *
   * For a shot that is the attacking team. For a beat it is the team whose
   * touchline the card is shown on, which is the team the event names.
   */
  attackingHome: boolean;
  outcome: SceneOutcome;
  /** Set only when `outcome` is `beat`. */
  beat?: BeatKind;
  target: { x: number; y: number };
  seed: number;
}

const BEAT_EVENT_TYPES: Readonly<Record<string, BeatKind>> = {
  yellow_card: 'yellow_card',
  red_card: 'red_card',
  substitution: 'substitution',
};

export function beatKindFor(event: MatchEvent): BeatKind | null {
  return BEAT_EVENT_TYPES[event.type] ?? null;
}

/**
 * How much a scene is worth when two of them land on the same minute.
 *
 * Lower wins. Every shot outcome shares the top rank on purpose: the
 * simulation already decided which of them mattered, and the renderer has no
 * business preferring a goal it has not been asked to draw yet.
 */
export function scenePriority(scene: EventScene): number {
  if (scene.outcome === 'beat') {
    return scene.beat === 'red_card' ? 1 : scene.beat === 'yellow_card' ? 2 : 3;
  }
  return scene.outcome === 'delivery' ? 4 : 0;
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
  const key = `${ordinal ?? 'direct'}:${event.minute}:${event.type}:${event.teamId}:${event.playerId ?? ''}`;

  const beat = beatKindFor(event);
  if (beat) {
    const seed = hashText(key);
    return {
      key,
      event,
      attackingHome: event.teamId === homeTeamId,
      outcome: 'beat',
      beat,
      // The near touchline, somewhere along the middle third: a card is shown
      // where the fourth official can be seen, not at a goal mouth.
      target: { x: 0.3 + seededRand(seed + 7) * 0.4, y: 0.055 },
      seed,
    };
  }

  if (!isShotEvent(event) && event.type !== 'corner' && event.type !== 'free_kick') return null;

  const attackingHome = eventAttacksForHome(event, homeTeamId);
  const outcome = outcomeFor(event);
  const seed = hashText(key);
  // A goal ends up in the net. The net back sits 2 m beyond the goal line at
  // u = 1.019 and the canvas leaves 10 px of surround past the line at 510,
  // so 1.01 is halfway into the goal and still on screen. Saves and blocks keep
  // stopping in front of the line, which is where a keeper meets a ball.
  const attackGoalX = outcome === 'delivery'
    ? (attackingHome ? 0.89 : 0.11)
    : outcome === 'miss'
    ? (attackingHome ? 1.008 : -0.008)
    : outcome === 'goal'
      ? (attackingHome ? 1.01 : -0.01)
      : (attackingHome ? 0.985 : 0.015);
  const targetY = outcome === 'delivery'
    ? event.setPiece?.delivery === 'near_post'
      ? (event.setPiece.side === 'left' ? 0.39 : 0.61)
      : event.setPiece?.delivery === 'far_post'
        ? (event.setPiece.side === 'left' ? 0.62 : 0.38)
        : 0.46 + seededRand(seed + 4) * 0.08
    : outcome === 'miss'
    // Clearly outside the post (the goal mouth spans 0.446-0.554) with enough
    // seeded spread that repeated misses do not all trace the same line.
    ? 0.5 + (seededRand(seed + 1) > 0.5 ? 1 : -1) * (0.13 + seededRand(seed + 5) * 0.05)
    : outcome === 'block'
      ? 0.46 + seededRand(seed + 2) * 0.08
      // A saved shot is on target: the keeper reached a ball that was going
      // in. Keeping it inside the mouth (0.446-0.554) is also what lets the
      // dive be planned from a set position — a save credited outside the posts
      // is one no keeper could have got to, and the animation cannot invent a
      // reach the simulation did not produce.
      : outcome === 'save'
        ? 0.46 + seededRand(seed + 3) * 0.08
        // A goal is a ball that crossed the line between the posts, so its
        // target has to be inside the mouth. It used to be drawn from
        // 0.4-0.6, which is wider than the 0.446-0.554 frame: measured over
        // 3600 sampled goals, 59.1% of them finished outside a post, up to
        // 3.14 m beyond it, and the ball was then celebrated in a goal it had
        // never entered. The 0.94 inset keeps the ball off the woodwork.
        : 0.5 + (seededRand(seed + 3) - 0.5) * GOAL_MOUTH_SPAN * 0.94;

  return {
    key,
    event,
    attackingHome,
    outcome,
    target: { x: attackGoalX, y: targetY },
    seed,
  };
}

/**
 * Every scene the given minute can show, best first.
 *
 * Only the minute the event belongs to. A scene used to be prepared up to
 * five minutes early, which meant the move played out, ran out of phases
 * and then sat on its hold frame waiting for the clock to reach the goal —
 * two and a half seconds of a frozen pitch before every finish. The
 * playback clock stops at the event minute anyway, so starting there is
 * both the honest moment and the one with no dead air in it.
 */
function rankMinuteScenes(
  events: MatchEvent[],
  minute: number,
  homeTeamId: string,
): EventScene[] {
  const ordinals = new Map<EventScene, number>();
  const nearby: EventScene[] = [];
  events.forEach((event, index) => {
    if (event.minute !== minute) return;
    const scene = sceneForEvent(event, homeTeamId, index);
    if (!scene) return;
    ordinals.set(scene, index);
    nearby.push(scene);
  });

  // A card or a substitution is a beat, not a highlight. It gets its moment
  // when nothing is being struck nearby, and steps aside the instant a shot
  // lands on the same minute or the one after it — otherwise a fifth-minute
  // substitution would push a sixth-minute goal out of the window entirely.
  const available = nearby.filter(scene => (
    scene.outcome !== 'beat'
    || !nearby.some(other => (
      other !== scene
      && other.outcome !== 'beat'
      && other.event.minute >= scene.event.minute
      && other.event.minute - scene.event.minute <= 1
    ))
  ));

  return available.sort(
    (a, b) => (
      a.event.minute - b.event.minute
      || scenePriority(a) - scenePriority(b)
      // Position in the event list, compared as a number. The scene key
      // carries that index as text, so comparing keys put "10:..." ahead of
      // "2:..." and the winner of a busy minute was not even the earliest
      // event in it.
      || (ordinals.get(a) ?? 0) - (ordinals.get(b) ?? 0)
    ),
  );
}

/**
 * Every scene worth showing for a minute, in the order they should play.
 *
 * A minute can carry more than one shot and the scoreline counts all of
 * them, so handing back only the first left minutes where the ball went in
 * and the picture showed the miss beside it. The caller plays the list in
 * order; the event the playback is actually waiting on leads it.
 */
export function findEventScenes(
  events: MatchEvent[],
  minute: number,
  homeTeamId: string,
  flashEvent?: MatchEvent | null,
): EventScene[] {
  const flashIndex = flashEvent ? events.indexOf(flashEvent) : -1;
  const flashScene = flashEvent
    ? sceneForEvent(flashEvent, homeTeamId, flashIndex >= 0 ? flashIndex : undefined)
    : null;
  const ranked = rankMinuteScenes(events, minute, homeTeamId);
  if (!flashScene) return ranked;
  return [flashScene, ...ranked.filter(scene => scene.key !== flashScene.key)];
}

export function findEventScene(
  events: MatchEvent[],
  minute: number,
  homeTeamId: string,
  flashEvent?: MatchEvent | null,
): EventScene | null {
  return findEventScenes(events, minute, homeTeamId, flashEvent)[0] ?? null;
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

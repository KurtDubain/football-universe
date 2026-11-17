// The half of a match the timeline never showed.
//
// A MatchResult carries authoritative full-match totals: fouls, corners,
// shots, shots on target. The event feed carries only the noteworthy subset
// — the goals, the cards, the saves worth a replay, the corners that led
// somewhere. Everything else the simulator produced is real football the
// broadcast currently skips, which is why a quiet stretch of the live modes
// reads as dead air instead of as a match.
//
// This module closes that gap without inventing anything. It subtracts what
// the event feed already accounts for from each authoritative total, then
// places whatever is left on the clock. The counts belong to the simulation;
// only the minute each one lands on is a presentation choice, exactly as the
// engine already does when it distributes interceptions and clearances
// across a matchday squad.
//
// Nothing here may touch the score, the stats, or the event feed. A routine
// beat is something to watch and something to say, never something to count.

import type { MatchEvent, MatchResult } from '../../types/match';
import { isDefendingShotEvent, isShotEvent } from '../../engine/match/event-taxonomy';

/**
 * What a quiet minute is allowed to contain.
 *
 * Deliberately only the four things MatchStats can prove happened. A
 * throw-in is not here: the simulator does not count them, so the renderer
 * treats one as restart texture — how the ball came back — rather than as a
 * beat, which would assert a fact the match never recorded.
 */
export type RoutineBeatKind = 'foul' | 'corner' | 'shot_off_target' | 'save';

export interface RoutineBeat {
  id: string;
  minute: number;
  kind: RoutineBeatKind;
  /** The fouling side for a foul; the attacking side for everything else. */
  teamId: string;
}

const ON_TARGET_TYPES = new Set<MatchEvent["type"]>(['goal', 'penalty_goal', 'save', 'gk_save']);

/**
 * Share of minutes allowed to carry a routine beat.
 *
 * Filling every minute would remove the contrast that makes a beat land.
 * Just under two thirds keeps quiet minutes as connective tissue while
 * making them the minority of the match.
 */
const MAX_BEAT_DENSITY = 0.62;

/** Minutes of clear air a routine beat needs from an event and from another beat. */
const BEAT_CLEARANCE = 2;

function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deterministic 0..1 draw. The same seed and index always give the same number. */
function drawAt(seed: number, index: number): number {
  let state = (seed + Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  state = Math.imul(state ^ (state >>> 16), 2246822507) >>> 0;
  state = Math.imul(state ^ (state >>> 13), 3266489909) >>> 0;
  return ((state ^ (state >>> 16)) >>> 0) / 4294967296;
}

/** A corrupt or hand-edited save must never yield a NaN minute. */
function safeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * The side a shot is charged to.
 *
 * A save or a block names the defending team, so those flip. An own goal does
 * not: the simulator reconciles shots on target as `goals + key saves +
 * blocks + routine saves` per side, and an own goal is inside that side
 * goals figure. Charging it anywhere else would let the same shot be spent
 * twice.
 */
function attackingTeamIdOf(event: MatchEvent, homeTeamId: string, awayTeamId: string): string {
  if (!isDefendingShotEvent(event)) return event.teamId;
  return event.teamId === homeTeamId ? awayTeamId : homeTeamId;
}

type Pair = [number, number];

interface Consumed {
  fouls: Pair;
  corners: Pair;
  shots: Pair;
  onTarget: Pair;
}

/** Everything the event feed already accounts for, per side. */
function consumeEvents(events: MatchEvent[], homeTeamId: string, awayTeamId: string): Consumed {
  const side = (teamId: string) => (teamId === homeTeamId ? 0 : 1);
  const consumed: Consumed = { fouls: [0, 0], corners: [0, 0], shots: [0, 0], onTarget: [0, 0] };

  for (const event of events) {
    // Shootout kicks are not match shots and must not consume the shot totals.
    if (event.shootout) continue;
    if (event.type === 'yellow_card' || event.type === 'red_card') {
      consumed.fouls[side(event.teamId)]++;
      continue;
    }
    const attackingSide = side(attackingTeamIdOf(event, homeTeamId, awayTeamId));
    if (event.type === 'corner') {
      consumed.corners[attackingSide]++;
      continue;
    }
    if (!isShotEvent(event)) continue;
    consumed.shots[attackingSide]++;
    if (ON_TARGET_TYPES.has(event.type)) consumed.onTarget[attackingSide]++;
    // A shot that came from a corner consumes that corner too. Over-counting
    // here only ever lowers the routine total, which is the safe direction.
    if (event.playOrigin === 'corner') consumed.corners[attackingSide]++;
  }

  return consumed;
}

type CountByKind = Record<RoutineBeatKind, Pair>;

function routineCounts(result: MatchResult, consumed: Consumed): CountByKind {
  const stats = result.stats;
  const leftover = (total: number, used: number) => Math.max(0, safeCount(total) - used);
  const shots: Pair = [
    leftover(stats.shots[0], consumed.shots[0]),
    leftover(stats.shots[1], consumed.shots[1]),
  ];
  const onTarget: Pair = [
    leftover(stats.shotsOnTarget[0], consumed.onTarget[0]),
    leftover(stats.shotsOnTarget[1], consumed.onTarget[1]),
  ];
  const saves: Pair = [
    Math.min(shots[0], onTarget[0]),
    Math.min(shots[1], onTarget[1]),
  ];
  return {
    foul: [leftover(stats.fouls[0], consumed.fouls[0]), leftover(stats.fouls[1], consumed.fouls[1])],
    corner: [leftover(stats.corners[0], consumed.corners[0]), leftover(stats.corners[1], consumed.corners[1])],
    save: saves,
    shot_off_target: [shots[0] - saves[0], shots[1] - saves[1]],
  };
}

const KIND_ORDER: RoutineBeatKind[] = ['foul', 'corner', 'save', 'shot_off_target'];

interface BeatSeed {
  kind: RoutineBeatKind;
  teamId: string;
}

function buildBeatPool(counts: CountByKind, homeTeamId: string, awayTeamId: string): BeatSeed[] {
  const pool: BeatSeed[] = [];
  for (const kind of KIND_ORDER) {
    const [home, away] = counts[kind];
    // Alternate sides so a run of fouls is not all one team.
    for (let index = 0; index < Math.max(home, away); index++) {
      if (index < home) pool.push({ kind, teamId: homeTeamId });
      if (index < away) pool.push({ kind, teamId: awayTeamId });
    }
  }
  return pool;
}

/** Keep the stream under the density cap without erasing any single kind. */
function trimToDensity(pool: BeatSeed[], maxMinute: number): BeatSeed[] {
  const cap = Math.max(1, Math.floor(maxMinute * MAX_BEAT_DENSITY));
  if (pool.length <= cap) return pool;
  const kept: BeatSeed[] = [];
  const step = pool.length / cap;
  for (let index = 0; index < cap; index++) kept.push(pool[Math.floor(index * step)]);
  return kept;
}

/** Minutes a beat may land on: clear of every event, and clear of the interval. */
function candidateMinutes(events: MatchEvent[], maxMinute: number): number[] {
  const blocked = new Set<number>();
  for (const event of events) {
    for (let offset = 1 - BEAT_CLEARANCE; offset <= BEAT_CLEARANCE - 1; offset++) {
      blocked.add(event.minute + offset);
    }
  }
  blocked.add(45);
  if (maxMinute > 90) blocked.add(90);
  const minutes: number[] = [];
  for (let minute = 2; minute <= maxMinute; minute++) {
    if (!blocked.has(minute)) minutes.push(minute);
  }
  return minutes;
}

/**
 * One free minute per equal slice of the match.
 *
 * A plain shuffle clumps: a run of five beats inside eight minutes reads as a
 * script glitch, not as a match. Slicing the match and taking one minute from
 * each guarantees the spread, and the seeded draw inside a slice keeps two
 * fixtures from producing the same shape.
 */
function stratifiedPick(count: number, candidates: number[], maxMinute: number, seed: number): number[] {
  if (count <= 0 || candidates.length === 0) return [];
  const available = candidates.slice();
  const picked: number[] = [];
  const span = maxMinute / count;

  for (let index = 0; index < count && available.length > 0; index++) {
    const from = index * span;
    const to = (index + 1) * span;
    const inSlice: number[] = [];
    for (let cursor = 0; cursor < available.length; cursor++) {
      const minute = available[cursor];
      if (minute >= from && minute < to) inSlice.push(cursor);
    }
    let chosen: number;
    if (inSlice.length > 0) {
      const roll = Math.floor(drawAt(seed, index) * inSlice.length);
      chosen = inSlice[Math.min(inSlice.length - 1, Math.max(0, roll))];
    } else {
      // Every minute in this slice is taken. Fall back to the closest one left.
      const target = (from + to) / 2;
      chosen = 0;
      let bestDistance = Infinity;
      for (let cursor = 0; cursor < available.length; cursor++) {
        const distance = Math.abs(available[cursor] - target);
        if (distance < bestDistance) {
          bestDistance = distance;
          chosen = cursor;
        }
      }
    }
    picked.push(available[chosen]);
    available.splice(chosen, 1);
  }

  return picked.sort((left, right) => left - right);
}

/**
 * The routine beats for a match, ordered by minute.
 *
 * Returns an empty list whenever the totals cannot be trusted — an archived
 * replay, a save with no stats — so the live modes fall back to exactly the
 * behaviour they had before.
 */
export function buildRoutineTimeline(result: MatchResult): RoutineBeat[] {
  if (result.detailsArchived || !result.stats) return [];
  const homeTeamId = result.homeTeamId;
  const awayTeamId = result.awayTeamId;
  const maxMinute = result.extraTime ? 120 : 90;
  const matchEvents = result.events.filter(event => !event.shootout && event.minute <= maxMinute);

  const counts = routineCounts(result, consumeEvents(matchEvents, homeTeamId, awayTeamId));
  const pool = trimToDensity(buildBeatPool(counts, homeTeamId, awayTeamId), maxMinute);
  if (pool.length === 0) return [];

  const seed = hashText(result.fixtureId + ':routine-timeline-v1');
  // Deterministic shuffle so consecutive beats are not all the same kind.
  const shuffled = pool.slice();
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swap = Math.floor(drawAt(seed, 1000 + index) * (index + 1));
    const held = shuffled[index];
    shuffled[index] = shuffled[swap];
    shuffled[swap] = held;
  }

  const minutes = stratifiedPick(shuffled.length, candidateMinutes(matchEvents, maxMinute), maxMinute, seed);
  return minutes.map((minute, index) => {
    const entry = shuffled[index];
    return {
      id: 'routine:' + minute + ':' + entry.kind + ':' + entry.teamId,
      minute,
      kind: entry.kind,
      teamId: entry.teamId,
    };
  });
}

export function routineBeatAtMinute(beats: RoutineBeat[], minute: number): RoutineBeat | null {
  for (const beat of beats) {
    if (beat.minute === minute) return beat;
  }
  return null;
}

export function routineBeatsUpTo(beats: RoutineBeat[], minute: number): RoutineBeat[] {
  return beats.filter(beat => beat.minute <= minute);
}

export const EMPTY_ROUTINE_TIMELINE: RoutineBeat[] = [];
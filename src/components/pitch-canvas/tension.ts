// How much the moment is worth being nervous about.
//
// The complaint this answers is specific: watching a match in this game did
// not make the viewer tense. That is not a rendering bug. `danger` already
// tells the stadium how loud the crowd should be, but it only knows about the
// ball — it says nothing about whether anybody cares. A shot in the 88th
// minute of a level cup tie and the same shot in the 20th minute of a
// three-goal walkover are the same `danger` and nothing like the same moment.
//
// So tension is danger weighted by stakes, and stakes is a fact the
// simulation already owns: the scoreline and the clock. Nothing here invents
// a result, and nothing here decides anything — it only decides how hard the
// picture leans into a moment that has already been computed.

import { clamp } from './math';

/**
 * How much the next goal would change the story, from the scoreline alone.
 *
 * A level game and a one-goal game are both fully alive: in the first the
 * next goal decides the match, in the second it decides whether the match
 * stays alive. Past two goals the result has usually stopped being in doubt,
 * and the honest thing is to let the picture say so.
 */
export function scoreStakes(homeScore: number, awayScore: number): number {
  const margin = Math.abs(homeScore - awayScore);
  if (margin <= 1) return 1;
  if (margin === 2) return 0.55;
  if (margin === 3) return 0.28;
  return 0.14;
}

/**
 * How much the clock has turned the same situation into a moment.
 *
 * Ramped rather than stepped: the last ten minutes of a match are not
 * suddenly tense, they have been getting there for an hour. The exponent is
 * what keeps the first half quiet — at 20 minutes this is about a quarter,
 * which is where a 20th-minute goal in a mid-table game belongs.
 */
export function clockStakes(minute: number, durationMinutes = 90): number {
  const span = Math.max(1, durationMinutes);
  const t = clamp(minute / span, 0, 1);
  return clamp(0.2 + 0.8 * Math.pow(t, 1.6), 0, 1);
}

export interface MatchTensionInput {
  /** 0..1 danger from the presentation atmosphere. */
  danger: number;
  minute: number;
  homeScore: number;
  awayScore: number;
  /** Regulation length; extra time simply pins the clock stake at full. */
  durationMinutes?: number;
}

/**
 * 0..1 tension for one frame.
 *
 * Danger is the floor: a shot on goal is worth leaning into whatever the
 * scoreline says, which is why it is not simply multiplied away by low
 * stakes. Stakes are the ceiling: the same shot in a settled match is worth
 * noticeably less. And stakes carry a little on their own, so a goalless
 * last ten minutes still reads as loaded even when the ball is in midfield.
 */
export function matchTension(input: MatchTensionInput): number {
  const danger = clamp(input.danger, 0, 1);
  const stakes = scoreStakes(input.homeScore, input.awayScore)
    * clockStakes(input.minute, input.durationMinutes);
  return clamp(danger * (0.45 + 0.55 * stakes) + stakes * 0.22, 0, 1);
}
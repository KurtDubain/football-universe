import type { MatchEvent } from '../../types/match';

export interface LiveScore {
  home: number;
  away: number;
}

/**
 * The scoreline as it stood at a given minute.
 *
 * Same accounting as `goalFacts`: `own_goal` carries the *beneficiary* club,
 * not the defender who put it in, and shootout kicks are not part of the
 * scoreline at all. A broadcast scoreboard that disagreed with the final
 * result would be the most visible bug in the feature, so the rules are
 * copied rather than reinvented.
 */
export function scoreAtMinute(
  events: readonly MatchEvent[],
  homeTeamId: string,
  minute: number,
): LiveScore {
  let home = 0;
  let away = 0;
  for (const event of events) {
    if (event.type !== 'goal' && event.type !== 'own_goal') continue;
    // Anything past 120 minutes is a shootout kick, which never moves the
    // scoreline; stop at the whistle rather than trusting the minute alone.
    if (event.minute > 120) continue;
    if (event.minute > minute) continue;
    if (event.teamId === homeTeamId) home += 1;
    else away += 1;
  }
  return { home, away };
}

/**
 * The scoreline as it stood after the first `consumedEventCount` events.
 *
 * The scoreboard on the stadium screen and the one in the page chrome have
 * to agree, and the chrome one only moves when the playback commits an
 * event. Slicing the event list by match minute instead had the screen read
 * 1-0 for the six to ten seconds a goal takes to play out while the header
 * still read 0-0 — on every goal of every match, with both numbers on
 * screen at once.
 *
 * The accounting is `scoreAtMinute`'s: `own_goal` carries the beneficiary
 * and shootout kicks are not part of the scoreline.
 */
export function scoreAfterEvents(
  events: readonly MatchEvent[],
  homeTeamId: string,
  consumedEventCount: number,
): LiveScore {
  let home = 0;
  let away = 0;
  const limit = Math.max(0, Math.min(consumedEventCount, events.length));
  for (let index = 0; index < limit; index++) {
    const event = events[index];
    if (event.type !== 'goal' && event.type !== 'own_goal') continue;
    if (event.minute > 120) continue;
    if (event.teamId === homeTeamId) home += 1;
    else away += 1;
  }
  return { home, away };
}
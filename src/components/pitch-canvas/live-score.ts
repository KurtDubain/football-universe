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
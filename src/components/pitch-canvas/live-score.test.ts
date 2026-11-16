import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '../../types/match';
import { scoreAtMinute } from './live-score';

function event(
  minute: number,
  type: MatchEvent['type'],
  teamId: string,
): MatchEvent {
  return { minute, type, teamId, description: type };
}

const EVENTS: MatchEvent[] = [
  event(12, 'goal', 'home'),
  event(38, 'own_goal', 'away'),
  event(55, 'goal', 'home'),
  event(70, 'miss', 'home'),
  event(88, 'goal', 'away'),
  event(121, 'penalty_goal', 'home'),
];

describe('scoreAtMinute', () => {
  it('is level before the first goal', () => {
    expect(scoreAtMinute(EVENTS, 'home', 5)).toEqual({ home: 0, away: 0 });
  });

  it('counts goals up to and including the given minute', () => {
    expect(scoreAtMinute(EVENTS, 'home', 12)).toEqual({ home: 1, away: 0 });
    expect(scoreAtMinute(EVENTS, 'home', 37)).toEqual({ home: 1, away: 0 });
    expect(scoreAtMinute(EVENTS, 'home', 38)).toEqual({ home: 1, away: 1 });
    expect(scoreAtMinute(EVENTS, 'home', 90)).toEqual({ home: 2, away: 2 });
  });

  it('credits an own goal to the club that benefits from it', () => {
    // The event is stamped with the beneficiary, so a naive home/away read
    // already lands correctly; this pins that assumption.
    expect(scoreAtMinute([event(38, 'own_goal', 'away')], 'home', 90))
      .toEqual({ home: 0, away: 1 });
  });

  it('ignores shootout kicks and non-scoring events', () => {
    expect(scoreAtMinute(EVENTS, 'home', 130)).toEqual({ home: 2, away: 2 });
    expect(scoreAtMinute([event(30, 'miss', 'home'), event(31, 'save', 'away')], 'home', 90))
      .toEqual({ home: 0, away: 0 });
  });

  it('handles an empty event list', () => {
    expect(scoreAtMinute([], 'home', 90)).toEqual({ home: 0, away: 0 });
  });
});
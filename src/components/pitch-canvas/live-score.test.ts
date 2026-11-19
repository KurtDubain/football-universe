import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '../../types/match';
import { scoreAfterEvents, scoreAtMinute } from './live-score';

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

describe('scoreAfterEvents', () => {
  it('counts only the events the playback has committed', () => {
    expect(scoreAfterEvents(EVENTS, 'home', 0)).toEqual({ home: 0, away: 0 });
    expect(scoreAfterEvents(EVENTS, 'home', 1)).toEqual({ home: 1, away: 0 });
    expect(scoreAfterEvents(EVENTS, 'home', 2)).toEqual({ home: 1, away: 1 });
    expect(scoreAfterEvents(EVENTS, 'home', EVENTS.length)).toEqual({ home: 2, away: 2 });
  });

  it('holds the pre-goal score while a goal is still being presented', () => {
    // The canvas used to slice by match minute, which read 1-0 on the
    // stadium screen for the six to ten seconds a goal takes to play out
    // while the scoreboard in the page chrome still read 0-0 — both on
    // screen at once, on every goal of every match.
    const goal = event(55, 'goal', 'home');
    const events = [event(12, 'goal', 'home'), goal];
    const pendingIndex = events.indexOf(goal);

    expect(scoreAfterEvents(events, 'home', pendingIndex)).toEqual({ home: 1, away: 0 });
    expect(scoreAfterEvents(events, 'home', pendingIndex + 1)).toEqual({ home: 2, away: 0 });
  });

  it('clamps a cursor that runs past either end of the list', () => {
    expect(scoreAfterEvents(EVENTS, 'home', 999)).toEqual({ home: 2, away: 2 });
    expect(scoreAfterEvents(EVENTS, 'home', -3)).toEqual({ home: 0, away: 0 });
    expect(scoreAfterEvents([], 'home', 4)).toEqual({ home: 0, away: 0 });
  });
});
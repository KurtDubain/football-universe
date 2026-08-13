import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '../../types/match';
import { initialPlaybackState, playbackReducer, type PlaybackState } from './playback-state';

const goal = (teamId: string, playerId: string, minute = 10): MatchEvent => ({
  minute,
  type: 'goal',
  teamId,
  playerId,
  description: `${playerId} scores`,
});

function tick(state: PlaybackState, events: MatchEvent[], maxMinute = 90): PlaybackState {
  return playbackReducer(state, { type: 'tick', events, maxMinute, homeTeamId: 'home' });
}

function commit(state: PlaybackState, events: MatchEvent[]): PlaybackState {
  if (state.pendingEventIndex === null) throw new Error('Expected a pending presentation event');
  return playbackReducer(state, {
    type: 'commitPresentation',
    events,
    eventIndex: state.pendingEventIndex,
    homeTeamId: 'home',
  });
}

describe('match live playback state', () => {
  it('does not update the score until the presentation reaches its outcome', () => {
    const events = [goal('home', 'h9', 1)];
    const pending = tick(initialPlaybackState, events);

    expect(pending.minute).toBe(1);
    expect(pending.pendingEventIndex).toBe(0);
    expect(pending.consumedEventCount).toBe(0);
    expect(pending.homeScore).toBe(0);
    expect(pending.flashEvent).toBeNull();

    const scored = commit(pending, events);
    expect(scored.pendingEventIndex).toBeNull();
    expect(scored.consumedEventCount).toBe(1);
    expect(scored.homeScore).toBe(1);
    expect(scored.flashEvent).toBe(events[0]);
  });

  it('queues same-minute goals instead of collapsing them into one update', () => {
    const events = [
      goal('home', 'h9', 1),
      { minute: 1, type: 'assist', teamId: 'home', playerId: 'h8', description: 'assist' } satisfies MatchEvent,
      goal('away', 'a9', 1),
    ];

    const firstPending = tick(initialPlaybackState, events);
    const firstCommitted = commit(firstPending, events);
    expect(firstCommitted.homeScore).toBe(1);
    expect(firstCommitted.awayScore).toBe(0);

    const secondPending = tick(firstCommitted, events);
    expect(secondPending.pendingEventIndex).toBe(2);
    expect(secondPending.consumedEventCount).toBe(2);
    expect(secondPending.awayScore).toBe(0);

    const completed = commit(secondPending, events);
    expect(completed.homeScore).toBe(1);
    expect(completed.awayScore).toBe(1);
    expect(completed.consumedEventCount).toBe(3);
  });

  it('commits shootout kicks one by one and never counts misses', () => {
    const events: MatchEvent[] = [
      {
        minute: 121,
        type: 'penalty_goal',
        teamId: 'home',
        description: 'scored',
        shootout: { kickNumber: 1, round: 1, teamKickNumber: 1, suddenDeath: false, outcome: 'scored' },
      },
      {
        minute: 122,
        type: 'penalty_miss',
        teamId: 'away',
        description: 'saved',
        shootout: { kickNumber: 2, round: 1, teamKickNumber: 1, suddenDeath: false, outcome: 'saved' },
      },
    ];
    let state: PlaybackState = {
      ...initialPlaybackState,
      minute: 120,
      hasHadHalftime: true,
      hasHadExtraTimeBreak: true,
      hasHadShootoutBreak: true,
    };

    state = tick(state, events, 122);
    expect(state.penaltyHomeScore).toBe(0);
    state = commit(state, events);
    expect(state.penaltyHomeScore).toBe(1);
    state = tick(state, events, 122);
    expect(state.penaltyAwayScore).toBe(0);
    state = commit(state, events);
    expect(state.penaltyAwayScore).toBe(0);
    expect(state.consumedEventCount).toBe(2);
  });

  it('waits for a boundary event before entering the interval', () => {
    const events = [goal('home', 'h9', 45)];
    let state = { ...initialPlaybackState, minute: 44 };
    state = tick(state, events);
    expect(state.phase).toBe('playing');
    expect(state.pendingEventIndex).toBe(0);

    state = commit(state, events);
    state = tick(state, events);
    expect(state.phase).toBe('halftime');
    expect(state.homeScore).toBe(1);
  });

  it('skip remains an explicit immediate final-score path', () => {
    const events = [goal('home', 'h9', 10), goal('away', 'a9', 20), goal('home', 'h10', 30)];
    const finished = playbackReducer(initialPlaybackState, {
      type: 'skip',
      events,
      maxMinute: 90,
      homeTeamId: 'home',
    });
    expect(finished.phase).toBe('finished');
    expect(finished.homeScore).toBe(2);
    expect(finished.awayScore).toBe(1);
    expect(finished.consumedEventCount).toBe(3);
  });
});

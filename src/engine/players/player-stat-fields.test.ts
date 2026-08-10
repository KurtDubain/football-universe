import { describe, expect, it } from 'vitest';
import {
  createEmptyPlayerStatCounters,
  PLAYER_STAT_COUNTER_FIELDS,
  PLAYER_STAT_OPTIONAL_COUNTER_FIELDS,
  PLAYER_STAT_REQUIRED_COUNTER_FIELDS,
  snapshotPlayerStatCounters,
} from './player-stat-fields';
import { emptyPlayerStat } from './stats';

describe('player stat field schema', () => {
  it('partitions every additive counter into required or optional save fields', () => {
    expect(new Set([
      ...PLAYER_STAT_REQUIRED_COUNTER_FIELDS,
      ...PLAYER_STAT_OPTIONAL_COUNTER_FIELDS,
    ])).toEqual(new Set(PLAYER_STAT_COUNTER_FIELDS));
    expect(PLAYER_STAT_REQUIRED_COUNTER_FIELDS).toContain('goals');
    expect(PLAYER_STAT_OPTIONAL_COUNTER_FIELDS).toContain('routineSaves');
  });

  it('uses the shared zero defaults for new rows and historical snapshots', () => {
    const empty = createEmptyPlayerStatCounters();
    expect(Object.keys(empty)).toEqual(PLAYER_STAT_COUNTER_FIELDS);
    expect(Object.values(empty).every(value => value === 0)).toBe(true);

    const stat = emptyPlayerStat('player-1', 'team-1');
    stat.goals = 4;
    stat.appearances = 7;
    stat.minutesPlayed = undefined;
    stat.teamMatchesAllCompetitions = undefined;
    expect(snapshotPlayerStatCounters(stat)).toMatchObject({
      goals: 4,
      minutesPlayed: 0,
      teamMatchesAllCompetitions: 7,
    });
  });
});

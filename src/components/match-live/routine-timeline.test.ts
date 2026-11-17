import { describe, expect, it } from 'vitest';
import type { MatchEvent, MatchResult } from '../../types/match';
import {
  buildRoutineTimeline,
  routineBeatAtMinute,
  routineBeatsUpTo,
  type RoutineBeat,
  type RoutineBeatKind,
} from './routine-timeline';

function makeStats(overrides: Partial<MatchResult["stats"]> = {}): MatchResult["stats"] {
  return {
    possession: [52, 48],
    shots: [12, 9],
    shotsOnTarget: [5, 3],
    corners: [6, 4],
    fouls: [14, 11],
    yellowCards: [1, 2],
    redCards: [0, 0],
    ...overrides,
  };
}

function makeResult(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    fixtureId: 'fx-routine-1',
    homeTeamId: 'home',
    awayTeamId: 'away',
    homeGoals: 1,
    awayGoals: 1,
    extraTime: false,
    penalties: false,
    events: [],
    stats: makeStats(),
    competitionType: 'league',
    competitionName: '联赛',
    roundLabel: '第1轮',
    ...overrides,
  };
}

const SAMPLE_EVENTS: MatchEvent[] = [
  { minute: 12, type: 'goal', teamId: 'home', description: '进球' },
  { minute: 20, type: 'yellow_card', teamId: 'away', description: '黄牌' },
  { minute: 33, type: 'gk_save', teamId: 'home', description: '扑救' },
  { minute: 55, type: 'corner', teamId: 'home', description: '角球' },
];

function tally(beats: RoutineBeat[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const beat of beats) {
    const key = beat.kind + ':' + beat.teamId;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

describe('routine timeline', () => {
  it('derives each kind from the totals the event feed did not already spend', () => {
    const beats = buildRoutineTimeline(makeResult({ events: SAMPLE_EVENTS }));
    const counts = tally(beats);
    // fouls 14/11 minus one away card; corners 6/4 minus one home corner;
    // shots 12/9 minus the home goal and the away-side gk_save; on target
    // 5/3 minus the same two, so saves are capped by what is left on target.
    expect(counts['foul:home']).toBeLessThanOrEqual(14);
    expect(counts['foul:away']).toBeLessThanOrEqual(10);
    expect(counts['corner:home']).toBeLessThanOrEqual(5);
    expect(counts['corner:away']).toBeLessThanOrEqual(4);
    expect(counts['save:home']).toBeLessThanOrEqual(4);
    expect(counts['save:away']).toBeLessThanOrEqual(2);
    expect(counts['shot_off_target:home']).toBeLessThanOrEqual(7);
    expect(counts['shot_off_target:away']).toBeLessThanOrEqual(6);
  });

  it('spends every leftover when the match has room for it', () => {
    const beats = buildRoutineTimeline(makeResult({ events: SAMPLE_EVENTS }));
    const counts = tally(beats);
    const total = beats.length;
    const expected = 24 + 9 + 6 + 13;
    expect(total).toBe(expected);
    expect(counts['foul:home'] + counts['foul:away']).toBe(24);
    expect(counts['corner:home'] + counts['corner:away']).toBe(9);
  });

  it('never lands a beat on or beside an event', () => {
    const beats = buildRoutineTimeline(makeResult({ events: SAMPLE_EVENTS }));
    for (const event of SAMPLE_EVENTS) {
      for (const beat of beats) {
        expect(Math.abs(beat.minute - event.minute)).toBeGreaterThan(1);
      }
    }
  });

  it('spreads beats across the match instead of clumping them', () => {
    const beats = buildRoutineTimeline(makeResult({ events: SAMPLE_EVENTS }));
    expect(beats.length).toBeGreaterThan(40);
    let widestGap = 0;
    for (let index = 1; index < beats.length; index++) {
      widestGap = Math.max(widestGap, beats[index].minute - beats[index - 1].minute);
    }
    expect(widestGap).toBeLessThanOrEqual(6);
    expect(beats[0].minute).toBeLessThan(6);
    expect(beats[beats.length - 1].minute).toBeGreaterThan(84);
  });

  it('keeps the same beats for the same match', () => {
    const first = buildRoutineTimeline(makeResult({ events: SAMPLE_EVENTS }));
    const second = buildRoutineTimeline(makeResult({ events: SAMPLE_EVENTS }));
    expect(second).toEqual(first);
  });

  it('stays under the density cap so quiet minutes still exist', () => {
    const loud = makeResult({
      stats: makeStats({ fouls: [18, 18], shots: [25, 25], shotsOnTarget: [12, 12], corners: [9, 9] }),
    });
    const beats = buildRoutineTimeline(loud);
    expect(beats.length).toBeLessThanOrEqual(Math.floor(90 * 0.62));
  });

  it('charges an own goal to the side the simulator credited it to', () => {
    const beats = buildRoutineTimeline(makeResult({
      events: [{ minute: 30, type: 'own_goal', teamId: 'home', description: '乌龙' }],
      stats: makeStats({ shots: [1, 0], shotsOnTarget: [1, 0], fouls: [0, 0], corners: [0, 0] }),
    }));
    // The simulator reconciles shots on target as goals + saves + blocks, and
    // an own goal sits inside the beneficiary's goal figure. Home's single
    // shot is therefore already spent and nothing may be invented from it.
    expect(beats).toEqual([]);
  });

  it('does not spend the same shot twice when a side keeps one out', () => {
    const beats = buildRoutineTimeline(makeResult({
      events: [{ minute: 30, type: 'gk_save', teamId: 'home', description: '扑救' }],
      stats: makeStats({ shots: [0, 1], shotsOnTarget: [0, 1], fouls: [0, 0], corners: [0, 0] }),
    }));
    // The save names the defending side, so the shot belongs to away and is
    // spent there. Home keeps a clean sheet of nothing to report.
    expect(beats).toEqual([]);
  });

  it('ignores shootout kicks when spending the shot totals', () => {
    const shootoutKicks: MatchEvent[] = [
      {
        minute: 121,
        type: 'penalty_goal',
        teamId: 'home',
        description: '点球',
        shootout: { kickNumber: 1, round: 1, teamKickNumber: 1, suddenDeath: false, outcome: 'scored' },
      },
      {
        minute: 122,
        type: 'penalty_miss',
        teamId: 'away',
        description: '点球',
        shootout: { kickNumber: 2, round: 1, teamKickNumber: 1, suddenDeath: false, outcome: 'off_target' },
      },
    ];
    const beats = buildRoutineTimeline(makeResult({
      penalties: true,
      events: shootoutKicks,
      stats: makeStats({ shots: [0, 0], shotsOnTarget: [0, 0], fouls: [3, 2], corners: [0, 0] }),
    }));
    const counts = tally(beats);
    expect((counts['foul:home'] ?? 0) + (counts['foul:away'] ?? 0)).toBe(5);
    expect(counts['shot_off_target:home']).toBeUndefined();
  });

  it('refuses to fill an archived replay', () => {
    expect(buildRoutineTimeline(makeResult({ detailsArchived: true }))).toEqual([]);
  });

  it('emits nothing when the feed already spent every total', () => {
    const beats = buildRoutineTimeline(makeResult({
      events: SAMPLE_EVENTS,
      stats: makeStats({ fouls: [0, 1], corners: [1, 0], shots: [1, 1], shotsOnTarget: [1, 1] }),
    }));
    expect(beats).toEqual([]);
  });

  it('reads a beat by minute and reveals only what the clock reached', () => {
    const beats = buildRoutineTimeline(makeResult({ events: SAMPLE_EVENTS }));
    const sample = beats[5];
    expect(routineBeatAtMinute(beats, sample.minute)).toEqual(sample);
    expect(routineBeatAtMinute(beats, sample.minute + 1)).not.toEqual(sample);
    const revealed = routineBeatsUpTo(beats, 40);
    expect(revealed.every(beat => beat.minute <= 40)).toBe(true);
    expect(revealed.length).toBe(beats.filter(beat => beat.minute <= 40).length);
  });

  it('extends to extra time without spilling past the final whistle', () => {
    const beats = buildRoutineTimeline(makeResult({ extraTime: true }));
    expect(beats.every(beat => beat.minute <= 120)).toBe(true);
    expect(beats.some(beat => beat.minute > 90)).toBe(true);
    expect(beats.every(beat => beat.minute !== 90)).toBe(true);
  });

  it('only ever emits the four kinds the stats can prove', () => {
    const allowed = new Set<RoutineBeatKind>(['foul', 'corner', 'save', 'shot_off_target']);
    for (const beat of buildRoutineTimeline(makeResult({ events: SAMPLE_EVENTS }))) {
      expect(allowed.has(beat.kind)).toBe(true);
      expect([ 'home', 'away' ]).toContain(beat.teamId);
      expect(Number.isInteger(beat.minute)).toBe(true);
    }
  });
});

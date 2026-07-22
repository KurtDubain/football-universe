import { describe, expect, it } from 'vitest';
import type { MatchResult } from '../../types/match';
import {
  OBSERVATION_HISTORY_LIMIT,
  createEmptyObservationRecord,
  isObservationSelectionValid,
  isPredictionUpset,
  resolveMatchOutcome,
  resolveObservationSelection,
  settleObservationJudgment,
  type PendingObservationJudgment,
} from './judgment';

function result(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    fixtureId: 'fixture-1',
    homeTeamId: 'home',
    awayTeamId: 'away',
    homeGoals: 2,
    awayGoals: 1,
    extraTime: false,
    penalties: false,
    events: [],
    stats: { possession: [50, 50], shots: [8, 7], shotsOnTarget: [4, 3], corners: [3, 2], fouls: [9, 10], yellowCards: [1, 1], redCards: [0, 0] },
    competitionType: 'league',
    competitionName: '联赛',
    roundLabel: 'R1',
    prediction: { homeWinPct: 60, drawPct: 25, awayWinPct: 15, homeExpectedGoals: 1.7, awayExpectedGoals: 0.8 },
    ...overrides,
  };
}

function pending(overrides: Partial<PendingObservationJudgment> = {}): PendingObservationJudgment {
  return { fixtureId: 'fixture-1', seasonNumber: 1, windowIndex: 0, kind: 'outcome', selection: 'home', ...overrides };
}

describe('observation judgment settlement', () => {
  it('resolves regulation, extra-time, and shootout outcomes consistently', () => {
    expect(resolveMatchOutcome(result())).toBe('home');
    expect(resolveMatchOutcome(result({ homeGoals: 1, awayGoals: 1, extraTime: true, etHomeGoals: 0, etAwayGoals: 1 }))).toBe('away');
    expect(resolveMatchOutcome(result({ homeGoals: 0, awayGoals: 0, penalties: true, penaltyHome: 5, penaltyAway: 4 }))).toBe('home');
  });

  it('supports outcome, total-goal, and model-defined upset judgments', () => {
    const upset = result({ homeGoals: 0, awayGoals: 2 });
    expect(resolveObservationSelection('outcome', upset)).toBe('away');
    expect(resolveObservationSelection('goals', upset)).toBe('under-3');
    expect(resolveObservationSelection('upset', upset)).toBe('yes');
    expect(isPredictionUpset(upset)).toBe(true);
    expect(isObservationSelectionValid('outcome', 'home')).toBe(true);
    expect(isObservationSelectionValid('goals', 'home')).toBe(false);
  });

  it('keeps unmatched judgments pending and settles a fixture only once', () => {
    const untouched = settleObservationJudgment(undefined, pending(), [result({ fixtureId: 'other' })]);
    expect(untouched.pending).toEqual(pending());
    expect(untouched.record.total).toBe(0);

    const settled = settleObservationJudgment(untouched.record, untouched.pending, [result()]);
    expect(settled.pending).toBeNull();
    expect(settled.record).toMatchObject({ total: 1, correct: 1, currentStreak: 1, bestStreak: 1 });
    expect(settleObservationJudgment(settled.record, settled.pending, [result()]).record.total).toBe(1);
  });

  it('tracks misses and bounds detailed history without losing totals', () => {
    let record = createEmptyObservationRecord();
    for (let index = 0; index < OBSERVATION_HISTORY_LIMIT + 5; index++) {
      const settled = settleObservationJudgment(record, pending({ fixtureId: `f-${index}`, selection: index % 2 ? 'away' : 'home' }), [
        result({ fixtureId: `f-${index}` }),
      ]);
      record = settled.record;
    }
    expect(record.total).toBe(OBSERVATION_HISTORY_LIMIT + 5);
    expect(record.recent).toHaveLength(OBSERVATION_HISTORY_LIMIT);
    expect(record.currentStreak).toBe(1);
    expect(record.bestStreak).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import type { MatchResult } from '../../types/match';
import type { TeamBase, TeamState } from '../../types/team';
import { applySeasonEndReset } from '../state-updater';
import { updateCoachPressure } from './coach-pressure';

const teamBase = {
  id: 'team-a',
  expectation: 3,
} as TeamBase;

const draw = {
  homeTeamId: 'team-a',
  awayTeamId: 'team-b',
  homeGoals: 1,
  awayGoals: 1,
} as MatchResult;

describe('coach pressure precision', () => {
  it('normalizes match updates to one decimal place', () => {
    const result = updateCoachPressure(10.799999999999999, draw, 'team-a', teamBase, [], false);

    expect(Number.isInteger(result.newPressure * 10)).toBe(true);
  });

  it('normalizes pressure carried into a new season', () => {
    const state = {
      coachPressure: 35.99999999999999,
    } as TeamState;

    expect(applySeasonEndReset(state, 5, 16).coachPressure).toBe(10.8);
  });
});

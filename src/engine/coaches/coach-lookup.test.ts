import { describe, it, expect } from 'vitest';
import { getTeamCoachId, buildTeamCoachMap } from './coach-lookup';
import { CoachState } from '../../types/coach';

function cs(id: string, currentTeamId: string | null): CoachState {
  return {
    id,
    currentTeamId,
    isUnemployed: currentTeamId === null,
    unemployedSince: currentTeamId === null ? 0 : null,
  };
}

describe('getTeamCoachId', () => {
  it('returns the coach id whose currentTeamId matches', () => {
    const states: Record<string, CoachState> = {
      coach_a: cs('coach_a', 'team_x'),
      coach_b: cs('coach_b', 'team_y'),
      coach_c: cs('coach_c', null),
    };
    expect(getTeamCoachId(states, 'team_x')).toBe('coach_a');
    expect(getTeamCoachId(states, 'team_y')).toBe('coach_b');
  });

  it('returns null for an unassigned team', () => {
    const states: Record<string, CoachState> = {
      coach_a: cs('coach_a', 'team_x'),
      coach_b: cs('coach_b', null),
    };
    expect(getTeamCoachId(states, 'team_z')).toBeNull();
  });

  it('round-trips: assigning then looking up returns the same coach', () => {
    const states: Record<string, CoachState> = {
      coach_a: cs('coach_a', null),
      coach_b: cs('coach_b', null),
    };
    // Assign coach_a to team_x
    states.coach_a = { ...states.coach_a, currentTeamId: 'team_x', isUnemployed: false, unemployedSince: null };
    expect(getTeamCoachId(states, 'team_x')).toBe('coach_a');

    // Re-assign: coach_a leaves team_x, coach_b takes over
    states.coach_a = { ...states.coach_a, currentTeamId: null, isUnemployed: true, unemployedSince: 5 };
    states.coach_b = { ...states.coach_b, currentTeamId: 'team_x', isUnemployed: false, unemployedSince: null };
    expect(getTeamCoachId(states, 'team_x')).toBe('coach_b');
  });

  it('picks deterministically (first by iteration order) when multiple coaches share a team — should not happen but defensive', () => {
    const states: Record<string, CoachState> = {
      coach_first: cs('coach_first', 'team_x'),
      coach_second: cs('coach_second', 'team_x'),
    };
    // First-inserted key wins under stable string-key iteration order.
    expect(getTeamCoachId(states, 'team_x')).toBe('coach_first');
  });
});

describe('buildTeamCoachMap', () => {
  it('builds a map from teamId → coachId, skipping unassigned coaches', () => {
    const states: Record<string, CoachState> = {
      coach_a: cs('coach_a', 'team_x'),
      coach_b: cs('coach_b', 'team_y'),
      coach_c: cs('coach_c', null),
    };
    const map = buildTeamCoachMap(states);
    expect(map.size).toBe(2);
    expect(map.get('team_x')).toBe('coach_a');
    expect(map.get('team_y')).toBe('coach_b');
    expect(map.get('team_z')).toBeUndefined();
  });

  it('matches getTeamCoachId on conflict (first-in wins)', () => {
    const states: Record<string, CoachState> = {
      coach_first: cs('coach_first', 'team_x'),
      coach_second: cs('coach_second', 'team_x'),
    };
    const map = buildTeamCoachMap(states);
    expect(map.get('team_x')).toBe('coach_first');
    expect(map.get('team_x')).toBe(getTeamCoachId(states, 'team_x'));
  });

  it('returns an empty map when all coaches are unemployed', () => {
    const states: Record<string, CoachState> = {
      coach_a: cs('coach_a', null),
      coach_b: cs('coach_b', null),
    };
    const map = buildTeamCoachMap(states);
    expect(map.size).toBe(0);
  });
});

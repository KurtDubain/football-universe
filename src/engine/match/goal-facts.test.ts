import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '../../types/match';
import { goalFacts } from './goal-facts';

const goal = (minute: number, teamId: string, type: MatchEvent['type'] = 'goal'): MatchEvent => ({ minute, teamId, type, description: '' });
const match = (events: MatchEvent[], homeGoals: number, awayGoals: number) => ({ events, homeGoals, awayGoals, homeTeamId: 'H', awayTeamId: 'A' });
describe('authoritative goal labels', () => {
  it('does not call an insurance goal a winner, or an additional lead a turnaround', () => {
    const rows = goalFacts(match([goal(10, 'A'), goal(30, 'H'), goal(60, 'H'), goal(89, 'H')], 3, 1));
    expect(rows[2].turnaround).toBe(true);
    expect(rows[3]).toMatchObject({ turnaround: false, lateWinner: false });
  });
  it('uses stable same-minute order and final draw, not the penalty shootout winner', () => {
    const rows = goalFacts(match([goal(89, 'H'), goal(89, 'A'), goal(123, 'H', 'penalty_goal')], 1, 1));
    expect(rows).toHaveLength(2);
    expect(rows[0].lateWinner).toBe(false);
    expect(rows[1].lateEqualizer).toBe(true);
  });
  it('credits own goals to their beneficiary and checks extra time against the complete score', () => {
    const events = [goal(20, 'H'), goal(40, 'A'), goal(119, 'H', 'own_goal')];
    expect(goalFacts({ ...match(events, 1, 1), etHomeGoals: 1, etAwayGoals: 0 })[2].lateWinner).toBe(true);
    expect(goalFacts(match([goal(89, 'H')], 2, 1))[0].lateWinner).toBe(false);
  });
});

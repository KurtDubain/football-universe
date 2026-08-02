import { describe, expect, it } from 'vitest';
import type { CompetitionType, MatchFixture } from '../../types/match';
import { applyVenuePolicy, isNeutralVenueFixture } from './venue-policy';

function fixture(competitionType: CompetitionType, roundLabel: string): MatchFixture {
  return {
    id: `${competitionType}-${roundLabel}`,
    homeTeamId: 'home',
    awayTeamId: 'away',
    competitionType,
    competitionName: '测试赛事',
    roundLabel,
  };
}

describe('competition venue policy', () => {
  it.each([
    ['league', '第1轮', false],
    ['super_cup_group', 'Group A - R1', false],
    ['super_cup', 'QF-L1', false],
    ['super_cup', 'QF-L2', false],
    ['super_cup', 'Final', true],
    ['league_cup', 'R32', true],
    ['world_cup_group', 'Group A - R1', true],
    ['world_cup', 'R16', true],
    ['continental_cup', 'Group A - R1', true],
    ['continental_cup', 'SF', true],
    ['relegation_playoff', '升降级附加赛', true],
  ] satisfies Array<[CompetitionType, string, boolean]>)(
    'maps %s %s to neutral=%s',
    (competitionType, roundLabel, expected) => {
      expect(isNeutralVenueFixture(fixture(competitionType, roundLabel))).toBe(expected);
    },
  );

  it('overrides stale fixture flags with the competition policy', () => {
    expect(applyVenuePolicy({
      ...fixture('world_cup_group', 'Group A - R1'),
      isNeutralVenue: false,
    }).isNeutralVenue).toBe(true);
    expect(applyVenuePolicy({
      ...fixture('league', '第1轮'),
      isNeutralVenue: true,
    }).isNeutralVenue).toBe(false);
  });
});

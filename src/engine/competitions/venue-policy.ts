import type { MatchFixture } from '../../types/match';

type VenueInput = Pick<MatchFixture, 'competitionType' | 'roundLabel'>;

function isFinalRound(roundLabel: string): boolean {
  const normalized = roundLabel.trim().toLowerCase();
  return normalized === 'final'
    || normalized === '决赛'
    || normalized.endsWith(' final');
}

/**
 * Central competition venue policy.
 *
 * A fixture's home/away slots still drive score and event attribution at a
 * neutral venue. Only genuine hosted league/group matches and two-leg ties
 * receive home advantage.
 */
export function isNeutralVenueFixture(fixture: VenueInput): boolean {
  switch (fixture.competitionType) {
    case 'league':
    case 'super_cup_group':
      return false;
    case 'super_cup':
      return isFinalRound(fixture.roundLabel);
    case 'league_cup':
    case 'world_cup':
    case 'world_cup_group':
    case 'continental_cup':
    case 'relegation_playoff':
      return true;
  }
}

export function applyVenuePolicy<T extends MatchFixture>(fixture: T): T {
  return {
    ...fixture,
    isNeutralVenue: isNeutralVenueFixture(fixture),
  };
}

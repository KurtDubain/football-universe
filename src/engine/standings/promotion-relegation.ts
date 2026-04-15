import { StandingEntry } from '../../types/league';
import { MatchFixture, MatchResult } from '../../types/match';

export interface PromotionRelegationResult {
  promoted: { teamId: string; from: number; to: number }[];
  relegated: { teamId: string; from: number; to: number }[];
  playoffFixtures: MatchFixture[]; // playoff matches to schedule
}

/**
 * Determine direct promotions and relegations from final standings.
 * Also generates playoff fixtures that still need to be played.
 *
 * Rules:
 * - Top league (1): bottom 2 relegated, 3rd from bottom plays relegation playoff
 * - Mid league (2): top 2 promoted, bottom 2 relegated,
 *                    3rd plays promotion playoff (up), 3rd from bottom plays relegation playoff (down)
 * - Low league (3): top 2 promoted, 3rd plays promotion playoff
 *
 * Playoffs are single-match: the higher-tier team has home advantage.
 *
 * The returned promoted/relegated arrays contain only the DIRECT movements.
 * Playoff outcomes are resolved separately via applyPlayoffResults().
 */
export function determinePromotionRelegation(
  league1Standings: StandingEntry[],
  league2Standings: StandingEntry[],
  league3Standings: StandingEntry[],
  seasonNumber: number,
): PromotionRelegationResult {
  const promoted: PromotionRelegationResult['promoted'] = [];
  const relegated: PromotionRelegationResult['relegated'] = [];
  const playoffFixtures: MatchFixture[] = [];

  const n1 = league1Standings.length;
  const n2 = league2Standings.length;

  // --- Direct movements ---

  // League 1: bottom 2 relegated to League 2
  relegated.push(
    { teamId: league1Standings[n1 - 1].teamId, from: 1, to: 2 },
    { teamId: league1Standings[n1 - 2].teamId, from: 1, to: 2 },
  );

  // League 2: top 2 promoted to League 1
  promoted.push(
    { teamId: league2Standings[0].teamId, from: 2, to: 1 },
    { teamId: league2Standings[1].teamId, from: 2, to: 1 },
  );

  // League 2: bottom 2 relegated to League 3
  relegated.push(
    { teamId: league2Standings[n2 - 1].teamId, from: 2, to: 3 },
    { teamId: league2Standings[n2 - 2].teamId, from: 2, to: 3 },
  );

  // League 3: top 2 promoted to League 2
  promoted.push(
    { teamId: league3Standings[0].teamId, from: 3, to: 2 },
    { teamId: league3Standings[1].teamId, from: 3, to: 2 },
  );

  // --- Playoff fixtures ---

  // Playoff 1: League 1 vs League 2
  // L1 3rd-from-bottom (home, higher tier) vs L2 3rd place (away)
  const l1PlayoffTeam = league1Standings[n1 - 3].teamId;
  const l2PromotionCandidate = league2Standings[2].teamId;

  playoffFixtures.push({
    id: `S${seasonNumber}-PO-L1L2`,
    homeTeamId: l1PlayoffTeam,
    awayTeamId: l2PromotionCandidate,
    competitionType: 'relegation_playoff',
    competitionName: 'League 1/2 Playoff',
    roundLabel: 'Playoff',
  });

  // Playoff 2: League 2 vs League 3
  // L2 3rd-from-bottom (home, higher tier) vs L3 3rd place (away)
  const l2RelegationCandidate = league2Standings[n2 - 3].teamId;
  const l3PromotionCandidate = league3Standings[2].teamId;

  playoffFixtures.push({
    id: `S${seasonNumber}-PO-L2L3`,
    homeTeamId: l2RelegationCandidate,
    awayTeamId: l3PromotionCandidate,
    competitionType: 'relegation_playoff',
    competitionName: 'League 2/3 Playoff',
    roundLabel: 'Playoff',
  });

  return { promoted, relegated, playoffFixtures };
}

/**
 * Determine the winner of a single-match playoff from its result.
 * Handles regular time, extra time, and penalty shootout.
 * Returns true if the home team won.
 */
function didHomeTeamWin(result: MatchResult): boolean {
  // Total goals through regular + extra time
  const totalHome = result.homeGoals + (result.etHomeGoals ?? 0);
  const totalAway = result.awayGoals + (result.etAwayGoals ?? 0);

  if (totalHome !== totalAway) {
    return totalHome > totalAway;
  }

  // Decided by penalties
  if (result.penalties) {
    return (result.penaltyHome ?? 0) > (result.penaltyAway ?? 0);
  }

  // Should not happen in a playoff, but default to home advantage
  return true;
}

/**
 * After playoff matches are played, apply the final promotions/relegations.
 * Combines the direct movements from determinePromotionRelegation with
 * the playoff outcomes.
 *
 * If the lower-league team wins the playoff, they are promoted and the
 * higher-league team is relegated. If the higher-league team wins,
 * both teams stay in their current leagues (no additional movement).
 */
export function applyPlayoffResults(
  pendingResult: PromotionRelegationResult,
  playoffResults: MatchResult[],
): {
  promoted: { teamId: string; from: number; to: number }[];
  relegated: { teamId: string; from: number; to: number }[];
} {
  const promoted = [...pendingResult.promoted];
  const relegated = [...pendingResult.relegated];

  for (const result of playoffResults) {
    const fixture = pendingResult.playoffFixtures.find(
      (f) => f.id === result.fixtureId,
    );
    if (!fixture) continue;

    const homeWins = didHomeTeamWin(result);

    // Home team is from the higher tier, away team from the lower tier.
    // If the away (lower-league) team wins, they swap leagues.
    if (!homeWins) {
      // Parse league levels from competitionName (e.g. "League 1/2 Playoff")
      const match = fixture.competitionName.match(/League (\d+)\/(\d+)/);
      if (!match) continue;

      const upperLeague = parseInt(match[1], 10);
      const lowerLeague = parseInt(match[2], 10);

      promoted.push({
        teamId: fixture.awayTeamId,
        from: lowerLeague,
        to: upperLeague,
      });
      relegated.push({
        teamId: fixture.homeTeamId,
        from: upperLeague,
        to: lowerLeague,
      });
    }
    // If home (higher-league) team wins, no movement -- both stay put.
  }

  return { promoted, relegated };
}

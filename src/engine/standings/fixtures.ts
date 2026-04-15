import { MatchFixture } from '../../types';

/**
 * Simple seeded pseudo-random number generator (LCG).
 * Returns a function that produces values in [0, 1).
 */
function seededRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return (s >>> 0) / 0x100000000;
  };
}

/**
 * Fisher-Yates shuffle using a seeded RNG for deterministic results.
 */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  const rng = seededRng(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const BYE_MARKER = '__BYE__';

/**
 * Generate double round-robin fixtures for a league.
 * Uses the standard circle (polygon) rotation algorithm to ensure balanced scheduling.
 * Returns an array of rounds, where each round is an array of MatchFixture.
 *
 * For N teams: N-1 rounds in first half, N-1 rounds in second half (reversed home/away).
 * Total: 2*(N-1) rounds.
 *
 * For 16 teams: 30 rounds, each round has 8 matches.
 * For 8 teams: 14 rounds, each round has 4 matches.
 *
 * Each team plays every other team exactly twice (once home, once away).
 * Fixture IDs are deterministic based on season number and league level.
 */
export function generateLeagueFixtures(
  teamIds: string[],
  leagueLevel: number,
  seasonNumber: number,
  seed: number,
): MatchFixture[][] {
  const n = teamIds.length;
  if (n < 2) return [];

  // Shuffle team order with seed so different seasons get different schedules
  const teams = seededShuffle(teamIds, seed);

  // Circle method requires an even number of participants
  const hasBye = n % 2 !== 0;
  const scheduleTeams = hasBye ? [...teams, BYE_MARKER] : [...teams];
  const total = scheduleTeams.length;
  const halfRounds = total - 1;
  const matchesPerRound = total / 2;

  const competitionName = `League ${leagueLevel}`;
  const allRounds: MatchFixture[][] = [];

  // --- First half: N-1 rounds using circle method ---
  // Fix the last team in place; rotate positions 0..N-2 each round.
  for (let r = 0; r < halfRounds; r++) {
    const roundFixtures: MatchFixture[] = [];

    // Build the position array for this round
    const pos: number[] = [];
    for (let i = 0; i < total - 1; i++) {
      pos.push((i + r) % (total - 1));
    }
    pos.push(total - 1); // fixed team always at last position

    let matchCount = 0;
    for (let i = 0; i < matchesPerRound; i++) {
      let homeIdx = pos[i];
      let awayIdx = pos[total - 1 - i];

      // Alternate home/away for the match involving the fixed team
      // so that the fixed team doesn't always play home or away
      if (i === 0 && r % 2 === 1) {
        [homeIdx, awayIdx] = [awayIdx, homeIdx];
      }

      const homeTeam = scheduleTeams[homeIdx];
      const awayTeam = scheduleTeams[awayIdx];

      // Skip BYE matches (only relevant for odd number of teams)
      if (homeTeam === BYE_MARKER || awayTeam === BYE_MARKER) continue;

      matchCount++;
      roundFixtures.push({
        id: `S${seasonNumber}-L${leagueLevel}-R${r + 1}-M${matchCount}`,
        homeTeamId: homeTeam,
        awayTeamId: awayTeam,
        competitionType: 'league',
        competitionName,
        roundLabel: `Round ${r + 1}`,
      });
    }

    allRounds.push(roundFixtures);
  }

  // --- Second half: mirror first half with home/away reversed ---
  for (let r = 0; r < halfRounds; r++) {
    const firstHalfRound = allRounds[r];
    const roundNumber = halfRounds + r + 1;

    const roundFixtures: MatchFixture[] = firstHalfRound.map((fixture, idx) => ({
      id: `S${seasonNumber}-L${leagueLevel}-R${roundNumber}-M${idx + 1}`,
      homeTeamId: fixture.awayTeamId,
      awayTeamId: fixture.homeTeamId,
      competitionType: 'league' as const,
      competitionName,
      roundLabel: `Round ${roundNumber}`,
    }));

    allRounds.push(roundFixtures);
  }

  return allRounds;
}

import { Player, PlayerPosition } from '../../types/player';
import { TeamBase } from '../../types/team';
import { SeededRNG } from '../match/rng';

/**
 * Generate 22 players for a team.
 * Squad composition: 3 GK, 7 DF, 7 MF, 5 FW = 22
 *
 * Shirt numbers: assigned randomly from available pool (1-99)
 * but GK always includes #1, and there's always a #10 (star midfielder/forward)
 *
 * Player ratings based on team overall with position-specific adjustments:
 * - For an elite team (overall 90), players range from 75-95
 * - For a weak team (overall 45), players range from 30-55
 * - Each team has 2-3 "star" players who are significantly above average
 * - goalScoring: high for FW (60-100), medium for MF (20-50), low for DF/GK (0-15)
 */
export function generateSquad(team: TeamBase, rng: SeededRNG): Player[] {
  // Define squad positions
  const positions: PlayerPosition[] = [
    'GK', 'GK', 'GK',
    'DF', 'DF', 'DF', 'DF', 'DF', 'DF', 'DF',
    'MF', 'MF', 'MF', 'MF', 'MF', 'MF', 'MF',
    'FW', 'FW', 'FW', 'FW', 'FW',
  ];

  // Generate available shirt numbers (1-99)
  // Reserve: 1 for GK, 10 for star
  const usedNumbers = new Set<number>();

  function pickNumber(preferred?: number): number {
    if (preferred && !usedNumbers.has(preferred)) {
      usedNumbers.add(preferred);
      return preferred;
    }
    // Common football numbers
    const pool = Array.from({ length: 99 }, (_, i) => i + 1).filter(
      (n) => !usedNumbers.has(n),
    );
    const num = rng.pick(pool);
    usedNumbers.add(num);
    return num;
  }

  const players: Player[] = [];

  // Determine star player indices (2-3 stars)
  const starCount = rng.nextInt(2, 3);
  const starIndices = new Set<number>();
  while (starIndices.size < starCount) {
    // Stars tend to be forwards or midfielders
    starIndices.add(rng.nextInt(10, 21)); // indices 10-21 are MF and FW
  }

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const isStar = starIndices.has(i);

    // Base rating from team overall, adjusted by position attribute
    let baseRating: number;
    switch (pos) {
      case 'GK':
        baseRating = team.defense * 0.8 + team.overall * 0.2;
        break;
      case 'DF':
        baseRating = team.defense * 0.6 + team.overall * 0.4;
        break;
      case 'MF':
        baseRating = team.midfield * 0.6 + team.overall * 0.4;
        break;
      case 'FW':
        baseRating = team.attack * 0.6 + team.overall * 0.4;
        break;
    }

    // Add variation: +/-10 for normal, +5 to +12 for stars
    let rating: number;
    if (isStar) {
      rating = Math.round(baseRating + rng.nextFloat(5, 12));
    } else {
      rating = Math.round(baseRating + rng.nextFloat(-10, 5));
    }
    rating = Math.max(25, Math.min(99, rating));

    // Goal scoring tendency
    let goalScoring: number;
    switch (pos) {
      case 'FW':
        goalScoring = rng.nextInt(55, 100);
        break;
      case 'MF':
        goalScoring = rng.nextInt(15, 50);
        break;
      case 'DF':
        goalScoring = rng.nextInt(2, 15);
        break;
      case 'GK':
        goalScoring = rng.nextInt(0, 2);
        break;
    }
    if (isStar && (pos === 'FW' || pos === 'MF')) {
      goalScoring = Math.min(100, goalScoring + 20);
    }

    // Assign shirt number
    let number: number;
    if (i === 0) {
      number = pickNumber(1); // First GK gets #1
    } else if (isStar && pos === 'MF') {
      number = pickNumber(10); // Star MF gets #10
    } else if (isStar && pos === 'FW') {
      number = pickNumber(rng.pick([7, 9, 11])); // Star FW gets iconic number
    } else {
      number = pickNumber();
    }

    players.push({
      id: `${team.id}-${number}`,
      teamId: team.id,
      number,
      position: pos,
      rating,
      goalScoring,
    });
  }

  // Sort by position order then number
  const posOrder: Record<PlayerPosition, number> = {
    GK: 0,
    DF: 1,
    MF: 2,
    FW: 3,
  };
  players.sort(
    (a, b) => posOrder[a.position] - posOrder[b.position] || a.number - b.number,
  );

  return players;
}

/**
 * Generate squads for all teams.
 */
export function generateAllSquads(
  teams: TeamBase[],
  seed: number,
): Record<string, Player[]> {
  const rng = new SeededRNG(seed);
  const squads: Record<string, Player[]> = {};
  for (const team of teams) {
    squads[team.id] = generateSquad(team, rng);
  }
  return squads;
}

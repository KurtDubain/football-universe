import { Player, PlayerPosition } from '../../types/player';
import { TeamBase } from '../../types/team';
import { SeededRNG } from '../match/rng';
import { pickPlayerName } from '../../config/player-names';
import { computeInitialMarketValue } from '../economy/market-value';
import { rollTagForUuid } from './tags';
import { computeCurrentRating } from './development';

/**
 * Format a uuid from a monotonic counter. The shape `p-<n>` is opaque to
 * everything except the migration; consumers just compare strings. The
 * counter is owned by GameWorld.nextPlayerUuidCounter so it survives across
 * sessions and any future generator calls (e.g. youth promotions).
 */
export function formatPlayerUuid(counter: number): string {
  return `p-${counter}`;
}

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
 *
 * `nextUuid` is a counter object — it's mutated in place so the caller can
 * track how many uuids have been allocated across the whole `generateAllSquads`
 * pass and persist the next free value on GameWorld.
 */
export function generateSquad(team: TeamBase, rng: SeededRNG, nextUuid: { value: number }): Player[] {
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
  const usedNames = new Set<string>();
  const region = team.region ?? '大陆+其他';

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

    // Add variation: +/-10 for normal, +5 to +12 for stars.
    // This is the player's DESTINED PEAK rating — their ceiling. The current
    // rating is derived below from the age curve so a teenager doesn't ship
    // at full peak.
    let peakRating: number;
    if (isStar) {
      peakRating = Math.round(baseRating + rng.nextFloat(5, 12));
    } else {
      peakRating = Math.round(baseRating + rng.nextFloat(-10, 5));
    }
    peakRating = Math.max(25, Math.min(99, peakRating));

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

    const playerName = pickPlayerName(region, usedNames, (arr) => rng.pick(arr));
    // Age: stars are 24-30 (peak band), others 19-34 (uniform spread).
    const age = isStar ? rng.nextInt(24, 30) : rng.nextInt(19, 34);
    // Individual peak-age variance — 24-29, uniform. peakRating is fixed;
    // the curve in development.ts scales the *current* rating from it so a
    // 19-year-old wonderkid doesn't ship at full peak.
    const peakAge = rng.nextInt(24, 29);
    const rating = computeCurrentRating(peakRating, age, peakAge);
    const newPlayer: Player = {
      uuid: formatPlayerUuid(nextUuid.value++),
      teamId: team.id,
      name: playerName,
      number,
      position: pos,
      rating,
      peakRating,
      peakAge,
      goalScoring,
      age,
      marketValue: 0, // computed below after object exists
    };
    // Assign personality tag deterministically (uuid-hash based)
    const tag = rollTagForUuid(newPlayer.uuid);
    if (tag) newPlayer.tag = tag;
    newPlayer.marketValue = computeInitialMarketValue(newPlayer);
    players.push(newPlayer);
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
 *
 * Returns the squads plus the next free uuid counter so the caller can
 * persist it on GameWorld for any future player creation.
 */
export function generateAllSquads(
  teams: TeamBase[],
  seed: number,
): { squads: Record<string, Player[]>; nextPlayerUuidCounter: number } {
  const rng = new SeededRNG(seed);
  const squads: Record<string, Player[]> = {};
  const nextUuid = { value: 0 };
  for (const team of teams) {
    squads[team.id] = generateSquad(team, rng, nextUuid);
  }
  return { squads, nextPlayerUuidCounter: nextUuid.value };
}

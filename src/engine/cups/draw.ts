import { SeededRNG } from '../match/rng';

/**
 * Draw teams into groups. E.g., 16 teams into 4 groups of 4.
 * Uses seeded randomness. Can support pot-based seeding.
 *
 * If pots are provided, one team from each pot is placed into each group,
 * ensuring balanced group composition (e.g., each group gets one top-seed,
 * one second-seed, etc.). Pots are shuffled internally before assignment.
 *
 * Without pots, all teams are shuffled and dealt round-robin into groups.
 */
export function drawGroups(
  teamIds: string[],
  groupCount: number,
  rng: SeededRNG,
  pots?: string[][],
): string[][] {
  const groups: string[][] = Array.from({ length: groupCount }, () => []);

  if (pots && pots.length > 0) {
    // Pot-based seeding: distribute one team from each pot into each group.
    // Each pot should have exactly groupCount teams for a perfect distribution.
    for (const pot of pots) {
      const shuffled = rng.shuffle([...pot]);
      for (let i = 0; i < shuffled.length && i < groupCount; i++) {
        groups[i].push(shuffled[i]);
      }
    }
  } else {
    // Simple: shuffle all teams and deal round-robin into groups
    const shuffled = rng.shuffle([...teamIds]);
    for (let i = 0; i < shuffled.length; i++) {
      groups[i % groupCount].push(shuffled[i]);
    }
  }

  return groups;
}

/**
 * Generate knockout bracket from qualified teams.
 * Seeds teams so that top group winners face bottom group runners-up, etc.
 *
 * With N groups, the pairing is:
 *   Winner of group i  vs  Runner-up of group (N - 1 - i)
 *
 * This ensures teams from the same group cannot meet in the first knockout round,
 * and rewards higher-ranked group winners with (theoretically) weaker opponents.
 */
export function drawKnockoutBracket(
  qualifiedTeams: { teamId: string; groupIndex: number; position: number }[],
  rng: SeededRNG,
): [string, string][] {
  // Separate winners (position 1) and runners-up (position 2)
  const winners = qualifiedTeams
    .filter((t) => t.position === 1)
    .sort((a, b) => a.groupIndex - b.groupIndex);

  const runnersUp = qualifiedTeams
    .filter((t) => t.position === 2)
    .sort((a, b) => a.groupIndex - b.groupIndex);

  const n = winners.length;
  const pairs: [string, string][] = [];

  // Top group winners face bottom group runners-up
  for (let i = 0; i < n; i++) {
    const winner = winners[i];
    const runnerUp = runnersUp[n - 1 - i];
    pairs.push([winner.teamId, runnerUp.teamId]);
  }

  return pairs;
}

/**
 * Generate a simple knockout bracket from a shuffled list.
 * Used for league cup where there's no seeding.
 *
 * All teams are shuffled randomly, then paired sequentially:
 *   [t1 vs t2], [t3 vs t4], [t5 vs t6], ...
 *
 * Requires an even number of teams. The first team in each pair is home.
 */
export function drawSimpleKnockout(
  teamIds: string[],
  rng: SeededRNG,
): [string, string][] {
  const shuffled = rng.shuffle([...teamIds]);
  const pairs: [string, string][] = [];

  for (let i = 0; i < shuffled.length; i += 2) {
    pairs.push([shuffled[i], shuffled[i + 1]]);
  }

  return pairs;
}

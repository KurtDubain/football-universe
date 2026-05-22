import { Player, PlayerPosition } from '../../types/player';
import { BALANCE } from '../../config/balance';

/**
 * Phase 1B — player-derived squad boost.
 *
 * Players contribute additive ±X to a team's attack/midfield/defense
 * stats in the same slot as coach buffs. Designed to feel like:
 *   - star-loaded teams are MEANINGFULLY stronger (but not 2× stronger)
 *   - injuries to key players visibly weaken the team next match
 *   - benching weakens you, signing stars strengthens you
 *
 * KEY INVARIANT: team.overall remains the foundation. Boosts are
 * additive ±cap and never replace the base. A weak team with stars
 * is still weaker than an elite team, just by a smaller margin.
 *
 * Algorithm (per-position-average, NOT per-player-sum — sum-based
 * formulas saturate the cap with 12 starters even at small per-player
 * deltas, flattening every team to either +cap or -cap):
 *
 *   1. Filter out injured / suspended players (they can't play, can't buff)
 *   2. Pick top N "starters" per position (rating desc):
 *        GK: 1, DF: 4, MF: 4, FW: 3 → 12 starters total
 *   3. For each position:
 *        avg = mean rating of those starters
 *        delta = avg - BASELINE_RATING   // baseline = 60
 *        attack += delta × posWeight.attack
 *        midfield += delta × posWeight.midfield
 *        defense += delta × posWeight.defense
 *   4. Clamp each side to ±PLAYER_BOOST_CAP (default ±15)
 *   5. Multiply by PLAYER_BOOST_WEIGHT (0 disables, 1 = full effect)
 *
 * Realistic outputs:
 *   - Fresh elite team (avg starter ~85): all sides at +cap 15
 *   - Mature top team (avg starter ~60-65): mixed ±5 to ±10
 *   - Weak team (avg ~40-50): -10 to -cap
 */

const BASELINE_RATING = 60;

const STARTERS_PER_POSITION: Record<PlayerPosition, number> = {
  GK: 1,
  DF: 4,
  MF: 4,
  FW: 3,
};

const POSITION_SIDE_WEIGHTS: Record<PlayerPosition, { attack: number; midfield: number; defense: number }> = {
  FW: { attack: 1.0, midfield: 0.2, defense: 0   },
  MF: { attack: 0.4, midfield: 0.8, defense: 0.2 },
  DF: { attack: 0,   midfield: 0.2, defense: 1.0 },
  GK: { attack: 0,   midfield: 0,   defense: 0.8 },
};

export interface PlayerBoosts {
  attack: number;
  midfield: number;
  defense: number;
}

export function computePlayerBoosts(
  squad: Player[] | undefined,
  globalWindowIdx: number,
): PlayerBoosts {
  if (!squad || squad.length === 0 || (BALANCE.PLAYER_BOOST_WEIGHT as number) === 0) {
    return { attack: 0, midfield: 0, defense: 0 };
  }
  // Filter out injured / suspended — they don't play, don't contribute.
  const available = squad.filter(p =>
    (p.injuredUntilWindow ?? 0) <= globalWindowIdx
    && (p.suspendedUntilWindow ?? 0) <= globalWindowIdx,
  );

  // Pick top N per position by rating
  const byPos: Record<PlayerPosition, Player[]> = { GK: [], DF: [], MF: [], FW: [] };
  for (const p of available) byPos[p.position].push(p);
  for (const pos of ['GK', 'DF', 'MF', 'FW'] as PlayerPosition[]) {
    byPos[pos].sort((a, b) => b.rating - a.rating);
    byPos[pos] = byPos[pos].slice(0, STARTERS_PER_POSITION[pos]);
  }

  let attack = 0;
  let midfield = 0;
  let defense = 0;
  for (const pos of ['GK', 'DF', 'MF', 'FW'] as PlayerPosition[]) {
    const starters = byPos[pos];
    if (starters.length === 0) continue;
    const avg = starters.reduce((s, p) => s + p.rating, 0) / starters.length;
    const delta = avg - BASELINE_RATING;
    const weights = POSITION_SIDE_WEIGHTS[pos];
    attack   += delta * weights.attack;
    midfield += delta * weights.midfield;
    defense  += delta * weights.defense;
  }

  const cap = BALANCE.PLAYER_BOOST_CAP;
  const wt = BALANCE.PLAYER_BOOST_WEIGHT;
  return {
    attack:   Math.round(Math.max(-cap, Math.min(cap, attack))   * wt),
    midfield: Math.round(Math.max(-cap, Math.min(cap, midfield)) * wt),
    defense:  Math.round(Math.max(-cap, Math.min(cap, defense))  * wt),
  };
}

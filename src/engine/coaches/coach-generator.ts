import { namePools } from '../../edition/preset';
const { COACH_FIRST_NAMES, COACH_SURNAMES } = namePools;
import { CoachBase, CoachStyle } from '../../types/coach';
import { SeededRNG } from '../match/rng';
import { derivePreferredFormation } from './tactics';

/**
 * Format the canonical id for a coach who originated from the candidate
 * pool. The pool stores the player's uuid (e.g. `p-42`) — the resulting
 * coach uses `c-from-player-p-42` so /coach/:id stays distinct from the
 * /player/:uuid route AND it's trivial to detect "this coach used to be
 * a player" by the prefix.
 */
export function formatCandidateCoachId(playerUuid: string): string {
  return `c-from-player-${playerUuid}`;
}

/**
 * Format the canonical id for a freshly-spawned coach. Counter-driven so
 * collisions are impossible across a single save's lifetime.
 */
export function formatFreshCoachId(counter: number): string {
  return `c-fresh-${counter}`;
}

/**
 * Style → buff distribution. Mirrors the loose tier groupings in the
 * seeded coaches config (attacking has high attack + low defense, etc).
 * Buff numbers are rolled fresh each call so two coaches sharing a style
 * still differ in their exact stat lines.
 *
 * The output is a complete CoachBase minus id/name/age/rating/style — the
 * caller fills those in (the candidate-pool path uses a known peakRating;
 * the fresh path rolls its own).
 */
export function deriveCoachBuffsFromStyle(
  style: CoachStyle,
  rng: SeededRNG,
): {
  attackBuff: number;
  defenseBuff: number;
  moraleBuff: number;
  leagueBuff: number;
  cupBuff: number;
  pressureResistance: number;
  riskBias: number;
  stabilityBuff: number;
} {
  // Common defaults.
  let attackBuff = 0;
  let defenseBuff = 0;
  const moraleBuff = rng.nextInt(2, 6);
  let leagueBuff = 0;
  let cupBuff = 0;
  const pressureResistance = rng.nextInt(40, 75);
  let riskBias = 0;
  const stabilityBuff = rng.nextInt(0, 5);

  switch (style) {
    case 'attacking':
      attackBuff = rng.nextInt(3, 6);
      defenseBuff = rng.nextInt(-2, 0);
      riskBias = rng.nextInt(2, 6);
      break;
    case 'defensive':
      defenseBuff = rng.nextInt(3, 6);
      attackBuff = rng.nextInt(-2, 0);
      riskBias = rng.nextInt(-6, -2);
      break;
    case 'balanced':
      attackBuff = rng.nextInt(1, 3);
      defenseBuff = rng.nextInt(1, 3);
      riskBias = rng.nextInt(-1, 1);
      break;
    case 'possession':
      attackBuff = rng.nextInt(1, 3);
      defenseBuff = rng.nextInt(0, 2);
      leagueBuff = rng.nextInt(1, 2);
      riskBias = rng.nextInt(0, 2);
      break;
    case 'counter':
      attackBuff = rng.nextInt(2, 4);
      defenseBuff = rng.nextInt(0, 2);
      cupBuff = rng.nextInt(1, 2);
      riskBias = rng.nextInt(1, 3);
      break;
  }

  return {
    attackBuff,
    defenseBuff,
    moraleBuff,
    leagueBuff,
    cupBuff,
    pressureResistance,
    riskBias,
    stabilityBuff,
  };
}

/** All five tactical styles — exposed for tests / validation. */
const ALL_STYLES: CoachStyle[] = ['attacking', 'defensive', 'balanced', 'possession', 'counter'];

/**
 * Generate a freshly-spawned coach. Used by the replacement engine when
 * the candidate pool is empty (or the 50/50 fresh path was chosen).
 *
 * - Name: random first-name + surname, joined with `·` so it visually
 *   reads as a Western pseudo-name (e.g. `布兰科·卡洛`).
 * - Style: uniform-random across all 5 styles.
 * - Rating: 50-75 (bias towards mid-tier — fresh coaches haven't proved
 *   anything yet; the elite rating tier is reserved for star-player
 *   conversions).
 * - Age: 35-50.
 * - Buffs: derived from style via `deriveCoachBuffsFromStyle`.
 *
 * The id is built from `counter` (caller passes `world.nextCoachIdCounter`
 * and bumps it).
 */
export function generateFreshCoach(
  counter: number,
  rng: SeededRNG,
): { coach: CoachBase; nextCounter: number } {
  const style = ALL_STYLES[rng.nextInt(0, ALL_STYLES.length - 1)];
  const rating = rng.nextInt(50, 75);
  const age = rng.nextInt(35, 50);
  const firstName = rng.pick(COACH_FIRST_NAMES as readonly string[] as string[]);
  const surname = rng.pick(COACH_SURNAMES as readonly string[] as string[]);
  // Surname-first ordering matches the reading flow used elsewhere (e.g.
  // 路易斯·恩里克 in defaultCoaches).
  const name = `${surname}·${firstName}`;
  const buffs = deriveCoachBuffsFromStyle(style, rng);

  const coach: CoachBase = {
    id: formatFreshCoachId(counter),
    name,
    rating,
    style,
    attackBuff: buffs.attackBuff,
    defenseBuff: buffs.defenseBuff,
    moraleBuff: buffs.moraleBuff,
    leagueBuff: buffs.leagueBuff,
    cupBuff: buffs.cupBuff,
    pressureResistance: buffs.pressureResistance,
    riskBias: buffs.riskBias,
    stabilityBuff: buffs.stabilityBuff,
    age,
  };
  coach.preferredFormation = derivePreferredFormation(coach);

  return { coach, nextCounter: counter + 1 };
}

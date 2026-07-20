import { Player, PlayerPosition } from '../../types/player';
import { BALANCE } from '../../config/balance';

/**
 * Player-derived match strength. Team attributes remain the foundation; this
 * is a compact way to make the actual available XI and injuries matter.
 */

const BASELINE_RATING = 60;
// Lower than the minimum generated rating, so losing a player can never make
// a unit stronger. In an emergency-floor XI this is the explicit fitness cost
// of fielding an otherwise unavailable player.
const EMERGENCY_RATING = 30;
const QUALITY_TO_BOOST = 0.45;

const STARTERS_PER_POSITION: Record<PlayerPosition, number> = {
  GK: 1,
  DF: 4,
  MF: 3,
  FW: 3,
};

export interface PlayerBoosts {
  attack: number;
  midfield: number;
  defense: number;
}

export interface PlayerBoostReport {
  current: PlayerBoosts;
  fullStrength: PlayerBoosts;
  absenceLoss: PlayerBoosts;
}

function roundOne(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function positionQuality(players: Player[], position: PlayerPosition): number {
  const slots = STARTERS_PER_POSITION[position];
  const ratings = players
    .filter(player => player.position === position)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, slots)
    .map(player => player.rating);

  while (ratings.length < slots) ratings.push(EMERGENCY_RATING);
  return ratings.reduce((sum, rating) => sum + rating, 0) / slots;
}

function calculateBoosts(players: Player[]): PlayerBoosts {
  const goalkeeper = positionQuality(players, 'GK');
  const defense = positionQuality(players, 'DF');
  const midfield = positionQuality(players, 'MF');
  const attack = positionQuality(players, 'FW');

  // Each unit is a weighted quality average, so adding more players cannot
  // push every elite team into the cap. Adjacent units still influence play.
  const unitQuality = {
    attack: attack * 0.7 + midfield * 0.3,
    midfield: midfield * 0.7 + attack * 0.15 + defense * 0.15,
    defense: defense * 0.65 + goalkeeper * 0.25 + midfield * 0.1,
  };

  const cap = BALANCE.PLAYER_BOOST_CAP;
  const weight = BALANCE.PLAYER_BOOST_WEIGHT;
  const toBoost = (quality: number) => roundOne(
    Math.max(-cap, Math.min(cap, (quality - BASELINE_RATING) * QUALITY_TO_BOOST)) * weight,
  );

  return {
    attack: toBoost(unitQuality.attack),
    midfield: toBoost(unitQuality.midfield),
    defense: toBoost(unitQuality.defense),
  };
}

function isAvailable(player: Player, globalWindowIdx: number): boolean {
  return (player.injuredUntilWindow ?? 0) <= globalWindowIdx
    && (player.suspendedUntilWindow ?? 0) <= globalWindowIdx;
}

export function computePlayerBoosts(
  squad: Player[] | undefined,
  globalWindowIdx: number,
): PlayerBoosts {
  if (!squad || squad.length === 0 || (BALANCE.PLAYER_BOOST_WEIGHT as number) === 0) {
    return { attack: 0, midfield: 0, defense: 0 };
  }
  return calculateBoosts(squad.filter(player => isAvailable(player, globalWindowIdx)));
}

export function computePlayerBoostReport(
  squad: Player[] | undefined,
  globalWindowIdx: number,
): PlayerBoostReport {
  if (!squad || squad.length === 0 || (BALANCE.PLAYER_BOOST_WEIGHT as number) === 0) {
    const zero = { attack: 0, midfield: 0, defense: 0 };
    return { current: zero, fullStrength: zero, absenceLoss: zero };
  }

  const current = calculateBoosts(squad.filter(player => isAvailable(player, globalWindowIdx)));
  const fullStrength = calculateBoosts(squad);
  return {
    current,
    fullStrength,
    absenceLoss: {
      attack: roundOne(Math.max(0, fullStrength.attack - current.attack)),
      midfield: roundOne(Math.max(0, fullStrength.midfield - current.midfield)),
      defense: roundOne(Math.max(0, fullStrength.defense - current.defense)),
    },
  };
}

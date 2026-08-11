import type { CoachFormation } from '../../types/coach';
import type { Player, PlayerPosition } from '../../types/player';
import { computeSelectedPlayerBoosts, type PlayerBoosts } from './player-boosts';

export type PlayerImpactUnit = keyof PlayerBoosts;

export interface PlayerMarginalImpact {
  playerId: string;
  unit: PlayerImpactUnit;
  value: number;
}

const POSITION_UNIT: Record<PlayerPosition, PlayerImpactUnit> = {
  GK: 'defense',
  DF: 'defense',
  MF: 'midfield',
  FW: 'attack',
};

function roundOne(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Explain the value already present in the lineup by replacing each starter
 * with the best legal same-position bench option. The result is descriptive
 * only and must never be added to the match model a second time.
 */
export function computePlayerMarginalImpacts(
  starters: Player[],
  squad: Player[] | undefined,
  formation: CoachFormation,
  unavailablePlayerIds: Set<string> = new Set(),
): PlayerMarginalImpact[] {
  const starterIds = new Set(starters.map(player => player.uuid));
  const baseline = computeSelectedPlayerBoosts(starters, formation);

  return starters.map(starter => {
    const replacement = (squad ?? [])
      .filter(player => player.position === starter.position)
      .filter(player => !starterIds.has(player.uuid))
      .filter(player => !unavailablePlayerIds.has(player.uuid))
      .sort((left, right) => right.rating - left.rating || left.uuid.localeCompare(right.uuid))[0];
    const withoutStarter = starters.filter(player => player.uuid !== starter.uuid);
    const replacementLineup = replacement ? [...withoutStarter, replacement] : withoutStarter;
    const replacementBoost = computeSelectedPlayerBoosts(replacementLineup, formation);
    const unit = POSITION_UNIT[starter.position];
    return {
      playerId: starter.uuid,
      unit,
      value: roundOne(Math.max(0, baseline[unit] - replacementBoost[unit])),
    };
  }).sort((left, right) => right.value - left.value || left.playerId.localeCompare(right.playerId));
}

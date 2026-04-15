import { CoachBase } from '../../types/coach';
import { CompetitionType } from '../../types/match';

export interface CoachMatchEffect {
  attackModifier: number;
  defenseModifier: number;
  moraleModifier: number;
  competitionModifier: number; // league or cup buff
  riskModifier: number;
  stabilityModifier: number;
}

const ZERO_EFFECT: CoachMatchEffect = {
  attackModifier: 0,
  defenseModifier: 0,
  moraleModifier: 0,
  competitionModifier: 0,
  riskModifier: 0,
  stabilityModifier: 0,
};

/** Competition types that count as "cup" for buff purposes. */
const CUP_COMPETITIONS: Set<CompetitionType> = new Set([
  'league_cup',
  'super_cup',
  'super_cup_group',
  'world_cup',
  'world_cup_group',
]);

/**
 * Calculate the total effect a coach has on a match.
 * Different competition types activate different buffs.
 */
export function calculateCoachEffect(
  coach: CoachBase | null,
  competitionType: CompetitionType,
): CoachMatchEffect {
  if (!coach) {
    return { ...ZERO_EFFECT };
  }

  const isCup = CUP_COMPETITIONS.has(competitionType);

  return {
    attackModifier: coach.attackBuff,
    defenseModifier: coach.defenseBuff,
    moraleModifier: coach.moraleBuff,
    competitionModifier: isCup ? coach.cupBuff : coach.leagueBuff,
    riskModifier: coach.riskBias,
    stabilityModifier: coach.stabilityBuff,
  };
}

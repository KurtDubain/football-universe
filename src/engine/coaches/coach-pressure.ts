import { TeamState } from '../../types/team';
import { TeamBase } from '../../types/team';
import { MatchResult } from '../../types/match';
import { BALANCE } from '../../config/balance';

export interface PressureUpdate {
  newPressure: number;
  shouldFire: boolean;
  fireReason: string | null;
}

export function updateCoachPressure(
  currentPressure: number,
  result: MatchResult,
  teamId: string,
  teamBase: TeamBase,
  recentForm: ('W' | 'D' | 'L')[],
  isCupElimination: boolean,
): PressureUpdate {
  const isHome = result.homeTeamId === teamId;
  const goalsFor = isHome ? result.homeGoals : result.awayGoals;
  const goalsAgainst = isHome ? result.awayGoals : result.homeGoals;
  const goalDiff = goalsFor - goalsAgainst;

  let pressureChange = 0;

  if (goalDiff > 0) {
    // Win: pressure drops more for convincing wins
    pressureChange = -BALANCE.WIN_PRESSURE_DECREASE;
    if (goalDiff >= 3) pressureChange -= 2; // big win extra relief
  } else if (goalDiff < 0) {
    pressureChange = BALANCE.LOSS_PRESSURE_INCREASE;
    if (goalDiff <= -3) pressureChange += 2;
  } else {
    // Draw: barely increases for mid/low teams, slightly more for elite
    pressureChange = BALANCE.DRAW_PRESSURE_INCREASE;
  }

  // Cup elimination: moderate pressure, not catastrophic
  if (isCupElimination) {
    pressureChange += 3;
  }

  // Consecutive losses: only compounds at 5+ (was 4+)
  const consecutiveLosses = countConsecutiveLosses(recentForm);
  if (consecutiveLosses >= 5) {
    pressureChange += (consecutiveLosses - 4) * 2;
  }

  // Elite teams multiply pressure increases (but less aggressively)
  if (teamBase.expectation >= 4 && pressureChange > 0) {
    pressureChange = Math.round(pressureChange * BALANCE.ELITE_TEAM_PRESSURE_MULT);
  }

  // Natural pressure decay: pressure slowly decreases even without wins
  let decay = 0;
  if (currentPressure > 40) decay = -1;
  if (currentPressure > 60) decay = -0.5; // high pressure decays slower

  const newPressure = clampPressure(currentPressure + pressureChange + decay);

  const fireCheck = shouldFireCoach(newPressure, teamBase, recentForm, 1);
  return {
    newPressure,
    shouldFire: fireCheck.fire,
    fireReason: fireCheck.fire ? fireCheck.reason : null,
  };
}

export function shouldFireCoach(
  pressure: number,
  teamBase: TeamBase,
  recentForm: ('W' | 'D' | 'L')[],
  seasonProgress: number,
): { fire: boolean; reason: string } {
  // Extended grace period: first 20% of season (was 10%)
  if (seasonProgress < 0.2) {
    return { fire: false, reason: '' };
  }

  // 6+ consecutive losses triggers immediate firing (was 5)
  const consecutiveLosses = countConsecutiveLosses(recentForm);
  if (consecutiveLosses >= 6) {
    return {
      fire: true,
      reason: `${consecutiveLosses}连败后被解雇`,
    };
  }

  // Firing thresholds raised significantly
  const threshold = teamBase.expectation >= 5
    ? 75    // was 65
    : BALANCE.FIRING_THRESHOLD; // 80

  if (pressure >= threshold) {
    return {
      fire: true,
      reason: `执教压力过大 (${pressure}/${threshold})`,
    };
  }

  return { fire: false, reason: '' };
}

function countConsecutiveLosses(form: ('W' | 'D' | 'L')[]): number {
  let count = 0;
  for (let i = form.length - 1; i >= 0; i--) {
    if (form[i] === 'L') count++;
    else break;
  }
  return count;
}

function clampPressure(value: number): number {
  return Math.max(0, Math.min(100, value));
}

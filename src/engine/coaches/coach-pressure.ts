import { TeamState } from '../../types/team';
import { TeamBase } from '../../types/team';
import { MatchResult } from '../../types/match';
import { BALANCE } from '../../config/balance';

export interface PressureUpdate {
  newPressure: number;
  shouldFire: boolean;
  fireReason: string | null;
}

/**
 * Update coach pressure after a match result.
 * Factors:
 * - Win decreases pressure
 * - Loss increases pressure
 * - Draw slightly increases pressure
 * - Big loss (3+ goal difference) increases more
 * - Elite teams (expectation >= 4) multiply pressure increases
 * - Cup elimination adds extra pressure
 * - Consecutive losses compound pressure
 */
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

  // Base change by result
  if (goalDiff > 0) {
    // Win
    pressureChange = -BALANCE.WIN_PRESSURE_DECREASE;
  } else if (goalDiff < 0) {
    // Loss
    pressureChange = BALANCE.LOSS_PRESSURE_INCREASE;

    // Big loss bonus (3+ goal difference)
    if (goalDiff <= -3) {
      pressureChange += 5;
    }
  } else {
    // Draw
    pressureChange = BALANCE.DRAW_PRESSURE_INCREASE;
  }

  // Cup elimination adds extra pressure
  if (isCupElimination) {
    pressureChange += 6;
  }

  // Consecutive losses compound pressure
  const consecutiveLosses = countConsecutiveLosses(recentForm);
  if (consecutiveLosses >= 3) {
    pressureChange += (consecutiveLosses - 2) * 3;
  }

  // Elite teams (expectation >= 4) multiply pressure increases
  if (teamBase.expectation >= 4 && pressureChange > 0) {
    pressureChange = Math.round(pressureChange * BALANCE.ELITE_TEAM_PRESSURE_MULT);
  }

  const newPressure = clampPressure(currentPressure + pressureChange);

  // Check firing conditions inline
  const fireCheck = shouldFireCoach(newPressure, teamBase, recentForm, 1); // assume not in grace period for post-match check
  return {
    newPressure,
    shouldFire: fireCheck.fire,
    fireReason: fireCheck.fire ? fireCheck.reason : null,
  };
}

/**
 * Check if a coach should be fired based on accumulated pressure and context.
 */
export function shouldFireCoach(
  pressure: number,
  teamBase: TeamBase,
  recentForm: ('W' | 'D' | 'L')[],
  seasonProgress: number, // 0-1, how far into the season
): { fire: boolean; reason: string } {
  // Grace period: can't fire in first portion of season (~3 windows)
  // With typical ~30 windows per season, 3/30 = 0.1
  if (seasonProgress < 0.1) {
    return { fire: false, reason: '' };
  }

  // 5+ consecutive losses triggers immediate firing regardless of pressure
  const consecutiveLosses = countConsecutiveLosses(recentForm);
  if (consecutiveLosses >= 5) {
    return {
      fire: true,
      reason: `Fired after ${consecutiveLosses} consecutive losses`,
    };
  }

  // Top teams (expectation 5) fire at lower threshold
  const threshold = teamBase.expectation >= 5
    ? 65
    : BALANCE.FIRING_THRESHOLD;

  if (pressure >= threshold) {
    return {
      fire: true,
      reason: `Pressure too high (${pressure}/${threshold})`,
    };
  }

  return { fire: false, reason: '' };
}

/** Count how many consecutive losses from the end of recentForm. */
function countConsecutiveLosses(form: ('W' | 'D' | 'L')[]): number {
  let count = 0;
  for (let i = form.length - 1; i >= 0; i--) {
    if (form[i] === 'L') {
      count++;
    } else {
      break;
    }
  }
  return count;
}

function clampPressure(value: number): number {
  return Math.max(0, Math.min(100, value));
}

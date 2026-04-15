import { TeamState } from '../types/team';
import { TeamBase } from '../types/team';
import { MatchResult } from '../types/match';
import { BALANCE } from '../config/balance';

/**
 * Apply post-match state changes to a team.
 * Updates morale, fatigue, momentum, squadHealth, recentForm.
 */
export function applyMatchStateChanges(
  currentState: TeamState,
  teamBase: TeamBase,
  result: MatchResult,
  isHome: boolean,
): TeamState {
  const goalsFor = isHome ? result.homeGoals : result.awayGoals;
  const goalsAgainst = isHome ? result.awayGoals : result.homeGoals;
  const goalDiff = goalsFor - goalsAgainst;

  // Determine result type
  const isWin = goalDiff > 0;
  const isLoss = goalDiff < 0;
  const isBigWin = goalDiff >= 3;
  const isBigLoss = goalDiff <= -3;

  // --- Morale ---
  let morale = currentState.morale;
  if (isWin) {
    morale += BALANCE.WIN_MORALE_BOOST;
    if (isBigWin) morale += 3; // extra boost for big wins
  } else if (isLoss) {
    morale -= BALANCE.LOSS_MORALE_DROP;
    if (isBigLoss) morale -= 4; // extra drop for big losses
  } else {
    morale += BALANCE.DRAW_MORALE;
  }
  morale = clamp(morale, 0, 100);

  // --- Fatigue ---
  let fatigue = currentState.fatigue + BALANCE.MATCH_FATIGUE;
  // Low-depth squads fatigue slightly faster
  if (teamBase.depth < 50) {
    fatigue += 2;
  }
  fatigue = clamp(fatigue, 0, 100);

  // --- Momentum ---
  let momentum = currentState.momentum;
  if (isBigWin) {
    momentum += BALANCE.BIG_WIN_MOMENTUM;
  } else if (isBigLoss) {
    momentum += BALANCE.BIG_LOSS_MOMENTUM; // negative value
  } else if (isWin) {
    momentum += 1;
  } else if (isLoss) {
    momentum -= 1;
  }
  // Draw doesn't shift momentum
  momentum = clamp(momentum, -10, 10);

  // --- Squad Health ---
  let squadHealth = currentState.squadHealth - 2; // standard wear
  // Random-ish injury chance based on fatigue level
  // Higher fatigue = more likely to lose extra health
  if (fatigue > 70) {
    squadHealth -= 5; // injury risk when very fatigued
  } else if (fatigue > 50) {
    squadHealth -= 2; // minor risk
  }
  squadHealth = clamp(squadHealth, 0, 100);

  // --- Recent Form ---
  const formEntry: 'W' | 'D' | 'L' = isWin ? 'W' : isLoss ? 'L' : 'D';
  const recentForm = [...currentState.recentForm, formEntry].slice(-5);

  return {
    ...currentState,
    morale,
    fatigue,
    momentum,
    squadHealth,
    recentForm,
  };
}

/**
 * Apply recovery for teams that didn't play in a window.
 * Fatigue decreases, squadHealth slightly recovers.
 */
export function applyRestRecovery(state: TeamState): TeamState {
  return {
    ...state,
    fatigue: clamp(state.fatigue - BALANCE.FATIGUE_RECOVERY, 0, 100),
    squadHealth: clamp(state.squadHealth + 3, 0, 100),
  };
}

/**
 * Apply season-end reset.
 * Reset morale to 60, fatigue to 10, momentum to 0, etc.
 * But keep some momentum if team had a great/terrible season.
 */
export function applySeasonEndReset(
  state: TeamState,
  finalPosition: number,
  leagueSize: number,
): TeamState {
  // Carry over some momentum based on final position
  const positionRatio = finalPosition / leagueSize; // 0 = champion, 1 = last
  let carryMomentum = 0;
  if (positionRatio <= 0.15) {
    carryMomentum = 3; // top finishers carry positive vibes
  } else if (positionRatio <= 0.3) {
    carryMomentum = 1;
  } else if (positionRatio >= 0.85) {
    carryMomentum = -3; // bottom finishers carry negativity
  } else if (positionRatio >= 0.7) {
    carryMomentum = -1;
  }

  return {
    ...state,
    morale: 60,
    fatigue: 10,
    momentum: clamp(carryMomentum, -10, 10),
    squadHealth: 85,
    recentForm: [],
  };
}

/**
 * Clamp a value between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

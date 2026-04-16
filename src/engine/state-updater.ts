import { TeamState } from '../types/team';
import { TeamBase } from '../types/team';
import { MatchResult } from '../types/match';
import { BALANCE } from '../config/balance';

/**
 * Apply post-match state changes to a team.
 */
export function applyMatchStateChanges(
  currentState: TeamState,
  teamBase: TeamBase,
  result: MatchResult,
  isHome: boolean,
): TeamState {
  const goalsFor = isHome
    ? result.homeGoals + (result.etHomeGoals ?? 0)
    : result.awayGoals + (result.etAwayGoals ?? 0);
  const goalsAgainst = isHome
    ? result.awayGoals + (result.etAwayGoals ?? 0)
    : result.homeGoals + (result.etHomeGoals ?? 0);
  const goalDiff = goalsFor - goalsAgainst;

  const isWin = goalDiff > 0;
  const isLoss = goalDiff < 0;
  const isBigWin = goalDiff >= 3;
  const isBigLoss = goalDiff <= -3;

  // --- Morale ---
  let morale = currentState.morale;
  if (isWin) {
    morale += BALANCE.WIN_MORALE_BOOST;
    if (isBigWin) morale += 2;
  } else if (isLoss) {
    morale -= BALANCE.LOSS_MORALE_DROP;
    if (isBigLoss) morale -= 2;
  } else {
    morale += BALANCE.DRAW_MORALE;
  }
  // Morale naturally drifts toward 65 (equilibrium)
  if (morale > 75) morale -= 1;
  if (morale < 45) morale += 1;
  morale = clamp(morale, 15, 100);

  // --- Fatigue ---
  let fatigue = currentState.fatigue + BALANCE.MATCH_FATIGUE;
  // Low-depth squads fatigue slightly faster
  if (teamBase.depth < 50) {
    fatigue += 1;
  }
  fatigue = clamp(fatigue, 0, 85); // cap at 85, not 100

  // --- Momentum ---
  let momentum = currentState.momentum;
  if (isBigWin) {
    momentum += BALANCE.BIG_WIN_MOMENTUM;
  } else if (isBigLoss) {
    momentum += BALANCE.BIG_LOSS_MOMENTUM;
  } else if (isWin) {
    momentum += 1;
  } else if (isLoss) {
    momentum -= 1;
  }
  // Momentum decays naturally toward 0
  if (momentum > 3) momentum -= 0.5;
  if (momentum < -3) momentum += 0.5;
  momentum = clamp(Math.round(momentum * 10) / 10, -10, 10);

  // --- Squad Health ---
  let squadHealth = currentState.squadHealth - 1; // light wear per match
  // Injury risk only at extreme fatigue
  if (fatigue > 70) {
    squadHealth -= 2;
  }
  squadHealth = clamp(squadHealth, 30, 100); // floor at 30

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
 */
export function applyRestRecovery(state: TeamState): TeamState {
  return {
    ...state,
    fatigue: clamp(state.fatigue - BALANCE.FATIGUE_RECOVERY, 0, 100),
    squadHealth: clamp(state.squadHealth + 4, 0, 100),
    // Morale drifts toward 65 during rest
    morale: clamp(state.morale + (state.morale < 65 ? 2 : 0), 0, 100),
  };
}

/**
 * Apply season-end reset.
 */
export function applySeasonEndReset(
  state: TeamState,
  finalPosition: number,
  leagueSize: number,
): TeamState {
  const positionRatio = finalPosition / leagueSize;
  let carryMomentum = 0;
  if (positionRatio <= 0.15) {
    carryMomentum = 3;
  } else if (positionRatio <= 0.3) {
    carryMomentum = 1;
  } else if (positionRatio >= 0.85) {
    carryMomentum = -2;
  } else if (positionRatio >= 0.7) {
    carryMomentum = -1;
  }

  return {
    ...state,
    morale: 70,
    fatigue: 5,
    momentum: clamp(carryMomentum, -10, 10),
    squadHealth: 92,
    coachPressure: clamp(state.coachPressure * 0.3, 0, 30), // carry 30% of pressure
    recentForm: [],
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

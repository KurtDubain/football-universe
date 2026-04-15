import { TeamBase, TeamState } from '../../types/team';
import { CoachBase } from '../../types/coach';
import { BALANCE } from '../../config/balance';

export interface MatchPrediction {
  homeTeamId: string;
  awayTeamId: string;
  homeStrength: number;
  awayStrength: number;
  homeWinPct: number;
  drawPct: number;
  awayWinPct: number;
  predictedHomeGoals: number;
  predictedAwayGoals: number;
  verdict: string;
  hotTip: string | null;
}

/**
 * Generate a pre-match prediction based on team attributes, state, and coach.
 */
export function predictMatch(
  homeTeam: TeamBase,
  awayTeam: TeamBase,
  homeState: TeamState,
  awayState: TeamState,
  homeCoach: CoachBase | null,
  awayCoach: CoachBase | null,
): MatchPrediction {
  // Calculate adjusted overall strength
  const homeAdj = calcAdjustedStrength(homeTeam, homeState, homeCoach, true);
  const awayAdj = calcAdjustedStrength(awayTeam, awayState, awayCoach, false);

  const total = homeAdj + awayAdj;
  const homeRatio = homeAdj / total;

  // Win probabilities (simplified model)
  const rawHomeWin = homeRatio * 0.75 + 0.1; // home advantage bias
  const rawAwayWin = (1 - homeRatio) * 0.7;
  const rawDraw = 1 - rawHomeWin - rawAwayWin;

  // Normalize
  const sum = rawHomeWin + rawDraw + rawAwayWin;
  const homeWinPct = Math.round((rawHomeWin / sum) * 100);
  const awayWinPct = Math.round((rawAwayWin / sum) * 100);
  const drawPct = 100 - homeWinPct - awayWinPct;

  // Expected goals
  const homeExpGoals = BALANCE.BASE_GOAL_RATE * (homeAdj / awayAdj) * 0.95;
  const awayExpGoals = BALANCE.BASE_GOAL_RATE * (awayAdj / homeAdj) * 0.85;
  const predictedHomeGoals = Math.round(Math.max(0.3, Math.min(4.0, homeExpGoals)) * 10) / 10;
  const predictedAwayGoals = Math.round(Math.max(0.2, Math.min(3.5, awayExpGoals)) * 10) / 10;

  // Verdict text
  let verdict: string;
  if (homeWinPct >= awayWinPct + 20) {
    verdict = `${homeTeam.name} 大概率获胜`;
  } else if (awayWinPct >= homeWinPct + 20) {
    verdict = `${awayTeam.name} 大概率获胜`;
  } else if (homeWinPct >= awayWinPct + 8) {
    verdict = `${homeTeam.name} 稍占优势`;
  } else if (awayWinPct >= homeWinPct + 8) {
    verdict = `${awayTeam.name} 稍占优势`;
  } else {
    verdict = '势均力敌，胜负难料';
  }

  // Hot tips
  let hotTip: string | null = null;
  const overallDiff = Math.abs(homeTeam.overall - awayTeam.overall);

  if (homeState.momentum >= 5) {
    hotTip = `${homeTeam.name} 近期势头正猛 (势头+${homeState.momentum})`;
  } else if (awayState.momentum >= 5) {
    hotTip = `${awayTeam.name} 近期势头正猛 (势头+${awayState.momentum})`;
  } else if (homeState.fatigue > 55) {
    hotTip = `${homeTeam.name} 体能堪忧 (疲劳${homeState.fatigue})，可能爆冷`;
  } else if (awayState.fatigue > 55) {
    hotTip = `${awayTeam.name} 体能堪忧 (疲劳${awayState.fatigue})，可能爆冷`;
  } else if (overallDiff >= 15 && homeTeam.overall < awayTeam.overall) {
    hotTip = `以弱敌强！${homeTeam.name} 需要奇迹`;
  } else if (homeState.morale < 45) {
    hotTip = `${homeTeam.name} 士气低迷 (${homeState.morale})`;
  } else if (awayState.morale < 45) {
    hotTip = `${awayTeam.name} 士气低迷 (${awayState.morale})`;
  } else if (homeState.coachPressure > 55) {
    hotTip = `${homeTeam.name} 教练压力巨大 (${homeState.coachPressure})，这是一场生死战`;
  }

  return {
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam.id,
    homeStrength: Math.round(homeAdj),
    awayStrength: Math.round(awayAdj),
    homeWinPct,
    drawPct,
    awayWinPct,
    predictedHomeGoals,
    predictedAwayGoals,
    verdict,
    hotTip,
  };
}

function calcAdjustedStrength(
  team: TeamBase,
  state: TeamState,
  coach: CoachBase | null,
  isHome: boolean,
): number {
  let strength = team.overall;

  // Home advantage
  if (isHome) strength += 4;

  // Morale effect
  strength += (state.morale - 60) * 0.08;

  // Fatigue penalty (reduced weight)
  strength -= state.fatigue * 0.04;

  // Momentum
  strength += state.momentum * 0.4;

  // Squad health
  strength += (state.squadHealth - 80) * 0.03;

  // Coach effect
  if (coach) {
    strength += coach.rating * 0.05;
    strength += (coach.attackBuff + coach.defenseBuff) * 0.1;
  }

  return Math.max(30, strength);
}

import type { CoachBase } from '../../types/coach';
import type { MatchFixture } from '../../types/match';
import type { Player } from '../../types/player';
import type { TeamBase, TeamState } from '../../types/team';
import { calculateMatchModel, computeMatchdayPlayerBoosts, forecastFromModel } from './model';

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

export interface MatchPredictionOptions {
  fixture?: Pick<MatchFixture, 'homeTeamId' | 'awayTeamId' | 'competitionType' | 'isNeutralVenue'>;
  homeSquad?: Player[];
  awaySquad?: Player[];
  globalWindowIdx?: number;
}

export interface MatchOdds {
  home: number;
  draw: number;
  away: number;
}

export function calculateMarketOdds(prediction: MatchPrediction, margin = 0.08): MatchOdds {
  const price = (percentage: number) => Math.max(
    1.05,
    +(1 / Math.max(0.01, percentage / 100 * (1 + margin))).toFixed(2),
  );
  return {
    home: price(prediction.homeWinPct),
    draw: price(prediction.drawPct),
    away: price(prediction.awayWinPct),
  };
}

/** Generate the public forecast from the same deterministic model used by simulation. */
export function predictMatch(
  homeTeam: TeamBase,
  awayTeam: TeamBase,
  homeState: TeamState,
  awayState: TeamState,
  homeCoach: CoachBase | null,
  awayCoach: CoachBase | null,
  options: MatchPredictionOptions = {},
): MatchPrediction {
  const globalWindowIdx = options.globalWindowIdx ?? 0;
  const fixture = options.fixture ?? {
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam.id,
    competitionType: 'league' as const,
  };
  const model = calculateMatchModel({
    homeTeam,
    awayTeam,
    homeState,
    awayState,
    homeCoach,
    awayCoach,
    fixture,
    homeBoosts: computeMatchdayPlayerBoosts(options.homeSquad, globalWindowIdx),
    awayBoosts: computeMatchdayPlayerBoosts(options.awaySquad, globalWindowIdx),
  });
  const forecast = forecastFromModel(model);
  const homeStrength = Math.round((model.home.attack + model.home.midfield + model.home.defense) / 3);
  const awayStrength = Math.round((model.away.attack + model.away.midfield + model.away.defense) / 3);

  let verdict: string;
  if (forecast.homeWinPct >= forecast.awayWinPct + 20) verdict = `${homeTeam.name} 大概率获胜`;
  else if (forecast.awayWinPct >= forecast.homeWinPct + 20) verdict = `${awayTeam.name} 大概率获胜`;
  else if (forecast.homeWinPct >= forecast.awayWinPct + 8) verdict = `${homeTeam.name} 稍占优势`;
  else if (forecast.awayWinPct >= forecast.homeWinPct + 8) verdict = `${awayTeam.name} 稍占优势`;
  else verdict = '势均力敌，胜负难料';

  let hotTip: string | null = null;
  const overallDiff = Math.abs(homeTeam.overall - awayTeam.overall);
  if (homeState.momentum >= 5) hotTip = `${homeTeam.name} 近期势头正猛 (势头+${homeState.momentum})`;
  else if (awayState.momentum >= 5) hotTip = `${awayTeam.name} 近期势头正猛 (势头+${awayState.momentum})`;
  else if (homeState.fatigue > 55) hotTip = `${homeTeam.name} 体能堪忧 (疲劳${homeState.fatigue})，可能爆冷`;
  else if (awayState.fatigue > 55) hotTip = `${awayTeam.name} 体能堪忧 (疲劳${awayState.fatigue})，可能爆冷`;
  else if (overallDiff >= 15 && homeTeam.overall < awayTeam.overall) hotTip = `以弱敌强！${homeTeam.name} 需要奇迹`;
  else if (homeState.morale < 45) hotTip = `${homeTeam.name} 士气低迷 (${homeState.morale})`;
  else if (awayState.morale < 45) hotTip = `${awayTeam.name} 士气低迷 (${awayState.morale})`;
  else if (homeState.coachPressure > 55) hotTip = `${homeTeam.name} 教练压力巨大 (${homeState.coachPressure})，这是一场生死战`;

  return {
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam.id,
    homeStrength,
    awayStrength,
    homeWinPct: forecast.homeWinPct,
    drawPct: forecast.drawPct,
    awayWinPct: forecast.awayWinPct,
    predictedHomeGoals: Math.round(forecast.homeExpectedGoals * 10) / 10,
    predictedAwayGoals: Math.round(forecast.awayExpectedGoals * 10) / 10,
    verdict,
    hotTip,
  };
}

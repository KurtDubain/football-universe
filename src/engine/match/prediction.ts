import type { CoachBase, MatchTacticsSnapshot } from '../../types/coach';
import type { FeaturedPlayerSnapshot, MatchFixture } from '../../types/match';
import type { Player, PlayerSeasonStats, PlayerTeamSeasonStats } from '../../types/player';
import type { TeamBase, TeamState } from '../../types/team';
import type { MatchFactor } from '../../types/match';
import { calculateMatchModel, computeMatchdayModelReport, forecastFromModel } from './model';
import { deriveMatchTacticsPair } from '../coaches/tactics';
import { selectMatchday } from '../players/injuries';
import { buildMatchFeaturedLineups } from '../players/star-presence';

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
  factors: MatchFactor[];
  homeTactics: MatchTacticsSnapshot;
  awayTactics: MatchTacticsSnapshot;
  featuredPlayers: FeaturedPlayerSnapshot[];
}

export interface MatchPredictionOptions {
  fixture?: Pick<MatchFixture, 'homeTeamId' | 'awayTeamId' | 'competitionType' | 'isNeutralVenue' | 'tournamentHostTeamId'>
    & Partial<Pick<MatchFixture, 'id' | 'roundLabel' | 'leg'>>;
  homeSquad?: Player[];
  awaySquad?: Player[];
  globalWindowIdx?: number;
  playerStats?: Record<string, PlayerSeasonStats>;
  playerStatSegments?: Record<string, PlayerTeamSeasonStats>;
  seasonStartLevels?: Record<string, 1 | 2 | 3>;
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
  const tactics = deriveMatchTacticsPair(
    {
      coach: homeCoach,
      team: homeTeam,
      opponent: awayTeam,
      state: homeState,
      opponentState: awayState,
      fixture,
      squad: options.homeSquad,
      globalWindowIdx,
    },
    {
      coach: awayCoach,
      team: awayTeam,
      opponent: homeTeam,
      state: awayState,
      opponentState: homeState,
      fixture,
      squad: options.awaySquad,
      globalWindowIdx,
    },
  );
  const homeReport = computeMatchdayModelReport(options.homeSquad, globalWindowIdx, tactics.home.formation);
  const awayReport = computeMatchdayModelReport(options.awaySquad, globalWindowIdx, tactics.away.formation);
  const homeSelection = selectMatchday(options.homeSquad, globalWindowIdx, tactics.home.formation);
  const awaySelection = selectMatchday(options.awaySquad, globalWindowIdx, tactics.away.formation);
  const { featuredPlayers } = buildMatchFeaturedLineups({
    homeSquad: options.homeSquad,
    awaySquad: options.awaySquad,
    homeSelection,
    awaySelection,
    homeFormation: tactics.home.formation,
    awayFormation: tactics.away.formation,
    playerStats: options.playerStats ?? {},
    playerStatSegments: options.playerStatSegments,
    seasonStartLevels: options.seasonStartLevels,
  });
  const model = calculateMatchModel({
    homeTeam,
    awayTeam,
    homeState,
    awayState,
    homeCoach,
    awayCoach,
    fixture,
    homeBoosts: homeReport.boosts,
    awayBoosts: awayReport.boosts,
    homeAbsenceLoss: homeReport.absenceLoss,
    awayAbsenceLoss: awayReport.absenceLoss,
    homeTactics: tactics.home,
    awayTactics: tactics.away,
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
    factors: forecast.factors,
    homeTactics: tactics.home,
    awayTactics: tactics.away,
    featuredPlayers,
  };
}

import { BALANCE } from '../../config/balance';
import { getDerbyBoost, isDerby } from '../../config/derbies';
import type { CoachBase } from '../../types/coach';
import type { CompetitionType, MatchFixture } from '../../types/match';
import type { Player } from '../../types/player';
import type { TeamBase, TeamState } from '../../types/team';
import { selectMatchday } from '../players/injuries';
import { computePlayerBoosts, type PlayerBoosts } from '../players/player-boosts';
import { selectStartingEleven } from './participation';
import { poissonProbability } from './poisson';

export interface AdjustedStrengths {
  attack: number;
  midfield: number;
  defense: number;
}

export interface MatchModelInput {
  homeTeam: TeamBase;
  awayTeam: TeamBase;
  homeState: TeamState;
  awayState: TeamState;
  homeCoach: CoachBase | null;
  awayCoach: CoachBase | null;
  fixture: Pick<MatchFixture, 'homeTeamId' | 'awayTeamId' | 'competitionType' | 'isNeutralVenue'>;
  homeBoosts?: PlayerBoosts;
  awayBoosts?: PlayerBoosts;
}

export interface MatchModel {
  home: AdjustedStrengths;
  away: AdjustedStrengths;
  midfieldDominance: number;
  homeExpectedGoals: number;
  awayExpectedGoals: number;
}

export interface MatchForecastSnapshot {
  homeWinPct: number;
  drawPct: number;
  awayWinPct: number;
  homeExpectedGoals: number;
  awayExpectedGoals: number;
}

export function computeMatchdayPlayerBoosts(
  squad: Player[] | undefined,
  globalWindowIdx: number,
): PlayerBoosts {
  const selection = selectMatchday(squad, globalWindowIdx);
  const starters = selection ? selectStartingEleven(selection.players) : undefined;
  return computePlayerBoosts(starters, globalWindowIdx);
}

export function outcomeProbabilities(
  homeExpectedGoals: number,
  awayExpectedGoals: number,
): Pick<MatchForecastSnapshot, 'homeWinPct' | 'drawPct' | 'awayWinPct'> {
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let homeGoals = 0; homeGoals <= 12; homeGoals++) {
    const homeProbability = poissonProbability(homeGoals, homeExpectedGoals);
    for (let awayGoals = 0; awayGoals <= 12; awayGoals++) {
      const probability = homeProbability * poissonProbability(awayGoals, awayExpectedGoals);
      if (homeGoals > awayGoals) home += probability;
      else if (homeGoals < awayGoals) away += probability;
      else draw += probability;
    }
  }

  const total = home + draw + away;
  const homeWinPct = Math.round((home / total) * 100);
  const awayWinPct = Math.round((away / total) * 100);
  return { homeWinPct, drawPct: 100 - homeWinPct - awayWinPct, awayWinPct };
}

export function forecastFromModel(model: MatchModel): MatchForecastSnapshot {
  return {
    ...outcomeProbabilities(model.homeExpectedGoals, model.awayExpectedGoals),
    homeExpectedGoals: model.homeExpectedGoals,
    awayExpectedGoals: model.awayExpectedGoals,
  };
}

function adjustedStrengths(
  team: TeamBase,
  state: TeamState,
  coach: CoachBase | null,
  isHome: boolean,
  playerBoosts?: PlayerBoosts,
): AdjustedStrengths {
  const homeBonus = isHome ? BALANCE.HOME_ADVANTAGE * 100 : 0;
  const homeSmallBonus = isHome ? 3 : 0;
  const coachAttackBuff = coach ? coach.attackBuff * BALANCE.COACH_BUFF_WEIGHT : 0;
  const coachDefenseBuff = coach ? coach.defenseBuff * BALANCE.COACH_BUFF_WEIGHT : 0;

  return {
    attack: Math.max(
      20,
      team.attack
        + coachAttackBuff
        + (playerBoosts?.attack ?? 0)
        + homeBonus
        + state.momentum * 1.5
        - state.fatigue * 0.15
        + (state.morale - 60) * 0.12,
    ),
    midfield: Math.max(
      20,
      team.midfield
        + (playerBoosts?.midfield ?? 0)
        + homeSmallBonus
        + state.momentum
        - state.fatigue * 0.08,
    ),
    defense: Math.max(
      20,
      team.defense
        + coachDefenseBuff
        + (playerBoosts?.defense ?? 0)
        + homeSmallBonus
        - state.fatigue * 0.1
        + team.stability * 0.1,
    ),
  };
}

function isCup(type: CompetitionType): boolean {
  return type === 'league_cup'
    || type === 'super_cup'
    || type === 'world_cup'
    || type === 'continental_cup';
}

export function expectedGoals(
  attackStrength: number,
  defenseStrength: number,
  midfieldDominance: number,
  coach: CoachBase | null,
  competitionType: CompetitionType,
  noiseMultiplier = 1,
): number {
  const effectiveAttack = attackStrength * (0.6 + midfieldDominance * 0.4);
  const effectiveDefense = defenseStrength * (0.8 + (1 - midfieldDominance) * 0.2);
  let goals = BALANCE.BASE_GOAL_RATE * (effectiveAttack / effectiveDefense);

  // Keep modifier order aligned with the simulator's established seeded path.
  goals *= noiseMultiplier;
  if (coach) {
    goals *= 1 + (isCup(competitionType) ? coach.cupBuff : coach.leagueBuff) * 0.01;
  }
  return Math.max(0.2, Math.min(5, goals));
}

export function calculateMatchModel(input: MatchModelInput): MatchModel {
  const {
    homeTeam, awayTeam, homeState, awayState, homeCoach, awayCoach,
    fixture, homeBoosts, awayBoosts,
  } = input;
  const neutral = !!fixture.isNeutralVenue;
  const home = adjustedStrengths(homeTeam, homeState, homeCoach, !neutral, homeBoosts);
  const away = adjustedStrengths(awayTeam, awayState, awayCoach, false, awayBoosts);

  const overallGap = Math.abs(homeTeam.overall - awayTeam.overall);
  if (overallGap > 8) {
    const boost = BALANCE.UNDERDOG_BOOST * overallGap;
    const underdog = homeTeam.overall < awayTeam.overall ? home : away;
    underdog.attack += boost;
    underdog.midfield += boost * 0.5;
  }

  const derbyBases = { [homeTeam.id]: homeTeam, [awayTeam.id]: awayTeam } as Record<string, TeamBase>;
  if (isDerby(homeTeam.id, awayTeam.id, derbyBases)) {
    const derbyBoost = getDerbyBoost(homeTeam.id, awayTeam.id, derbyBases);
    home.attack += derbyBoost;
    away.attack += derbyBoost;
  }

  const midfieldDominance = home.midfield / (home.midfield + away.midfield);
  return {
    home,
    away,
    midfieldDominance,
    homeExpectedGoals: expectedGoals(
      home.attack, away.defense, midfieldDominance, homeCoach, fixture.competitionType,
    ),
    awayExpectedGoals: expectedGoals(
      away.attack, home.defense, 1 - midfieldDominance, awayCoach, fixture.competitionType,
    ),
  };
}

export function competitionRandomness(type: CompetitionType): number {
  return isCup(type) ? BALANCE.CUP_RANDOMNESS : BALANCE.LEAGUE_RANDOMNESS;
}

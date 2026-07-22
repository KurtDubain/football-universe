import { BALANCE } from '../../config/balance';
import { getDerbyBoost, isDerby } from '../../config/derbies';
import type { CoachBase } from '../../types/coach';
import type { CompetitionType, MatchFactor, MatchFixture } from '../../types/match';
import type { Player } from '../../types/player';
import type { TeamBase, TeamState } from '../../types/team';
import { selectMatchday } from '../players/injuries';
import { computePlayerBoostReport, computePlayerBoosts, type PlayerBoosts } from '../players/player-boosts';
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
  homeAbsenceLoss?: PlayerBoosts;
  awayAbsenceLoss?: PlayerBoosts;
}

export interface MatchModel {
  home: AdjustedStrengths;
  away: AdjustedStrengths;
  midfieldDominance: number;
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  factors: MatchFactor[];
}

export interface MatchForecastSnapshot {
  homeWinPct: number;
  drawPct: number;
  awayWinPct: number;
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  factors: MatchFactor[];
}

export interface MatchdayModelReport {
  boosts: PlayerBoosts;
  absenceLoss: PlayerBoosts;
}

export function computeMatchdayPlayerBoosts(
  squad: Player[] | undefined,
  globalWindowIdx: number,
): PlayerBoosts {
  const selection = selectMatchday(squad, globalWindowIdx);
  const starters = selection
    ? selectStartingEleven(selection.players, selection.unavailablePlayerIds)
    : undefined;
  return computePlayerBoosts(starters, globalWindowIdx);
}

export function computeMatchdayModelReport(
  squad: Player[] | undefined,
  globalWindowIdx: number,
): MatchdayModelReport {
  return {
    boosts: computeMatchdayPlayerBoosts(squad, globalWindowIdx),
    absenceLoss: computePlayerBoostReport(squad, globalWindowIdx).absenceLoss,
  };
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
    factors: model.factors,
  };
}

interface RankedMatchFactor extends MatchFactor {
  category: 'strength' | 'availability' | 'condition' | 'context' | 'coach';
  rank: number;
}

function averageBoost(boosts: PlayerBoosts | undefined): number {
  if (!boosts) return 0;
  return (boosts.attack + boosts.midfield + boosts.defense) / 3;
}

function factorImportance(rank: number): 1 | 2 | 3 {
  if (rank >= 8) return 3;
  if (rank >= 4) return 2;
  return 1;
}

function buildMatchFactors(input: MatchModelInput): MatchFactor[] {
  const {
    homeTeam, awayTeam, homeState, awayState, homeCoach, awayCoach, fixture,
    homeBoosts, awayBoosts, homeAbsenceLoss, awayAbsenceLoss,
  } = input;
  const candidates: RankedMatchFactor[] = [];
  const addComparison = (
    source: MatchFactor['source'],
    category: RankedMatchFactor['category'],
    homeValue: number,
    awayValue: number,
    threshold: number,
    rankScale: number,
    label: (side: 'home' | 'away') => string,
    detail: (side: 'home' | 'away', gap: number) => string,
  ) => {
    const gap = Math.abs(homeValue - awayValue);
    if (gap < threshold) return;
    const side = homeValue > awayValue ? 'home' : 'away';
    const rank = gap * rankScale;
    candidates.push({
      source,
      category,
      beneficiary: side,
      direction: 'positive',
      importance: factorImportance(rank),
      label: label(side),
      detail: detail(side, gap),
      evidenceValue: Math.round(gap),
      rank,
    });
  };

  addComparison(
    'team_strength', 'strength', homeTeam.overall, awayTeam.overall, 4, 0.65,
    side => `${side === 'home' ? homeTeam.shortName : awayTeam.shortName}整体实力占优`,
    (side, gap) => `${side === 'home' ? homeTeam.shortName : awayTeam.shortName}的基础能力高出约${Math.round(gap)}档。`,
  );
  addComparison(
    'available_squad', 'strength', averageBoost(homeBoosts), averageBoost(awayBoosts), 0.8, 2.4,
    side => `${side === 'home' ? homeTeam.shortName : awayTeam.shortName}可用阵容更强`,
    side => `${side === 'home' ? homeTeam.shortName : awayTeam.shortName}本场可用首发带来的增益更明显。`,
  );

  const homeLoss = averageBoost(homeAbsenceLoss);
  const awayLoss = averageBoost(awayAbsenceLoss);
  const largerLoss = Math.max(homeLoss, awayLoss);
  if (largerLoss >= 0.6 && Math.abs(homeLoss - awayLoss) >= 0.3) {
    const side = homeLoss > awayLoss ? 'home' : 'away';
    const team = side === 'home' ? homeTeam : awayTeam;
    const rank = largerLoss * 3;
    candidates.push({
      source: 'absences', category: 'availability', beneficiary: side, direction: 'negative',
      importance: factorImportance(rank), label: `${team.shortName}伤停折损`,
      detail: `${team.shortName}缺少可用球员，阵容质量受到可感知影响。`,
      evidenceValue: Math.round(largerLoss * 10), rank,
    });
  }

  addComparison(
    'morale', 'condition', homeState.morale, awayState.morale, 8, 0.45,
    side => `${side === 'home' ? homeTeam.shortName : awayTeam.shortName}士气更盛`,
    side => `${side === 'home' ? homeTeam.shortName : awayTeam.shortName}以更积极的球队状态进入比赛。`,
  );
  addComparison(
    'momentum', 'condition', homeState.momentum, awayState.momentum, 2, 1.7,
    side => `${side === 'home' ? homeTeam.shortName : awayTeam.shortName}势头更好`,
    side => `${side === 'home' ? homeTeam.shortName : awayTeam.shortName}近期比赛走势更强。`,
  );
  addComparison(
    'fatigue', 'condition', 100 - homeState.fatigue, 100 - awayState.fatigue, 10, 0.4,
    side => `${side === 'home' ? homeTeam.shortName : awayTeam.shortName}体能占优`,
    side => `${side === 'home' ? homeTeam.shortName : awayTeam.shortName}赛前疲劳负担更低。`,
  );

  if (!fixture.isNeutralVenue) {
    candidates.push({
      source: 'home_advantage', category: 'context', beneficiary: 'home', direction: 'positive',
      importance: 1, label: `${homeTeam.shortName}主场作战`, detail: '主场环境为主队提供稳定但有限的增益。',
      evidenceValue: Math.round(BALANCE.HOME_ADVANTAGE * 100), rank: 2.5,
    });
  }

  const coachValue = (coach: CoachBase | null) => coach
    ? (coach.attackBuff + coach.defenseBuff) * BALANCE.COACH_BUFF_WEIGHT / 2
    : 0;
  addComparison(
    'coach', 'coach', coachValue(homeCoach), coachValue(awayCoach), 0.8, 2,
    side => `${side === 'home' ? homeTeam.shortName : awayTeam.shortName}教练加成占优`,
    side => `${side === 'home' ? homeTeam.shortName : awayTeam.shortName}教练的攻防增益更适合本场。`,
  );
  const competitionBuff = (coach: CoachBase | null) => coach
    ? (isCup(fixture.competitionType) ? coach.cupBuff : coach.leagueBuff)
    : 0;
  addComparison(
    'competition_fit', 'coach', competitionBuff(homeCoach), competitionBuff(awayCoach), 2, 1.2,
    side => `${side === 'home' ? homeTeam.shortName : awayTeam.shortName}赛事适性更佳`,
    side => `${side === 'home' ? homeTeam.shortName : awayTeam.shortName}教练在此类赛事中的适性更突出。`,
  );

  const overallGap = Math.abs(homeTeam.overall - awayTeam.overall);
  if (overallGap > 8) {
    const side = homeTeam.overall < awayTeam.overall ? 'home' : 'away';
    const team = side === 'home' ? homeTeam : awayTeam;
    const rank = BALANCE.UNDERDOG_BOOST * overallGap * 2;
    candidates.push({
      source: 'underdog_response', category: 'context', beneficiary: side, direction: 'positive',
      importance: factorImportance(rank), label: `${team.shortName}以弱抗强`,
      detail: `${team.shortName}在实力悬殊的对局中获得额外的对抗动力。`,
      evidenceValue: Math.round(overallGap), rank,
    });
  }

  const derbyBases = { [homeTeam.id]: homeTeam, [awayTeam.id]: awayTeam } as Record<string, TeamBase>;
  if (isDerby(homeTeam.id, awayTeam.id, derbyBases)) {
    const derbyBoost = getDerbyBoost(homeTeam.id, awayTeam.id, derbyBases);
    candidates.push({
      source: 'derby', category: 'context', beneficiary: 'both', direction: 'positive',
      importance: factorImportance(derbyBoost), label: '德比强度',
      detail: '宿敌相遇让双方进攻投入和比赛波动同步上升。',
      evidenceValue: Math.round(derbyBoost), rank: derbyBoost,
    });
  }

  const selected: RankedMatchFactor[] = [];
  for (const factor of candidates.sort((a, b) => b.rank - a.rank || a.source.localeCompare(b.source))) {
    if (selected.some(item => item.category === factor.category)) continue;
    selected.push(factor);
    if (selected.length === 3) break;
  }
  return selected.map(factor => ({
    source: factor.source,
    beneficiary: factor.beneficiary,
    direction: factor.direction,
    importance: factor.importance,
    label: factor.label,
    detail: factor.detail,
    evidenceValue: factor.evidenceValue,
  }));
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
    factors: buildMatchFactors(input),
  };
}

export function competitionRandomness(type: CompetitionType): number {
  return isCup(type) ? BALANCE.CUP_RANDOMNESS : BALANCE.LEAGUE_RANDOMNESS;
}

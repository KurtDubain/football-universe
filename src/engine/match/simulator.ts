import {
  MatchFixture,
  MatchResult,
  MatchStats,
  CompetitionType,
} from '../../types';
import { TeamBase, TeamState } from '../../types/team';
import { CoachBase } from '../../types/coach';
import { Player } from '../../types/player';
import { SeededRNG } from './rng';
import { isDerby } from '../../config/derbies';
import { BALANCE } from '../../config/balance';
import { poissonSample } from './poisson';
import { generateMatchEvents } from './events';

// ── Public interfaces ──────────────────────────────────────────────

export interface SimulationContext {
  homeTeam: TeamBase;
  awayTeam: TeamBase;
  homeState: TeamState;
  awayState: TeamState;
  homeCoach: CoachBase | null;
  awayCoach: CoachBase | null;
  competitionType: CompetitionType;
  isKnockout: boolean;
  rng: SeededRNG;
  homeSquad?: Player[];
  awaySquad?: Player[];
}

export interface SimulationResult {
  matchResult: MatchResult;
  homeStateChanges: Partial<TeamState>;
  awayStateChanges: Partial<TeamState>;
  homePressureChange: number;
  awayPressureChange: number;
}

// ── Helpers ────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isCup(type: CompetitionType): boolean {
  return type === 'league_cup' || type === 'super_cup' || type === 'world_cup';
}

interface AdjustedStrengths {
  attack: number;
  midfield: number;
  defense: number;
}

function calculateAdjustedStrengths(
  team: TeamBase,
  state: TeamState,
  coach: CoachBase | null,
  isHome: boolean,
): AdjustedStrengths {
  const homeBonus = isHome ? BALANCE.HOME_ADVANTAGE * 100 : 0;
  const homeSmallBonus = isHome ? 3 : 0;

  const coachAttackBuff = coach ? coach.attackBuff * BALANCE.COACH_BUFF_WEIGHT : 0;
  const coachDefenseBuff = coach ? coach.defenseBuff * BALANCE.COACH_BUFF_WEIGHT : 0;

  const attack = Math.max(
    20,
    team.attack
      + coachAttackBuff
      + homeBonus
      + state.momentum * 1.5
      - state.fatigue * 0.15
      + (state.morale - 60) * 0.12,
  );

  const midfield = Math.max(
    20,
    team.midfield
      + homeSmallBonus
      + state.momentum * 1
      - state.fatigue * 0.08,
  );

  const defense = Math.max(
    20,
    team.defense
      + coachDefenseBuff
      + homeSmallBonus
      - state.fatigue * 0.10
      + team.stability * 0.1,
  );

  return { attack, midfield, defense };
}

function calculateExpectedGoals(
  attackStrength: number,
  defenseStrength: number,
  midfieldDominance: number, // 0-1, from this team's perspective
  coach: CoachBase | null,
  competitionType: CompetitionType,
  rng: SeededRNG,
): number {
  // Attack power boosted by midfield dominance
  const effectiveAttack = attackStrength * (0.6 + midfieldDominance * 0.4);
  // Defense modulated by opponent midfield dominance
  const effectiveDefense = defenseStrength * (0.8 + (1 - midfieldDominance) * 0.2);

  let expGoals = BALANCE.BASE_GOAL_RATE * (effectiveAttack / effectiveDefense);

  // Apply match-type randomness
  const noise = isCup(competitionType) ? BALANCE.CUP_RANDOMNESS : BALANCE.LEAGUE_RANDOMNESS;
  expGoals *= 1 + rng.nextFloat(-noise, noise);

  // Apply coach comp-type buffs
  if (coach) {
    if (isCup(competitionType)) {
      expGoals *= 1 + coach.cupBuff * 0.01;
    } else {
      expGoals *= 1 + coach.leagueBuff * 0.01;
    }
  }

  return clamp(expGoals, 0.2, 5.0);
}

function generateMatchStats(
  homeAdj: AdjustedStrengths,
  awayAdj: AdjustedStrengths,
  midfieldDominance: number,
  homeGoals: number,
  awayGoals: number,
  rng: SeededRNG,
): MatchStats {
  // Possession driven by midfield dominance
  const homePoss = clamp(Math.round(midfieldDominance * 100), 25, 75);
  const awayPoss = 100 - homePoss;

  // Shots proportional to attack, with some randomness
  const homeShots = clamp(
    Math.round((homeAdj.attack / 10) * (0.8 + rng.next() * 0.4)) + homeGoals,
    homeGoals + 1,
    25,
  );
  const awayShots = clamp(
    Math.round((awayAdj.attack / 10) * (0.8 + rng.next() * 0.4)) + awayGoals,
    awayGoals + 1,
    25,
  );

  // Shots on target: at least as many as goals, at most as many as shots
  const homeSoT = clamp(
    Math.round(homeShots * (0.3 + rng.next() * 0.25)),
    homeGoals,
    homeShots,
  );
  const awaySoT = clamp(
    Math.round(awayShots * (0.3 + rng.next() * 0.25)),
    awayGoals,
    awayShots,
  );

  // Corners loosely tied to attacking pressure
  const homeCorners = rng.nextInt(1, Math.round(3 + homePoss / 15));
  const awayCorners = rng.nextInt(1, Math.round(3 + awayPoss / 15));

  // Fouls loosely tied to defensive work
  const homeFouls = rng.nextInt(6, 18);
  const awayFouls = rng.nextInt(6, 18);

  // Cards already counted in events, but we also store summary counts
  // The caller can override these from events; we provide reasonable defaults
  const homeYellows = rng.nextInt(0, 3);
  const awayYellows = rng.nextInt(0, 3);
  const homeReds = rng.next() < 0.03 ? 1 : 0;
  const awayReds = rng.next() < 0.03 ? 1 : 0;

  return {
    possession: [homePoss, awayPoss],
    shots: [homeShots, awayShots],
    shotsOnTarget: [homeSoT, awaySoT],
    corners: [homeCorners, awayCorners],
    fouls: [homeFouls, awayFouls],
    yellowCards: [homeYellows, awayYellows],
    redCards: [homeReds, awayReds],
  };
}

function simulatePenaltyShootout(rng: SeededRNG): [number, number] {
  let homeScore = 0;
  let awayScore = 0;

  // First 5 rounds
  for (let round = 0; round < 5; round++) {
    if (rng.next() < 0.75) homeScore++;
    if (rng.next() < 0.75) awayScore++;
  }

  // If still level after 5 rounds, sudden death
  while (homeScore === awayScore) {
    const homeScores = rng.next() < 0.75;
    const awayScores = rng.next() < 0.75;

    if (homeScores) homeScore++;
    if (awayScores) awayScore++;

    // If both scored or both missed, continue
    if (homeScores === awayScores) continue;
    // Otherwise one team leads, shootout over
    break;
  }

  return [homeScore, awayScore];
}

function updateFormArray(
  current: ('W' | 'D' | 'L')[],
  result: 'W' | 'D' | 'L',
): ('W' | 'D' | 'L')[] {
  const updated = [...current, result];
  // Keep only last 5
  if (updated.length > 5) {
    return updated.slice(updated.length - 5);
  }
  return updated;
}

// ── Main simulation ────────────────────────────────────────────────

export function simulateMatch(
  ctx: SimulationContext,
  fixture: MatchFixture,
): SimulationResult {
  const { homeTeam, awayTeam, homeState, awayState, homeCoach, awayCoach, rng } = ctx;

  // 1. Calculate adjusted strengths
  const homeAdj = calculateAdjustedStrengths(homeTeam, homeState, homeCoach, true);
  const awayAdj = calculateAdjustedStrengths(awayTeam, awayState, awayCoach, false);

  // 2. Underdog boost — weaker team gets a small boost to enable upsets
  const overallGap = Math.abs(homeTeam.overall - awayTeam.overall);
  if (overallGap > 8) {
    const boost = BALANCE.UNDERDOG_BOOST * overallGap;
    if (homeTeam.overall < awayTeam.overall) {
      homeAdj.attack += boost;
      homeAdj.midfield += boost * 0.5;
    } else {
      awayAdj.attack += boost;
      awayAdj.midfield += boost * 0.5;
    }
  }

  // 2b. Derby boost — derbies are more intense and unpredictable
  if (isDerby(homeTeam.id, awayTeam.id)) {
    const derbyBoost = 3;
    homeAdj.attack += derbyBoost;
    awayAdj.attack += derbyBoost;
    // Derbies have extra randomness added in expected goals via higher noise
  }

  // 3. Midfield dominance (0 = away dominant, 1 = home dominant)
  const midfieldDominance = homeAdj.midfield / (homeAdj.midfield + awayAdj.midfield);

  // 3. Expected goals
  const homeExpGoals = calculateExpectedGoals(
    homeAdj.attack,
    awayAdj.defense,
    midfieldDominance,
    homeCoach,
    ctx.competitionType,
    rng.fork(), // isolated randomness for noise
  );
  const awayExpGoals = calculateExpectedGoals(
    awayAdj.attack,
    homeAdj.defense,
    1 - midfieldDominance,
    awayCoach,
    ctx.competitionType,
    rng.fork(),
  );

  // 4. Sample goals from Poisson
  let homeGoals = poissonSample(homeExpGoals, rng);
  let awayGoals = poissonSample(awayExpGoals, rng);

  // These track regulation-time goals for the MatchResult
  const regHomeGoals = homeGoals;
  const regAwayGoals = awayGoals;

  let extraTime = false;
  let etHomeGoals: number | undefined;
  let etAwayGoals: number | undefined;
  let penalties = false;
  let penaltyHome: number | undefined;
  let penaltyAway: number | undefined;

  // 5. Handle knockout logic
  if (ctx.isKnockout && homeGoals === awayGoals) {
    extraTime = true;

    // Extra time: 30 minutes, reduce expected goals by 60%
    const etHomeExp = clamp(homeExpGoals * 0.4 * (30 / 90), 0.1, 2.0);
    const etAwayExp = clamp(awayExpGoals * 0.4 * (30 / 90), 0.1, 2.0);

    etHomeGoals = poissonSample(etHomeExp, rng);
    etAwayGoals = poissonSample(etAwayExp, rng);

    // Combined total for event generation and penalty check
    homeGoals += etHomeGoals;
    awayGoals += etAwayGoals;

    // Still level? Penalties.
    if (homeGoals === awayGoals) {
      penalties = true;
      [penaltyHome, penaltyAway] = simulatePenaltyShootout(rng);
    }
  }

  // 6. Generate match events
  const events = generateMatchEvents(
    homeGoals,
    awayGoals,
    homeTeam.id,
    awayTeam.id,
    ctx.competitionType,
    rng.fork(),
    extraTime,
    penaltyHome,
    penaltyAway,
    ctx.homeSquad,
    ctx.awaySquad,
  );

  // 7. Generate match stats
  const stats = generateMatchStats(
    homeAdj,
    awayAdj,
    midfieldDominance,
    homeGoals,
    awayGoals,
    rng.fork(),
  );

  // Reconcile card counts from events
  stats.yellowCards = [
    events.filter((e) => e.type === 'yellow_card' && e.teamId === homeTeam.id).length,
    events.filter((e) => e.type === 'yellow_card' && e.teamId === awayTeam.id).length,
  ];
  stats.redCards = [
    events.filter((e) => e.type === 'red_card' && e.teamId === homeTeam.id).length,
    events.filter((e) => e.type === 'red_card' && e.teamId === awayTeam.id).length,
  ];

  // 8. Build match result
  const matchResult: MatchResult = {
    fixtureId: fixture.id,
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam.id,
    homeGoals: regHomeGoals,
    awayGoals: regAwayGoals,
    extraTime,
    ...(etHomeGoals !== undefined && { etHomeGoals }),
    ...(etAwayGoals !== undefined && { etAwayGoals }),
    penalties,
    ...(penaltyHome !== undefined && { penaltyHome }),
    ...(penaltyAway !== undefined && { penaltyAway }),
    events,
    stats,
    competitionType: ctx.competitionType,
    competitionName: fixture.competitionName,
    roundLabel: fixture.roundLabel,
  };

  // 9. Calculate state changes
  const { homeStateChanges, awayStateChanges, homePressureChange, awayPressureChange } =
    calculateStateChanges(homeGoals, awayGoals, homeState, awayState, homeTeam, awayTeam, penalties, penaltyHome, penaltyAway);

  return {
    matchResult,
    homeStateChanges,
    awayStateChanges,
    homePressureChange,
    awayPressureChange,
  };
}

// ── Post-match state changes ───────────────────────────────────────

function calculateStateChanges(
  homeGoals: number,
  awayGoals: number,
  homeState: TeamState,
  awayState: TeamState,
  homeTeam: TeamBase,
  awayTeam: TeamBase,
  penalties: boolean,
  penaltyHome?: number,
  penaltyAway?: number,
): {
  homeStateChanges: Partial<TeamState>;
  awayStateChanges: Partial<TeamState>;
  homePressureChange: number;
  awayPressureChange: number;
} {
  // Determine effective winner (including penalties)
  let homeWin: boolean;
  let awayWin: boolean;
  let draw: boolean;

  if (penalties && penaltyHome !== undefined && penaltyAway !== undefined) {
    homeWin = penaltyHome > penaltyAway;
    awayWin = penaltyAway > penaltyHome;
    draw = false;
  } else {
    homeWin = homeGoals > awayGoals;
    awayWin = awayGoals > homeGoals;
    draw = homeGoals === awayGoals;
  }

  const isBigWin = Math.abs(homeGoals - awayGoals) >= 3;

  // ── Morale ─────────────────────────────────────────────────────

  let homeMoraleChange: number;
  let awayMoraleChange: number;

  if (homeWin) {
    homeMoraleChange = BALANCE.WIN_MORALE_BOOST;
    awayMoraleChange = -BALANCE.LOSS_MORALE_DROP;
  } else if (awayWin) {
    homeMoraleChange = -BALANCE.LOSS_MORALE_DROP;
    awayMoraleChange = BALANCE.WIN_MORALE_BOOST;
  } else {
    homeMoraleChange = BALANCE.DRAW_MORALE;
    awayMoraleChange = BALANCE.DRAW_MORALE;
  }

  const newHomeMorale = clamp(homeState.morale + homeMoraleChange, 0, 100);
  const newAwayMorale = clamp(awayState.morale + awayMoraleChange, 0, 100);

  // ── Fatigue ────────────────────────────────────────────────────

  const newHomeFatigue = clamp(homeState.fatigue + BALANCE.MATCH_FATIGUE, 0, 100);
  const newAwayFatigue = clamp(awayState.fatigue + BALANCE.MATCH_FATIGUE, 0, 100);

  // ── Momentum ───────────────────────────────────────────────────

  let homeMomentumChange = 0;
  let awayMomentumChange = 0;

  if (homeWin) {
    homeMomentumChange = isBigWin ? BALANCE.BIG_WIN_MOMENTUM : 1;
    awayMomentumChange = isBigWin ? BALANCE.BIG_LOSS_MOMENTUM : -1;
  } else if (awayWin) {
    homeMomentumChange = isBigWin ? BALANCE.BIG_LOSS_MOMENTUM : -1;
    awayMomentumChange = isBigWin ? BALANCE.BIG_WIN_MOMENTUM : 1;
  }
  // Draws: no momentum change

  const newHomeMomentum = clamp(homeState.momentum + homeMomentumChange, -10, 10);
  const newAwayMomentum = clamp(awayState.momentum + awayMomentumChange, -10, 10);

  // ── Coach pressure ─────────────────────────────────────────────

  const homeExpectMult = homeTeam.expectation >= 4 ? BALANCE.ELITE_TEAM_PRESSURE_MULT : 1;
  const awayExpectMult = awayTeam.expectation >= 4 ? BALANCE.ELITE_TEAM_PRESSURE_MULT : 1;

  let homePressureChange = 0;
  let awayPressureChange = 0;

  if (homeWin) {
    homePressureChange = -BALANCE.WIN_PRESSURE_DECREASE;
    awayPressureChange = Math.round(BALANCE.LOSS_PRESSURE_INCREASE * awayExpectMult);
  } else if (awayWin) {
    homePressureChange = Math.round(BALANCE.LOSS_PRESSURE_INCREASE * homeExpectMult);
    awayPressureChange = -BALANCE.WIN_PRESSURE_DECREASE;
  } else {
    homePressureChange = Math.round(BALANCE.DRAW_PRESSURE_INCREASE * homeExpectMult);
    awayPressureChange = Math.round(BALANCE.DRAW_PRESSURE_INCREASE * awayExpectMult);
  }

  // ── Recent form ────────────────────────────────────────────────

  const homeFormResult: 'W' | 'D' | 'L' = homeWin ? 'W' : awayWin ? 'L' : 'D';
  const awayFormResult: 'W' | 'D' | 'L' = awayWin ? 'W' : homeWin ? 'L' : 'D';

  const newHomeForm = updateFormArray(homeState.recentForm, homeFormResult);
  const newAwayForm = updateFormArray(awayState.recentForm, awayFormResult);

  return {
    homeStateChanges: {
      morale: newHomeMorale,
      fatigue: newHomeFatigue,
      momentum: newHomeMomentum,
      recentForm: newHomeForm,
    },
    awayStateChanges: {
      morale: newAwayMorale,
      fatigue: newAwayFatigue,
      momentum: newAwayMomentum,
      recentForm: newAwayForm,
    },
    homePressureChange,
    awayPressureChange,
  };
}

import {
  MatchFixture,
  MatchResult,
  MatchStats,
  MatchEvent,
  CompetitionType,
} from '../../types';
import { TeamBase, TeamState } from '../../types/team';
import { CoachBase } from '../../types/coach';
import { Player } from '../../types/player';
import { SeededRNG } from './rng';
import { isDerby, getDerbyBoost } from '../../config/derbies';
import { BALANCE } from '../../config/balance';
import { poissonSample } from './poisson';
import { generateMatchEvents, applyDenyPipeline } from './events';
import { computePlayerBoosts, PlayerBoosts } from '../players/player-boosts';
import { selectMatchday } from '../players/injuries';
import {
  buildMatchParticipation,
  applyDismissalsToSnapshot,
  createSubstitutionEvents,
  playersOnField,
  selectStartingEleven,
} from './participation';

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
  /** Global window index — used to filter injured/suspended players from boosts. */
  globalWindowIdx?: number;
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
  return type === 'league_cup' || type === 'super_cup' || type === 'world_cup' || type === 'continental_cup';
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
  playerBoosts?: PlayerBoosts,
): AdjustedStrengths {
  const homeBonus = isHome ? BALANCE.HOME_ADVANTAGE * 100 : 0;
  const homeSmallBonus = isHome ? 3 : 0;

  const coachAttackBuff = coach ? coach.attackBuff * BALANCE.COACH_BUFF_WEIGHT : 0;
  const coachDefenseBuff = coach ? coach.defenseBuff * BALANCE.COACH_BUFF_WEIGHT : 0;

  // Phase 1B — squad-derived buffs (independent of coach). See player-boosts.ts.
  const playerAttack   = playerBoosts?.attack   ?? 0;
  const playerMidfield = playerBoosts?.midfield ?? 0;
  const playerDefense  = playerBoosts?.defense  ?? 0;

  const attack = Math.max(
    20,
    team.attack
      + coachAttackBuff
      + playerAttack
      + homeBonus
      + state.momentum * 1.5
      - state.fatigue * 0.15
      + (state.morale - 60) * 0.12,
  );

  const midfield = Math.max(
    20,
    team.midfield
      + playerMidfield
      + homeSmallBonus
      + state.momentum * 1
      - state.fatigue * 0.08,
  );

  const defense = Math.max(
    20,
    team.defense
      + coachDefenseBuff
      + playerDefense
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

/**
 * Compute Man of the Match from generated events.
 * Weights: goal=3, assist=2, save=0.5, yellow=-1, red=-2.
 * Players on the winning side get a 1.2× multiplier. `penalty_goal` is
 * reserved for shootouts and never contributes to MotM; regulation/ET
 * penalties are emitted as normal `goal` events. Threshold of 3 means at
 * least one goal-equivalent contribution is required.
 */
export function pickMotm(
  events: MatchEvent[],
  winnerTeamId: string | null,
): string | undefined {
  const score = new Map<string, number>(); // playerName → score
  for (const e of events) {
    if (e.minute > 120) continue; // skip shootout
    if (!e.playerName) continue;
    let delta = 0;
    if (e.type === 'goal') delta = 3;
    else if (e.type === 'assist') delta = 2;
    else if (e.type === 'save') delta = 0.5;
    else if (e.type === 'yellow_card') delta = -1;
    else if (e.type === 'red_card') delta = -2;
    else continue;
    // Bonus if on winning side
    if (winnerTeamId && e.teamId === winnerTeamId) delta *= 1.2;
    score.set(e.playerName, (score.get(e.playerName) ?? 0) + delta);
  }
  let bestName: string | undefined;
  let bestScore = 0;
  for (const [name, s] of score) {
    if (s > bestScore) {
      bestScore = s;
      bestName = name;
    }
  }
  return bestScore >= 3 ? bestName : undefined; // need at least 1 goal-equivalent
}

export function simulateMatch(
  ctx: SimulationContext,
  fixture: MatchFixture,
): SimulationResult {
  const { homeTeam, awayTeam, homeState, awayState, homeCoach, awayCoach, rng } = ctx;
  const globalWindowIdx = ctx.globalWindowIdx ?? 0;
  const homeSelection = selectMatchday(ctx.homeSquad, globalWindowIdx);
  const awaySelection = selectMatchday(ctx.awaySquad, globalWindowIdx);
  const homeStarters = selectStartingEleven(homeSelection?.players ?? []);
  const awayStarters = selectStartingEleven(awaySelection?.players ?? []);

  // Phase 1B — derive per-squad buffs (filters out injured / suspended)
  const homeBoosts = computePlayerBoosts(homeStarters, globalWindowIdx);
  const awayBoosts = computePlayerBoosts(awayStarters, globalWindowIdx);

  // 1. Calculate adjusted strengths. v23 — for neutral-venue matches
  // (cup finals), suppress home advantage by passing isHome=false for
  // both sides. The `homeTeamId` label is preserved for stats but the
  // venue is neutral.
  const isNeutral = !!fixture.isNeutralVenue;
  const homeAdj = calculateAdjustedStrengths(homeTeam, homeState, homeCoach, !isNeutral, homeBoosts);
  const awayAdj = calculateAdjustedStrengths(awayTeam, awayState, awayCoach, false, awayBoosts);

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
  const derbyBases = { [homeTeam.id]: homeTeam, [awayTeam.id]: awayTeam } as Record<string, TeamBase>;
  if (isDerby(homeTeam.id, awayTeam.id, derbyBases)) {
    const derbyBoost = getDerbyBoost(homeTeam.id, awayTeam.id, derbyBases);
    homeAdj.attack += derbyBoost;
    awayAdj.attack += derbyBoost;
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

  // These track regulation-time goals for the MatchResult. Mutated by
  // the deny pipeline below — if a goal is denied we have to lower the
  // count, so these MUST be `let` not `const`.
  let regHomeGoals = homeGoals;
  let regAwayGoals = awayGoals;

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

  const durationMinutes: 90 | 120 = extraTime ? 120 : 90;
  const homeParticipation = buildMatchParticipation(homeSelection, durationMinutes, rng.fork());
  const awayParticipation = buildMatchParticipation(awaySelection, durationMinutes, rng.fork());
  const homePlayersAtMinute = (minute: number) => playersOnField(
    ctx.homeSquad,
    homeParticipation?.snapshot,
    Math.min(minute, durationMinutes - 1),
  );
  const awayPlayersAtMinute = (minute: number) => playersOnField(
    ctx.awaySquad,
    awayParticipation?.snapshot,
    Math.min(minute, durationMinutes - 1),
  );
  const homeScheduledOut = new Set(homeParticipation?.snapshot.substitutions?.map(sub => sub.playerOutId) ?? []);
  const awayScheduledOut = new Set(awayParticipation?.snapshot.substitutions?.map(sub => sub.playerOutId) ?? []);
  const homeRedCardCandidatesAtMinute = (minute: number) => homePlayersAtMinute(minute)
    .filter(player => !homeScheduledOut.has(player.uuid))
    .filter(player => homeParticipation?.snapshot.players.find(entry => entry.playerId === player.uuid)?.enteredMinute !== minute);
  const awayRedCardCandidatesAtMinute = (minute: number) => awayPlayersAtMinute(minute)
    .filter(player => !awayScheduledOut.has(player.uuid))
    .filter(player => awayParticipation?.snapshot.players.find(entry => entry.playerId === player.uuid)?.enteredMinute !== minute);

  // 6. Generate match events
  // v18 — flag "big match" so clutch-tagged players get a +30% weight on
  // the goal-scorer roll. Big match = cup final OR derby. Stays loose
  // (just biases who scores; doesn't change the outcome itself).
  const isBigMatch =
    fixture.roundLabel === 'Final' ||
    fixture.roundLabel === '决赛' ||
    isDerby(homeTeam.id, awayTeam.id);
  const generatedEvents = generateMatchEvents(
    regHomeGoals,
    regAwayGoals,
    homeTeam.id,
    awayTeam.id,
    ctx.competitionType,
    rng.fork(),
    extraTime,
    penaltyHome,
    penaltyAway,
    homeStarters,
    awayStarters,
    etHomeGoals ?? 0,
    etAwayGoals ?? 0,
    isBigMatch,
    homePlayersAtMinute,
    awayPlayersAtMinute,
    homeRedCardCandidatesAtMinute,
    awayRedCardCandidatesAtMinute,
  );
  applyDismissalsToSnapshot(homeParticipation?.snapshot, generatedEvents, homeTeam.id);
  applyDismissalsToSnapshot(awayParticipation?.snapshot, generatedEvents, awayTeam.id);
  const rawEvents = [
    ...generatedEvents,
    ...createSubstitutionEvents(homeParticipation?.snapshot, ctx.homeSquad, homeTeam.id),
    ...createSubstitutionEvents(awayParticipation?.snapshot, ctx.awaySquad, awayTeam.id),
  ].sort((a, b) => a.minute - b.minute
    || Number(b.type === 'substitution') - Number(a.type === 'substitution'));

  // v22 — Apply deny pipeline. Goals that get denied are removed from
  // the events list and replaced with `gk_save` / `df_block` events. We
  // then RE-DERIVE the regulation / ET goal counts from the surviving
  // events so the scoreline and the events array stay consistent (the
  // invariant `homeGoals === count(events where type=='goal' &&
  // teamId===home)` is critical for stats-pipeline correctness).
  //
  // CAVEAT: skip deny for knockout matches. The current pipeline runs
  // AFTER ET / penalty-shootout decisions are made; if deny changed a
  // pre-tied regulation into a decisive one (or vice versa) we'd end up
  // with a knockout match that's "missing" ET or has a shootout that
  // shouldn't have happened. League / group-stage matches don't have
  // this problem (ties are valid outcomes) so deny is safe there.
  const events = ctx.isKnockout
    ? rawEvents
    : applyDenyPipeline(
        rawEvents,
        homeTeam.id,
        awayTeam.id,
        homeStarters,
        awayStarters,
        rng.fork(),
        homePlayersAtMinute,
        awayPlayersAtMinute,
      );
  const isHomeGoal = (e: typeof events[number]) => e.type === 'goal' && e.teamId === homeTeam.id;
  const isAwayGoal = (e: typeof events[number]) => e.type === 'goal' && e.teamId === awayTeam.id;
  regHomeGoals = events.filter(e => isHomeGoal(e) && e.minute <= 90).length;
  regAwayGoals = events.filter(e => isAwayGoal(e) && e.minute <= 90).length;
  if (extraTime) {
    etHomeGoals = events.filter(e => isHomeGoal(e) && e.minute > 90 && e.minute <= 120).length;
    etAwayGoals = events.filter(e => isAwayGoal(e) && e.minute > 90 && e.minute <= 120).length;
  }
  // Also re-derive the running TOTAL goal counters (reg + ET). These feed
  // generateMatchStats and calculateStateChanges below; if we don't sync,
  // possession / shots / form deltas will reflect the un-denied scoreline.
  homeGoals = regHomeGoals + (etHomeGoals ?? 0);
  awayGoals = regAwayGoals + (etAwayGoals ?? 0);
  // Note: penalty shootout goals (minute > 120) are produced separately
  // by the shootout simulator and never touched by deny.

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
    ...(homeParticipation && { homeMatchday: homeParticipation.snapshot }),
    ...(awayParticipation && { awayMatchday: awayParticipation.snapshot }),
    ...(isNeutral && { isNeutralVenue: true }),
  };

  // 8b. Compute Man of the Match (winner determined by combined regulation
  // + extra time totals; penalties shootouts do not influence MotM scoring).
  const totalHome = regHomeGoals + (etHomeGoals ?? 0);
  const totalAway = regAwayGoals + (etAwayGoals ?? 0);
  const winnerTeamId =
    totalHome > totalAway ? homeTeam.id
    : totalAway > totalHome ? awayTeam.id
    : null;
  const motm = pickMotm(events, winnerTeamId);
  if (motm) matchResult.motm = motm;

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

  if (penalties && penaltyHome !== undefined && penaltyAway !== undefined) {
    homeWin = penaltyHome > penaltyAway;
    awayWin = penaltyAway > penaltyHome;
  } else {
    homeWin = homeGoals > awayGoals;
    awayWin = awayGoals > homeGoals;
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

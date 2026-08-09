import {
  MatchFixture,
  MatchResult,
  MatchStats,
  MatchEvent,
  CompetitionType,
  MatchdaySnapshot,
  PenaltyShootoutResult,
} from '../../types';
import { TeamBase, TeamState } from '../../types/team';
import { CoachBase } from '../../types/coach';
import { Player } from '../../types/player';
import { SeededRNG } from './rng';
import { isDerby } from '../../config/derbies';
import { BALANCE } from '../../config/balance';
import { poissonSample } from './poisson';
import { addNotableSetPieceEvents, generateMatchEvents, applyDenyPipeline } from './events';
import { selectMatchday } from '../players/injuries';
import {
  buildMatchParticipation,
  applyDismissalsToSnapshot,
  createSubstitutionEvents,
  playersOnField,
  selectStartingEleven,
} from './participation';
import type { AdjustedStrengths } from './model';
import { calculateMatchModel, competitionRandomness, computeMatchdayModelReport, expectedGoals, forecastFromModel } from './model';
import { simulatePenaltyShootout } from './penalty-shootout';

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

function stableStringHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}

function localMatchRng(fixtureId: string, salt: string, state: number): SeededRNG {
  return new SeededRNG(stableStringHash(`${fixtureId}:${salt}`) ^ state);
}

function distributeDefensiveTotal(
  total: number,
  teamId: string,
  snapshot: MatchdaySnapshot | undefined,
  squad: Player[] | undefined,
  field: 'interceptions' | 'clearances',
  rng: SeededRNG,
  out: NonNullable<MatchResult['defensiveContributions']>,
): void {
  if (total <= 0) return;
  const byId = new Map((squad ?? []).map(player => [player.uuid, player]));
  const candidates = (snapshot?.players ?? [])
    .filter(entry => entry.position === 'DF' && (entry.minutesPlayed ?? 0) > 0)
    .map(entry => ({ player: byId.get(entry.playerId), minutes: entry.minutesPlayed ?? 0 }))
    .filter((entry): entry is { player: Player; minutes: number } => Boolean(entry.player));
  if (candidates.length === 0) return;

  const weights = candidates.map(({ player, minutes }) => minutes * (0.55 + player.rating / 100));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  for (let action = 0; action < total; action++) {
    let roll = rng.next() * weightTotal;
    let selected = candidates.at(-1)!;
    for (let index = 0; index < candidates.length; index++) {
      roll -= weights[index];
      if (roll <= 0) {
        selected = candidates[index];
        break;
      }
    }
    const current = out[selected.player.uuid] ?? {
      playerId: selected.player.uuid,
      teamId,
      interceptions: 0,
      clearances: 0,
    };
    current[field]++;
    out[selected.player.uuid] = current;
  }
}

function distributeRoutineSaves(
  total: number,
  teamId: string,
  snapshot: MatchdaySnapshot | undefined,
  squad: Player[] | undefined,
  rng: SeededRNG,
  out: NonNullable<MatchResult['defensiveContributions']>,
): void {
  if (total <= 0) return;
  const byId = new Map((squad ?? []).map(player => [player.uuid, player]));
  const candidates = snapshot
    ? snapshot.players
      .filter(entry => entry.position === 'GK' && (entry.minutesPlayed ?? 0) > 0 && byId.has(entry.playerId))
      .map(entry => ({ player: byId.get(entry.playerId)!, minutes: entry.minutesPlayed ?? 0 }))
    : (squad ?? [])
      .filter(player => player.position === 'GK')
      .slice(0, 1)
      .map(player => ({ player, minutes: 90 }));
  const minutesTotal = candidates.reduce((sum, candidate) => sum + candidate.minutes, 0);
  if (minutesTotal <= 0) return;

  for (let save = 0; save < total; save++) {
    let roll = rng.next() * minutesTotal;
    let selected = candidates.at(-1)!;
    for (const candidate of candidates) {
      roll -= candidate.minutes;
      if (roll <= 0) {
        selected = candidate;
        break;
      }
    }
    const current = out[selected.player.uuid] ?? {
      playerId: selected.player.uuid,
      teamId,
      interceptions: 0,
      clearances: 0,
    };
    current.routineSaves = (current.routineSaves ?? 0) + 1;
    out[selected.player.uuid] = current;
  }
}

function generateDefensiveContributions(
  fixtureId: string,
  stats: MatchStats,
  state: number,
  homeTeamId: string,
  awayTeamId: string,
  homeSnapshot: MatchdaySnapshot | undefined,
  awaySnapshot: MatchdaySnapshot | undefined,
  homeSquad: Player[] | undefined,
  awaySquad: Player[] | undefined,
  homeRoutineSaves: number,
  awayRoutineSaves: number,
): NonNullable<MatchResult['defensiveContributions']> {
  const rng = localMatchRng(fixtureId, 'defensive-contributions-v1', state);
  const out: NonNullable<MatchResult['defensiveContributions']> = {};
  const teamInputs = [
    {
      teamId: homeTeamId,
      snapshot: homeSnapshot,
      squad: homeSquad,
      opponentPossession: stats.possession[1],
      opponentShots: stats.shots[1],
      opponentCorners: stats.corners[1],
    },
    {
      teamId: awayTeamId,
      snapshot: awaySnapshot,
      squad: awaySquad,
      opponentPossession: stats.possession[0],
      opponentShots: stats.shots[0],
      opponentCorners: stats.corners[0],
    },
  ];

  for (const input of teamInputs) {
    const interceptions = clamp(Math.round(
      3 + input.opponentPossession * 0.07 + input.opponentShots * 0.18 + rng.nextFloat(-1.5, 1.5),
    ), 4, 13);
    const clearances = clamp(Math.round(
      4 + input.opponentShots * 0.55 + input.opponentCorners * 0.45
      + Math.max(0, input.opponentPossession - 50) * 0.08 + rng.nextFloat(-2, 2),
    ), 5, 20);
    distributeDefensiveTotal(interceptions, input.teamId, input.snapshot, input.squad, 'interceptions', rng, out);
    distributeDefensiveTotal(clearances, input.teamId, input.snapshot, input.squad, 'clearances', rng, out);
  }
  distributeRoutineSaves(homeRoutineSaves, homeTeamId, homeSnapshot, homeSquad, rng, out);
  distributeRoutineSaves(awayRoutineSaves, awayTeamId, awaySnapshot, awaySquad, rng, out);
  return out;
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
  defensiveContributions?: MatchResult['defensiveContributions'],
  players?: Map<string, Player>,
): MatchResult['motm'] {
  const candidates = new Map<string, { playerName: string; teamId: string; score: number }>();
  for (const e of events) {
    if (e.minute > 120) continue; // skip shootout
    if (!e.playerId || !e.playerName) continue;
    let delta = 0;
    if (e.type === 'goal') delta = 3;
    else if (e.type === 'assist') delta = 2;
    else if (e.type === 'save') delta = 0.5;
    else if (e.type === 'yellow_card') delta = -1;
    else if (e.type === 'red_card') delta = -2;
    else continue;
    // Bonus if on winning side
    if (winnerTeamId && e.teamId === winnerTeamId) delta *= 1.2;
    const current = candidates.get(e.playerId);
    candidates.set(e.playerId, {
      playerName: current?.playerName ?? e.playerName,
      teamId: current?.teamId ?? e.teamId,
      score: (current?.score ?? 0) + delta,
    });
  }
  for (const contribution of Object.values(defensiveContributions ?? {})) {
    const player = players?.get(contribution.playerId);
    if (!player || !contribution.routineSaves) continue;
    const multiplier = winnerTeamId === contribution.teamId ? 1.2 : 1;
    const current = candidates.get(contribution.playerId);
    candidates.set(contribution.playerId, {
      playerName: current?.playerName ?? player.name,
      teamId: current?.teamId ?? contribution.teamId,
      score: (current?.score ?? 0) + contribution.routineSaves * 0.5 * multiplier,
    });
  }
  let best: MatchResult['motm'];
  let bestScore = 0;
  for (const [playerId, candidate] of candidates) {
    if (candidate.score > bestScore) {
      bestScore = candidate.score;
      best = {
        playerId,
        playerName: candidate.playerName,
        teamId: candidate.teamId,
      };
    }
  }
  return bestScore >= 3 ? best : undefined; // need at least 1 goal-equivalent
}

export function simulateMatch(
  ctx: SimulationContext,
  fixture: MatchFixture,
): SimulationResult {
  const { homeTeam, awayTeam, homeState, awayState, homeCoach, awayCoach, rng } = ctx;
  const globalWindowIdx = ctx.globalWindowIdx ?? 0;
  const homeSelection = selectMatchday(ctx.homeSquad, globalWindowIdx);
  const awaySelection = selectMatchday(ctx.awaySquad, globalWindowIdx);
  const homeStarters = selectStartingEleven(homeSelection?.players ?? [], homeSelection?.unavailablePlayerIds);
  const awayStarters = selectStartingEleven(awaySelection?.players ?? [], awaySelection?.unavailablePlayerIds);

  // Phase 1B — derive per-squad buffs (filters out injured / suspended)
  const homeReport = computeMatchdayModelReport(ctx.homeSquad, globalWindowIdx);
  const awayReport = computeMatchdayModelReport(ctx.awaySquad, globalWindowIdx);
  const homeBoosts = homeReport.boosts;
  const awayBoosts = awayReport.boosts;

  const model = calculateMatchModel({
    homeTeam, awayTeam, homeState, awayState, homeCoach, awayCoach,
    fixture, homeBoosts, awayBoosts,
    homeAbsenceLoss: homeReport.absenceLoss,
    awayAbsenceLoss: awayReport.absenceLoss,
  });
  const homeAdj = model.home;
  const awayAdj = model.away;
  const midfieldDominance = model.midfieldDominance;
  const isNeutral = !!fixture.isNeutralVenue;

  // 3. Expected goals
  const noise = competitionRandomness(ctx.competitionType);
  const homeNoise = 1 + rng.fork().nextFloat(-noise, noise);
  const awayNoise = 1 + rng.fork().nextFloat(-noise, noise);
  const homeExpGoals = expectedGoals(
    homeAdj.attack,
    awayAdj.defense,
    midfieldDominance,
    homeCoach,
    ctx.competitionType,
    homeNoise,
  );
  const awayExpGoals = expectedGoals(
    awayAdj.attack,
    homeAdj.defense,
    1 - midfieldDominance,
    awayCoach,
    ctx.competitionType,
    awayNoise,
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
  let penaltyShootout: PenaltyShootoutResult | undefined;

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
      penaltyShootout = simulatePenaltyShootout(rng);
      penaltyHome = penaltyShootout.homeScore;
      penaltyAway = penaltyShootout.awayScore;
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
    penaltyShootout?.kicks,
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
  let events = ctx.isKnockout
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

  const attackingTeamForEvent = (event: MatchEvent): string => (
    event.type === 'save' || event.type === 'gk_save' || event.type === 'df_block'
      ? event.teamId === homeTeam.id ? awayTeam.id : homeTeam.id
      : event.teamId
  );
  const structuredCornerCounts: [number, number] = [
    events.filter(event => event.playOrigin === 'corner' && attackingTeamForEvent(event) === homeTeam.id).length,
    events.filter(event => event.playOrigin === 'corner' && attackingTeamForEvent(event) === awayTeam.id).length,
  ];
  stats.corners = [
    Math.max(stats.corners[0], structuredCornerCounts[0]),
    Math.max(stats.corners[1], structuredCornerCounts[1]),
  ];
  events = addNotableSetPieceEvents(
    events,
    stats,
    homeTeam.id,
    awayTeam.id,
    durationMinutes,
    rng.fork(),
    homePlayersAtMinute,
    awayPlayersAtMinute,
  );

  const homeKeySaves = events.filter(event => event.type === 'gk_save' && event.teamId === homeTeam.id).length;
  const awayKeySaves = events.filter(event => event.type === 'gk_save' && event.teamId === awayTeam.id).length;
  const homeGoalLineBlocks = events.filter(event => event.type === 'df_block' && event.teamId === homeTeam.id).length;
  const awayGoalLineBlocks = events.filter(event => event.type === 'df_block' && event.teamId === awayTeam.id).length;
  stats.shotsOnTarget = [
    Math.max(stats.shotsOnTarget[0], homeGoals + awayKeySaves + awayGoalLineBlocks),
    Math.max(stats.shotsOnTarget[1], awayGoals + homeKeySaves + homeGoalLineBlocks),
  ];

  const localState = rng.getState();
  const homeRoutineSaves = Math.max(0, stats.shotsOnTarget[1] - awayGoals - homeKeySaves - homeGoalLineBlocks);
  const awayRoutineSaves = Math.max(0, stats.shotsOnTarget[0] - homeGoals - awayKeySaves - awayGoalLineBlocks);
  const defensiveContributions = generateDefensiveContributions(
    fixture.id,
    stats,
    localState,
    homeTeam.id,
    awayTeam.id,
    homeParticipation?.snapshot,
    awayParticipation?.snapshot,
    ctx.homeSquad,
    ctx.awaySquad,
    homeRoutineSaves,
    awayRoutineSaves,
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
    defensiveContributions,
    competitionType: ctx.competitionType,
    competitionName: fixture.competitionName,
    roundLabel: fixture.roundLabel,
    ...(homeParticipation && { homeMatchday: homeParticipation.snapshot }),
    ...(awayParticipation && { awayMatchday: awayParticipation.snapshot }),
    ...(isNeutral && { isNeutralVenue: true }),
    prediction: forecastFromModel(model),
  };

  // 8b. Compute Man of the Match (winner determined by combined regulation
  // + extra time totals; penalties shootouts do not influence MotM scoring).
  const totalHome = regHomeGoals + (etHomeGoals ?? 0);
  const totalAway = regAwayGoals + (etAwayGoals ?? 0);
  const winnerTeamId =
    totalHome > totalAway ? homeTeam.id
    : totalAway > totalHome ? awayTeam.id
    : null;
  const motmPlayers = new Map([...(ctx.homeSquad ?? []), ...(ctx.awaySquad ?? [])]
    .map(player => [player.uuid, player]));
  const motm = pickMotm(events, winnerTeamId, defensiveContributions, motmPlayers);
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

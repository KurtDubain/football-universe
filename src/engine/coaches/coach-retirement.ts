import { CoachBase, CoachState, CoachRetirement, CoachCandidate, CareerEntry } from '../../types/coach';
import { Trophy, TeamBase } from '../../types/team';
import { SeededRNG } from '../match/rng';
import { GameWorld } from '../season/season-manager';
import { generateFreshCoach, formatCandidateCoachId, deriveCoachBuffsFromStyle } from './coach-generator';

/**
 * Hard age cap. At or above this age, retirement is forced regardless of
 * the chance roll. Mirrors the player-retirement HARD_AGE_CAP convention.
 */
export const COACH_HARD_AGE_CAP = 72;

/** Below this age, retirement chance is exactly 0 (no early retirements). */
export const COACH_RETIREMENT_MIN_AGE = 60;

/** Per-season universe-wide cap on coach retirements (deferral logic). */
export const MAX_COACH_RETIREMENTS_PER_SEASON = 6;

/** Coach retirement-history cap (FIFO). */
export const COACH_RETIREMENT_HISTORY_CAP = 200;

/** Probability the candidate-pool path is taken when both options are available. */
export const COACH_REPLACEMENT_FROM_POOL_RATIO = 0.5;

/**
 * Probability a coach retires this season-end.
 *
 * Formula:
 *   if age < 60          → 0
 *   if age >= 72         → 1.0   (hard cap)
 *   else
 *     base = (age - 60) / 12
 *     base -= max(0, rating - 80) / 100   (legends play longer, Ferguson-style)
 *     return clamp(base, 0, 0.95)
 *
 * Examples (rating 75):
 *   age 60 → 0
 *   age 65 → 0.42
 *   age 68 → 0.67
 *   age 70 → 0.83
 *   age 72 → 1.00
 */
export function retireChance(age: number, rating: number): number {
  if (age < COACH_RETIREMENT_MIN_AGE) return 0;
  if (age >= COACH_HARD_AGE_CAP) return 1.0;
  let base = (age - COACH_RETIREMENT_MIN_AGE) / 12;
  base -= Math.max(0, rating - 80) / 100;
  return Math.max(0, Math.min(0.95, base));
}

/**
 * Per-coach retirement decision result. Internal to processCoachRetirements
 * — kept here so the per-season-cap sort can shuffle them around before
 * committing.
 */
type CoachRetirementCandidate = {
  coachId: string;
  base: CoachBase;
  state: CoachState;
  chance: number;
  forced: boolean; // true when age >= COACH_HARD_AGE_CAP
};

/**
 * Pick a replacement coach for a now-vacated team. 50/50 between consuming
 * the oldest entry from the candidate pool (a retired star player who's
 * eligible to coach) and generating a freshly-spawned coach.
 *
 * - Pool path:  consumes the OLDEST candidate (FIFO via array[0]). The new
 *               CoachBase id is `c-from-player-{uuid}`. Buffs derive from
 *               the candidate's style. Age 38-43 (freshly-retired player).
 * - Fresh path: counter-driven id `c-fresh-{N}`, random style, rating
 *               50-75, age 35-50.
 *
 * If the pool is empty, ALWAYS goes fresh regardless of the random roll.
 *
 * Mutates `world.coachCandidatePool` (returned via the result) ONLY for the
 * pool path; never mutates the input world directly.
 *
 * Caller is expected to:
 * - Add `result.coach` to `world.coachBases`
 * - Add `result.state` to `world.coachStates`
 * - Add `result.career` to `world.coachCareers[result.coach.id]`
 * - Bump `world.nextCoachIdCounter` to `result.nextCoachIdCounter`
 * - Replace `world.coachCandidatePool` with `result.coachCandidatePool`
 */
export function pickReplacement(
  teamId: string,
  team: TeamBase,
  seasonNumber: number,
  candidatePool: CoachCandidate[],
  nextCoachIdCounter: number,
  rng: SeededRNG,
): {
  source: 'candidate' | 'fresh';
  coach: CoachBase;
  state: CoachState;
  career: CareerEntry;
  coachCandidatePool: CoachCandidate[];
  nextCoachIdCounter: number;
} {
  const usePool = candidatePool.length > 0 && rng.next() < COACH_REPLACEMENT_FROM_POOL_RATIO;

  if (usePool) {
    // Consume oldest candidate (FIFO — array[0]).
    const cand = candidatePool[0];
    const remainingPool = candidatePool.slice(1);
    const coachId = formatCandidateCoachId(cand.uuid);
    const buffs = deriveCoachBuffsFromStyle(cand.style, rng);
    const coach: CoachBase = {
      id: coachId,
      name: cand.name,
      rating: cand.peakRating, // peak as base coaching rating
      style: cand.style,
      attackBuff: buffs.attackBuff,
      defenseBuff: buffs.defenseBuff,
      moraleBuff: buffs.moraleBuff,
      leagueBuff: buffs.leagueBuff,
      cupBuff: buffs.cupBuff,
      pressureResistance: buffs.pressureResistance,
      riskBias: buffs.riskBias,
      stabilityBuff: buffs.stabilityBuff,
      age: 38 + rng.nextInt(0, 5), // freshly-retired player → 38-43
    };
    const state: CoachState = {
      id: coachId,
      currentTeamId: teamId,
      isUnemployed: false,
      unemployedSince: null,
      contractEnd: seasonNumber + rng.nextInt(2, 4),
    };
    const career: CareerEntry = {
      teamId,
      teamName: team.name,
      fromSeason: seasonNumber,
      toSeason: null,
      fired: false,
      trophies: [],
    };
    return {
      source: 'candidate',
      coach,
      state,
      career,
      coachCandidatePool: remainingPool,
      nextCoachIdCounter, // not bumped — id derived from uuid
    };
  }

  // Fresh path
  const generated = generateFreshCoach(nextCoachIdCounter, rng);
  const state: CoachState = {
    id: generated.coach.id,
    currentTeamId: teamId,
    isUnemployed: false,
    unemployedSince: null,
    contractEnd: seasonNumber + rng.nextInt(2, 4),
  };
  const career: CareerEntry = {
    teamId,
    teamName: team.name,
    fromSeason: seasonNumber,
    toSeason: null,
    fired: false,
    trophies: [],
  };
  return {
    source: 'fresh',
    coach: generated.coach,
    state,
    career,
    coachCandidatePool: candidatePool,
    nextCoachIdCounter: nextCoachIdCounter + 1,
  };
}

/**
 * Process coach retirements + replacements for a season-end pass.
 *
 * IMMUTABLE wrt the input world. Returns fresh records (coachStates,
 * coachBases additions, coachCareers updates, candidate pool, retirement
 * history). Caller (season-end) wires the patch.
 *
 * Pipeline:
 *  1. Roll retire chance for every CURRENTLY-ASSIGNED coach (skip
 *     unemployed coaches — they stay in the wider unemployment pool to
 *     be available for hire). Mark forced retirees (age >= 72).
 *  2. Per-season cap: if more than MAX_COACH_RETIREMENTS_PER_SEASON would
 *     retire, keep the top-N by chance (forced first, then by chance desc).
 *  3. For each retirement: build a CoachRetirement record, close out the
 *     last open CareerEntry (set toSeason, fired=false), and immediately
 *     pick a replacement so the team is never coach-less.
 *
 * NOTE: ages are NOT incremented inside this function. The caller is
 * expected to bump every coach's age separately at season-end (so freshly-
 * generated coaches don't immediately age twice).
 */
export function processCoachRetirements(
  world: GameWorld,
  rng: SeededRNG,
): {
  coachStates: Record<string, CoachState>;
  newCoachBases: Record<string, CoachBase>;
  coachCareers: Record<string, CareerEntry[]>;
  coachCandidatePool: CoachCandidate[];
  retirements: CoachRetirement[];
  newHires: Array<{ teamId: string; coach: CoachBase; source: 'candidate' | 'fresh'; replacedCoachId: string }>;
  nextCoachIdCounter: number;
} {
  const seasonNumber = world.seasonState.seasonNumber;

  // Defensive copies — every write below targets these locals, never world.X.
  const coachStates: Record<string, CoachState> = { ...world.coachStates };
  const coachCareers: Record<string, CareerEntry[]> = { ...world.coachCareers };
  const newCoachBases: Record<string, CoachBase> = {};
  let coachCandidatePool: CoachCandidate[] = [...(world.coachCandidatePool ?? [])];
  let nextCoachIdCounter = world.nextCoachIdCounter ?? 0;
  const retirements: CoachRetirement[] = [];
  const newHires: Array<{ teamId: string; coach: CoachBase; source: 'candidate' | 'fresh'; replacedCoachId: string }> = [];

  // ── Step 1: Roll chance per assigned coach ──
  const candidates: CoachRetirementCandidate[] = [];
  for (const [coachId, state] of Object.entries(world.coachStates)) {
    if (!state || state.currentTeamId == null) continue; // skip unemployed
    const base = world.coachBases[coachId];
    if (!base) continue;
    const age = base.age ?? 50;
    if (age < COACH_RETIREMENT_MIN_AGE) continue; // fast path
    const forced = age >= COACH_HARD_AGE_CAP;
    const chance = retireChance(age, base.rating);
    const roll = rng.next();
    if (forced || roll < chance) {
      candidates.push({ coachId, base, state, chance, forced });
    }
  }

  // ── Step 2: Per-season cap ──
  // Forced retirees always count; among non-forced, keep highest chance first.
  const forcedList = candidates.filter((c) => c.forced);
  const optional = candidates.filter((c) => !c.forced).sort((a, b) => b.chance - a.chance);
  const finalList = [...forcedList, ...optional].slice(0, MAX_COACH_RETIREMENTS_PER_SEASON);

  // ── Step 3: For each retirement, build records + replacement ──
  for (const cand of finalList) {
    const { coachId, base, state } = cand;
    const teamId = state.currentTeamId!;
    const team = world.teamBases[teamId];
    if (!team) continue;

    // Close out the last open career entry (set toSeason, fired=false).
    const careerList = [...(coachCareers[coachId] ?? [])];
    if (careerList.length > 0) {
      const last = careerList[careerList.length - 1];
      if (last && last.toSeason === null) {
        careerList[careerList.length - 1] = { ...last, toSeason: seasonNumber, fired: false };
      }
    }
    coachCareers[coachId] = careerList;

    // Career length = sum of seasons spanned across all entries (closed +
    // soon-to-close). Use a defensive cap of 1 (career start = retire
    // season → still counts as 1 season).
    const totalSeasons = careerList.reduce((acc, e) => {
      const start = e.fromSeason ?? seasonNumber;
      const end = e.toSeason ?? seasonNumber;
      return acc + Math.max(1, end - start + 1);
    }, 0);

    // Trophy snapshot — clone so future mutations don't leak in.
    const trophies: Trophy[] = [...(world.coachTrophies?.[coachId] ?? [])];

    // Mark this coach as retired in coachStates: clear team, mark unemployed,
    // AND set the retired flag so `hireNewCoach` skips them. Without the
    // retired flag, the existing contract-expiry / firing pipeline would
    // happily re-hire them next season — they'd cycle "retire → re-hired
    // → retire again" indefinitely.
    coachStates[coachId] = {
      ...state,
      currentTeamId: null,
      isUnemployed: true,
      unemployedSince: seasonNumber,
      retired: true,
    };

    // Retirement record. `fromPlayer` is true when the coachId looks like
    // `c-from-player-…` — those came from the candidate pool.
    const fromPlayer = coachId.startsWith('c-from-player-');
    const retirement: CoachRetirement = {
      id: coachId,
      name: base.name,
      age: base.age ?? 0,
      seasonRetired: seasonNumber,
      totalSeasons,
      trophies,
      finalTeamId: teamId,
      finalTeamName: team.name,
      fromPlayer,
    };
    retirements.push(retirement);

    // Pick replacement immediately so the team is never coach-less.
    const replacement = pickReplacement(
      teamId, team, seasonNumber, coachCandidatePool, nextCoachIdCounter, rng,
    );
    coachCandidatePool = replacement.coachCandidatePool;
    nextCoachIdCounter = replacement.nextCoachIdCounter;
    newCoachBases[replacement.coach.id] = replacement.coach;
    coachStates[replacement.coach.id] = replacement.state;
    coachCareers[replacement.coach.id] = [
      ...(coachCareers[replacement.coach.id] ?? []),
      replacement.career,
    ];
    newHires.push({
      teamId,
      coach: replacement.coach,
      source: replacement.source,
      replacedCoachId: coachId,
    });
  }

  return {
    coachStates,
    newCoachBases,
    coachCareers,
    coachCandidatePool,
    retirements,
    newHires,
    nextCoachIdCounter,
  };
}

import { CoachBase, CoachState, CareerEntry } from '../../types/coach';
import { TeamBase } from '../../types/team';
import { SeededRNG } from '../match/rng';

/**
 * Find the best available coach for a team.
 * Considers:
 * - Coach rating vs team expectation match
 * - Available coaches only (isUnemployed = true)
 * - If no good coaches available, generate a "caretaker" placeholder
 * Returns the selected coach ID and creates career entry.
 */
export function hireNewCoach(
  team: TeamBase,
  availableCoaches: { base: CoachBase; state: CoachState }[],
  seasonNumber: number,
  rng: SeededRNG,
): { coachId: string; careerEntry: CareerEntry } {
  const unemployed = availableCoaches.filter((c) => c.state.isUnemployed);

  if (unemployed.length === 0) {
    // Generate a caretaker coach
    const caretakerId = `caretaker_${team.id}_s${seasonNumber}`;
    return {
      coachId: caretakerId,
      careerEntry: {
        teamId: team.id,
        teamName: team.name,
        fromSeason: seasonNumber,
        toSeason: null,
        fired: false,
        trophies: [],
      },
    };
  }

  // Score each available coach by fit for this team
  const scored = unemployed.map((c) => {
    const ratingFit = scoreRatingFit(c.base.rating, team.expectation);
    // Add a small random factor so ties are broken unpredictably
    const randomFactor = rng.nextFloat(-5, 5);
    return {
      coach: c,
      score: ratingFit + randomFactor,
    };
  });

  // Sort by score descending, pick best
  scored.sort((a, b) => b.score - a.score);
  const selected = scored[0].coach;

  return {
    coachId: selected.base.id,
    careerEntry: {
      teamId: team.id,
      teamName: team.name,
      fromSeason: seasonNumber,
      toSeason: null,
      fired: false,
      trophies: [],
    },
  };
}

/**
 * Process a coach firing: update old coach state, find new coach.
 */
export function processCoachFiring(
  teamId: string,
  firedCoachId: string,
  team: TeamBase,
  allCoaches: { base: CoachBase; state: CoachState }[],
  seasonNumber: number,
  rng: SeededRNG,
): {
  newCoachId: string;
  firedCoachUpdate: Partial<CoachState>;
  newCoachUpdate: Partial<CoachState>;
  newCareerEntry: CareerEntry;
  firedCareerUpdate: { toSeason: number; fired: boolean };
} {
  // Exclude the fired coach from available pool
  const availableCoaches = allCoaches.filter(
    (c) => c.base.id !== firedCoachId,
  );

  const { coachId: newCoachId, careerEntry: newCareerEntry } = hireNewCoach(
    team,
    availableCoaches,
    seasonNumber,
    rng,
  );

  return {
    newCoachId,
    firedCoachUpdate: {
      currentTeamId: null,
      isUnemployed: true,
      unemployedSince: seasonNumber,
    },
    newCoachUpdate: {
      currentTeamId: teamId,
      isUnemployed: false,
      unemployedSince: null,
    },
    newCareerEntry,
    firedCareerUpdate: {
      toSeason: seasonNumber,
      fired: true,
    },
  };
}

/**
 * Score how well a coach's rating fits a team's expectation level.
 * Higher score = better fit. Penalises overqualified and underqualified matches.
 *
 * Expectation 1 (low) -> ideal rating ~40-55
 * Expectation 2       -> ideal rating ~50-65
 * Expectation 3       -> ideal rating ~60-75
 * Expectation 4       -> ideal rating ~70-85
 * Expectation 5 (top) -> ideal rating ~80-95
 */
function scoreRatingFit(coachRating: number, teamExpectation: number): number {
  const idealCenter = 35 + teamExpectation * 12; // 47, 59, 71, 83, 95
  const diff = Math.abs(coachRating - idealCenter);

  // Base score from closeness to ideal (max 50, decays with distance)
  const fitScore = Math.max(0, 50 - diff * 1.5);

  // Bonus for raw quality (better coaches are always somewhat desirable)
  const qualityBonus = coachRating * 0.2;

  return fitScore + qualityBonus;
}

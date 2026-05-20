import { Trophy } from './team';

export type CoachStyle = 'attacking' | 'defensive' | 'balanced' | 'possession' | 'counter';

export interface CoachBase {
  id: string;
  name: string;
  rating: number;  // 1-100
  style: CoachStyle;
  attackBuff: number;      // -5 to +15
  defenseBuff: number;     // -5 to +15
  moraleBuff: number;      // -3 to +10
  leagueBuff: number;      // 0 to +10
  cupBuff: number;         // 0 to +10
  pressureResistance: number; // 0-100
  riskBias: number;        // -10 to +10
  stabilityBuff: number;   // -5 to +10
  /**
   * Coach age (years). Introduced in v12. The retirement engine increments
   * this field at every season-end and uses it (alongside rating) to roll
   * retirement chance. Legacy v11 saves get this field backfilled by
   * `applyV11ToV12CoachAge` — a deterministic uuid-hash → [35, 65] band.
   * Hard retirement cap at 72.
   */
  age: number;
}

export interface CoachState {
  id: string;
  currentTeamId: string | null;
  isUnemployed: boolean;
  unemployedSince: number | null;
  contractEnd?: number;
  /**
   * Set true when the coach has hung up their boots via the coach-retirement
   * pipeline. Retired coaches stay in `coachStates` (so historical
   * SeasonRecord refs keep resolving) but must NOT be re-hired by
   * `hireNewCoach`. Without this flag, they'd cycle: retire → marked
   * isUnemployed=true → next contract-expiry hires them → retire again.
   * Introduced in v12 alongside the coach lifecycle.
   */
  retired?: boolean;
}

export interface CareerEntry {
  teamId: string;
  teamName: string;
  fromSeason: number;
  toSeason: number | null; // null if still there
  fired: boolean;
  trophies: Trophy[];
}

/**
 * Pool entry for a recently-retired star player who is eligible to become
 * a future coach. Seeded by the retirement engine — the candidate inherits
 * their playing peakRating as a base coaching rating, and a tactical style
 * derived from their playing position. Lives on `world.coachCandidatePool`.
 *
 * The pool is FIFO with a hard cap (12). Phase A3 will consume from this
 * pool when an unemployed coach slot opens up.
 */
export interface CoachCandidate {
  /** Re-uses the retired player's uuid, so legacy references still resolve. */
  uuid: string;
  name: string;
  fromTeamId: string;
  /** Player's peak — becomes their starting coach rating in A3. */
  peakRating: number;
  enteredPoolSeason: number;
  style: CoachStyle;
}

/**
 * A retired coach. Captured at the season-end moment of retirement by the
 * coach-retirement engine. Mirrors `PlayerRetirement` shape so /legends can
 * render both with the same card primitives.
 *
 * `id` matches the retired CoachBase.id — historical references in
 * coachCareers / coachTrophies / honor records keep resolving. The coach is
 * NOT removed from world.coachBases; they're simply no longer assigned to
 * any team and no longer eligible to be re-hired.
 *
 * `fromPlayer` is true when the coach originated from the candidate pool —
 * "retired star player → coach → retired coach" full lifecycle.
 */
export interface CoachRetirement {
  id: string;
  name: string;
  age: number;           // age at retirement
  seasonRetired: number;
  totalSeasons: number;  // career length (sum of seasons across CareerEntry list)
  trophies: Trophy[];    // career trophies (snapshot at retirement)
  finalTeamId: string;
  finalTeamName: string;
  fromPlayer?: boolean;  // true if originated from candidate pool
}

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
}

export interface CoachState {
  id: string;
  currentTeamId: string | null;
  isUnemployed: boolean;
  unemployedSince: number | null;
  contractEnd?: number;
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

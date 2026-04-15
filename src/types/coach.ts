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
  unemployedSince: number | null; // season number
}

export interface CareerEntry {
  teamId: string;
  teamName: string;
  fromSeason: number;
  toSeason: number | null; // null if still there
  fired: boolean;
  trophies: Trophy[];
}

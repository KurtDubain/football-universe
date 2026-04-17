export interface LeagueConfig {
  id: string;
  name: string;
  level: 1 | 2 | 3;
  teamCount: number;
  rounds: number; // total rounds (double round-robin)
  directPromotion: number;
  directRelegation: number;
  playoffPromotion: number;
  playoffRelegation: number;
}

export interface StandingEntry {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form: ('W' | 'D' | 'L')[];
  previousPosition?: number;
}

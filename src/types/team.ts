export interface TeamBase {
  id: string;
  name: string;
  shortName: string;
  color: string; // hex color for UI accent
  // base attributes 0-100
  overall: number;
  attack: number;
  midfield: number;
  defense: number;
  stability: number;
  depth: number;
  reputation: number;
  initialLeagueLevel: 1 | 2 | 3;
  expectation: number; // 1-5
}

export interface TeamState {
  id: string;
  leagueLevel: 1 | 2 | 3;
  morale: number;       // 0-100, default 60
  fatigue: number;      // 0-100, higher=more tired, default 10
  momentum: number;     // -10 to +10, default 0
  squadHealth: number;  // 0-100, default 85
  coachPressure: number; // 0-100, default 10
  currentCoachId: string | null;
  recentForm: ('W' | 'D' | 'L')[];  // last 5 results
}

export interface SeasonRecord {
  seasonNumber: number;
  leagueLevel: 1 | 2 | 3;
  leaguePosition: number;
  leaguePlayed: number;
  leagueWon: number;
  leagueDrawn: number;
  leagueLost: number;
  leagueGF: number;
  leagueGA: number;
  leaguePoints: number;
  cupResult?: string;
  superCupResult?: string;
  worldCupResult?: string;
  coachId: string;
  promoted: boolean;
  relegated: boolean;
}

export interface Trophy {
  type: 'league1' | 'league2' | 'league3' | 'league_cup' | 'super_cup' | 'world_cup';
  seasonNumber: number;
}

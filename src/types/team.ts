export type TeamTier = 'elite' | 'strong' | 'mid' | 'lower' | 'underdog';

export interface TeamBase {
  id: string;
  name: string;
  shortName: string;
  color: string;
  tier: TeamTier;
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
  region: string; // "大洲+地区" format, e.g. "大陆+北京"
}

export interface TeamState {
  id: string;
  leagueLevel: 1 | 2 | 3;
  morale: number;       // 0-100, default 60
  fatigue: number;      // 0-100, higher=more tired, default 10
  momentum: number;     // -10 to +10, default 0
  squadHealth: number;  // 0-100, default 85
  coachPressure: number; // 0-100, default 10
  // NOTE: `currentCoachId` was removed in v7 in favour of a derived lookup.
  // The single source of truth is now `coachStates[coachId].currentTeamId`.
  // Use `getTeamCoachId(coachStates, teamId)` from
  // `src/engine/coaches/coach-lookup.ts` to resolve "who coaches team X?".
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
  /**
   * Continental cup result — one of '冠军' | '亚军' | '四强' | '八强' | '16强' |
   * '未参加'. Populated only in odd seasons when the team's region had a
   * continental cup running. Off-year rows leave it undefined; the UI
   * displays '—' for those.
   */
  continentalCupResult?: string;
  coachId: string;
  teamOverall?: number; // team OVR at end of season
  promoted: boolean;
  relegated: boolean;
}

export interface Trophy {
  type: 'league1' | 'league2' | 'league3' | 'league_cup' | 'super_cup' | 'world_cup' | 'mainland_cup' | 'southern_cup' | 'eastern_cup';
  seasonNumber: number;
}

export type CompetitionType = 'league' | 'league_cup' | 'super_cup' | 'super_cup_group' | 'world_cup' | 'world_cup_group' | 'relegation_playoff';

export interface MatchFixture {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  competitionType: CompetitionType;
  competitionName: string;
  roundLabel: string;
  leg?: 1 | 2; // for two-legged ties
  firstLegResult?: { home: number; away: number }; // for second legs
}

export interface MatchEvent {
  minute: number;
  type: 'goal' | 'assist' | 'yellow_card' | 'red_card' | 'save' | 'miss' | 'penalty_goal' | 'penalty_miss' | 'own_goal';
  teamId: string;
  description: string;
}

export interface MatchStats {
  possession: [number, number]; // home%, away%
  shots: [number, number];
  shotsOnTarget: [number, number];
  corners: [number, number];
  fouls: [number, number];
  yellowCards: [number, number];
  redCards: [number, number];
}

export interface MatchResult {
  fixtureId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeGoals: number;
  awayGoals: number;
  extraTime: boolean;
  etHomeGoals?: number;
  etAwayGoals?: number;
  penalties: boolean;
  penaltyHome?: number;
  penaltyAway?: number;
  events: MatchEvent[];
  stats: MatchStats;
  competitionType: CompetitionType;
  competitionName: string;
  roundLabel: string;
  motm?: string; // man of the match description
}

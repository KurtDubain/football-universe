import { MatchFixture, MatchResult } from './match';

export type WindowType = 'league' | 'league_cup' | 'super_cup' | 'super_cup_group' | 'relegation_playoff' | 'season_end' | 'world_cup' | 'world_cup_group' | 'pre_season';

export interface CalendarWindow {
  id: number;
  type: WindowType;
  label: string;
  description: string;
  fixtures: MatchFixture[];
  completed: boolean;
  results: MatchResult[];
}

export interface SeasonState {
  seasonNumber: number;
  currentWindowIndex: number;
  calendar: CalendarWindow[];
  completed: boolean;
  isWorldCupYear: boolean;
  worldCupPhase: boolean; // true when in world cup phase after season
  awards?: SeasonAwards;
}

export interface SeasonAwards {
  league1Champion?: string;
  league2Champion?: string;
  league3Champion?: string;
  leagueCupWinner?: string;
  superCupWinner?: string;
  worldCupWinner?: string;
  promoted: string[];
  relegated: string[];
}

import { StandingEntry } from './league';

export interface CupFixture {
  id: string;
  round: number;
  roundName: string;
  homeTeamId: string;
  awayTeamId: string;
  /** The team slots are labels only; neither side receives home advantage. */
  isNeutralVenue?: boolean;
  /** World Cup host identity; applies a separate tournament boost to this team only. */
  tournamentHostTeamId?: string;
  result?: { home: number; away: number; extraTime?: boolean; penalties?: boolean; penHome?: number; penAway?: number };
  winnerId?: string;
}

export interface CupState {
  name: string;
  type: 'league_cup' | 'super_cup' | 'world_cup' | 'mainland_cup' | 'southern_cup' | 'eastern_cup';
  rounds: CupRound[];
  currentRound: number;
  completed: boolean;
  winnerId?: string;
}

/**
 * Continental cups run in S5, S11, S17... and use a neutral-venue group
 * stage followed by a compact knockout. `rounds` contains knockout rounds
 * only so shared bracket, prize and elimination helpers remain authoritative.
 */
export type CupRegion = '大陆' | '南洲' | '东洲';
export interface ContinentalCupState extends CupState {
  region: CupRegion;
  groups: SuperCupGroup[];
  groupStageCompleted: boolean;
  participantIds: string[];
  /** Coefficient seed order, used for draw pots and the final group tie-break. */
  qualificationOrder: string[];
}

export interface CupRound {
  roundNumber: number;
  roundName: string;
  fixtures: CupFixture[];
  completed: boolean;
}

export interface SuperCupGroup {
  groupName: string; // 'A', 'B', 'C', 'D'
  teamIds: string[];
  standings: StandingEntry[];
  fixtures: CupFixture[];
}

export interface SuperCupState {
  groups: SuperCupGroup[];
  knockoutRounds: CupRound[];
  groupStageCompleted: boolean;
  completed: boolean;
  winnerId?: string;
  awayGoalRule: boolean;
}

export interface WorldCupState {
  groups: SuperCupGroup[];
  knockoutRounds: CupRound[];
  groupStageCompleted: boolean;
  completed: boolean;
  winnerId?: string;
  participantIds: string[];
  /** Optional so an active legacy save remains readable; all new editions set it. */
  hostTeamId?: string;
}

export interface WorldCupEdition {
  seasonNumber: number;
  hostTeamId: string;
  announcedSeasonNumber: number;
  winnerId?: string;
  runnerUpId?: string;
  hostResult?: string;
}

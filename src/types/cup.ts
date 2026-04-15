import { StandingEntry } from './league';

export interface CupFixture {
  id: string;
  round: number;
  roundName: string;
  homeTeamId: string;
  awayTeamId: string;
  result?: { home: number; away: number; extraTime?: boolean; penalties?: boolean; penHome?: number; penAway?: number };
  winnerId?: string;
}

export interface CupState {
  name: string;
  type: 'league_cup' | 'super_cup' | 'world_cup';
  rounds: CupRound[];
  currentRound: number;
  completed: boolean;
  winnerId?: string;
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
}

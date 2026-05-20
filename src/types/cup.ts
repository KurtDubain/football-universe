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
  type: 'league_cup' | 'super_cup' | 'world_cup' | 'mainland_cup' | 'southern_cup' | 'eastern_cup';
  rounds: CupRound[];
  currentRound: number;
  completed: boolean;
  winnerId?: string;
}

/**
 * Continental cups (Phase C) — three intra-continent knockouts that run every
 * other (odd) season:
 *   大陆杯 / mainland_cup — 16 teams (R16 → QF → SF → Final)
 *   南洲杯 / southern_cup — 8 teams (QF → SF → Final)
 *   东洲杯 / eastern_cup  — 8 teams (QF → SF → Final)
 *
 * The shape extends `CupState` so existing bracket-rendering logic and the
 * Cup page work without bifurcation. `region` is carried so news / UI can
 * label the cup without re-deriving from `type`.
 */
export type CupRegion = '大陆' | '南洲' | '东洲';
export interface ContinentalCupState extends CupState {
  region: CupRegion;
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

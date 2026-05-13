export type PlayerPosition = 'GK' | 'DF' | 'MF' | 'FW';

export interface Player {
  id: string;          // teamId-number, e.g. "real_madrid-7"
  teamId: string;
  name: string;        // assigned by region pool, e.g. "张伟"
  number: number;      // shirt number
  position: PlayerPosition;
  rating: number;      // 40-99
  goalScoring: number; // 0-100, chance weight for being picked as scorer
  marketValue: number; // in millions, e.g. 85 for €85M
  age: number;         // simulated age, increments each season
}

export interface PlayerSeasonStats {
  playerId: string;
  teamId: string;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  appearances: number;
}

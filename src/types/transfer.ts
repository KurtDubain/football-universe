/**
 * Player transfer records.
 * Tracked at end of each season; shown in /transfers and TeamDetail history.
 */

export type TransferType = 'transfer' | 'free' | 'loan';

export interface TransferRecord {
  season: number;
  windowIndex: number; // when the transfer was processed (typically last window)
  playerId: string;
  playerName: string;
  playerNumber: number;
  position: 'GK' | 'DF' | 'MF' | 'FW';
  fromTeamId: string;
  fromTeamName: string;
  toTeamId: string;
  toTeamName: string;
  type: TransferType;
  fee?: number;        // in millions, optional
  reason: string;      // human-readable e.g. "强援加盟", "自由转会"
}

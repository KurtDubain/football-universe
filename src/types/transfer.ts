/**
 * Player transfer records.
 * Tracked at end of each season; shown in /transfers and TeamDetail history.
 */

export type TransferType = 'transfer' | 'free' | 'loan' | 'free_agent';

export interface TransferRecord {
  season: number;
  windowIndex: number; // when the transfer was processed (typically last window)
  /** Holds a Player.uuid value (stable across transfers). */
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

// ── Phase 2 — favorite team transfer window ──

/**
 * Status of a single offer/target as the user works through the window.
 * Only items still 'pending' show action buttons in /market UI.
 */
export type WindowItemResolution =
  | 'pending'
  | 'accepted'    // incoming offer accepted (your player sold)
  | 'rejected'    // incoming offer declined
  | 'countered_accepted'  // counter-offer worked, sold at higher fee
  | 'countered_rejected'  // counter-offer failed, you kept the player
  | 'bid_accepted'  // outbound bid was accepted, you bought
  | 'bid_rejected'  // outbound bid declined
  | 'skipped';      // outbound target you didn't pursue

export interface IncomingOffer {
  id: string;
  playerId: string;         // YOUR player
  playerName: string;
  playerPosition: 'GK' | 'DF' | 'MF' | 'FW';
  playerRating: number;
  ownerTeamId: string;      // your favorite team that owns the player
  ownerTeamName: string;
  buyerId: string;          // elite team making the offer
  buyerName: string;
  fee: number;              // offered fee (€M)
  counterFee?: number;      // if user countered, what they asked
  resolution: WindowItemResolution;
}

export interface OutgoingTarget {
  id: string;
  playerId: string;         // THEIR player you might want
  playerName: string;
  playerPosition: 'GK' | 'DF' | 'MF' | 'FW';
  playerRating: number;
  fromTeamId: string;       // current owner
  fromTeamName: string;
  toTeamId: string;         // your favorite team that would buy
  suggestedFee: number;     // engine's guess of what's needed
  bidFee?: number;          // if user bid, what they offered
  resolution: WindowItemResolution;
}

/**
 * Active transfer window state. Lives on `world.transferWindow` from
 * the moment season-end fires until the user clicks "完成". Other
 * teams' transfers happen automatically during season-end; only
 * favorite teams' moves are pending here.
 */
export interface TransferWindowState {
  season: number;
  status: 'open' | 'closed';
  incomingOffers: IncomingOffer[];
  outgoingTargets: OutgoingTarget[];
  /** Snapshot of free agent pool at window open. Filtered out as user signs. */
  freeAgentUuids: string[];
  /** uuids already signed from the pool — UI greys these out. */
  signedFromPool: string[];
}

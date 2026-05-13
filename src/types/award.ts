/**
 * End-of-season individual player awards.
 * Computed from playerStats + league standings at season end.
 */

export type PlayerAwardType =
  | 'mvp'           // 金球奖 — best overall
  | 'golden_boot'   // 金靴奖 — most goals
  | 'best_defender' // 最佳后卫
  | 'young_player'; // 最佳新星 — top scorer in low-tier team

export interface PlayerAward {
  season: number;
  type: PlayerAwardType;
  playerId: string;
  playerName: string;
  playerNumber: number;
  teamId: string;
  teamName: string;
  /** Stat that won the award (goals, defensive rating, etc.) */
  statValue: number;
  /** Short human description, e.g. "32球", "仅失18球", "OVR 65" */
  statLabel: string;
}

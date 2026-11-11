/**
 * End-of-season individual player awards.
 * Computed from playerStats + league standings at season end.
 *
 * Coefficients live in `src/engine/awards/award-weights.ts`; the rationale is
 * in `docs/award-system-redesign.md`.
 */

export type PlayerAwardType =
  | 'mvp'              // 金球奖 — best overall, team-achievement weighted
  | 'golden_boot'      // 金靴奖 — most goals, tier weighted
  | 'best_forward'     // 最佳前锋
  | 'best_midfielder'  // 最佳中场
  | 'best_defender'    // 最佳后卫
  | 'best_goalkeeper'  // 最佳门将
  | 'young_player';    // 最佳新星 — best under-23 season

export interface PlayerAward {
  season: number;
  type: PlayerAwardType;
  /** Holds a Player.uuid value (stable across transfers). */
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

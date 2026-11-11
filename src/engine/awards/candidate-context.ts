import type { Player, PlayerSeasonStats, PlayerTeamSeasonStats } from '../../types/player';
import {
  computePlayerPerformance,
  computeSegmentedPlayerPerformance,
  type PlayerPerformanceResult,
} from '../players/player-performance';
import type { LeagueTier } from './award-weights';

/**
 * Lookup helpers shared by the real award computation and the buzz projection.
 *
 * Both need the same three things — resolve a uuid to a Player, score a stat
 * row with the segmented (multi-club) path when it exists, and read minutes and
 * tier the same way. Keeping one implementation is what stops the projection
 * from drifting away from the award it claims to forecast.
 */
export interface CandidateContext {
  findPlayer: (playerUuid: string) => Player | undefined;
  performanceFor: (player: Player, stat: PlayerSeasonStats) => PlayerPerformanceResult;
  minutesOf: (stat: PlayerSeasonStats) => number;
  levelOf: (teamId: string) => LeagueTier;
}

export function createCandidateContext(
  squads: Record<string, Player[]>,
  playerStatSegments: Record<string, PlayerTeamSeasonStats>,
  seasonStartLevels: Record<string, LeagueTier>,
): CandidateContext {
  // playerId is a stable Player.uuid, not the legacy `${teamId}-${number}`
  // string. Build both indexes once instead of rescanning the whole league for
  // every stat row — the previous lookup rebuilt an ~800-element array per call,
  // and the segment filter rescanned every segment per player.
  const playerByUuid = new Map<string, Player>();
  for (const squad of Object.values(squads)) {
    for (const player of squad) {
      if (!playerByUuid.has(player.uuid)) playerByUuid.set(player.uuid, player);
    }
  }

  const segmentsByPlayer = new Map<string, PlayerTeamSeasonStats[]>();
  for (const segment of Object.values(playerStatSegments)) {
    const existing = segmentsByPlayer.get(segment.playerId);
    if (existing) existing.push(segment);
    else segmentsByPlayer.set(segment.playerId, [segment]);
  }

  return {
    findPlayer: (playerUuid: string) => playerByUuid.get(playerUuid),
    performanceFor: (player, stat) => {
      const segments = segmentsByPlayer.get(player.uuid);
      return segments && segments.length > 0
        ? computeSegmentedPlayerPerformance(player.position, segments, seasonStartLevels, stat)
        : computePlayerPerformance(player.position, stat, seasonStartLevels[stat.teamId]);
    },
    minutesOf: (stat) => stat.minutesPlayed ?? stat.appearances * 90,
    levelOf: (teamId) => seasonStartLevels[teamId] ?? 1,
  };
}

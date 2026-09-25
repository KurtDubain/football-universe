import type { GameWorld } from '../season/season-manager';
import { computePlayerCareerTotals } from './career-totals';
import { playerCareerAwards } from './player-honors';

export const RECENT_RETIREMENT_LIMIT = 300;

/** Preserve only compact facts for important people, plus the existing recent FIFO. */
export function retainPlayerArchives(world: GameWorld, followedIds: string[] = []): GameWorld['retirementHistory'] {
  const recentIds = new Set(world.retirementHistory.slice(-RECENT_RETIREMENT_LIMIT).map(player => player.uuid));
  const followed = new Set(followedIds);
  const awarded = new Set((world.playerAwardsHistory ?? []).map(award => award.playerId));
  return world.retirementHistory.flatMap(player => {
    const important = followed.has(player.uuid) || awarded.has(player.uuid) || player.careerSummary;
    if (!important) return recentIds.has(player.uuid) ? [player] : [];
    // Drop only redundant club snapshots; unmatched old facts remain readable.
    const { careerTrophies, ...identity } = player;
    const uniqueLegacyTrophies = careerTrophies?.filter(trophy => !(world.teamTrophies[player.teamId] ?? [])
      .some(known => known.type === trophy.type && known.seasonNumber === trophy.seasonNumber));
    const compact = { ...identity, ...(uniqueLegacyTrophies?.length ? { careerTrophies: uniqueLegacyTrophies } : {}) };
    const existing = player.careerSummary;
    if (existing) return [{ ...compact, careerSummary: {
      ...existing,
      followed: existing.followed || followed.has(player.uuid),
      awards: playerCareerAwards(world, player.uuid),
    } }];
    const teams = new Map<string, { teamId: string; teamName: string; seasons: number[] }>();
    const addTeam = (teamId: string, teamName: string, season: number) => {
      const entry = teams.get(teamId) ?? { teamId, teamName, seasons: [] };
      if (!entry.seasons.includes(season)) entry.seasons.push(season);
      teams.set(teamId, entry);
    };
    for (const row of world.playerStatsHistory?.[player.uuid] ?? []) {
      addTeam(row.teamId, row.teamName ?? world.teamBases[row.teamId]?.name ?? row.teamId, row.season);
    }
    for (const transfer of world.transferHistory ?? []) {
      if (transfer.playerId !== player.uuid) continue;
      addTeam(transfer.fromTeamId, transfer.fromTeamName, transfer.season);
      addTeam(transfer.toTeamId, transfer.toTeamName, transfer.season);
    }
    addTeam(player.teamId, player.teamName, player.seasonRetired);
    return [{ ...compact, careerSummary: {
      followed: followed.has(player.uuid),
      awards: playerCareerAwards(world, player.uuid),
      totals: computePlayerCareerTotals(world, player.uuid),
      teams: [...teams.values()].map(team => ({ ...team, seasons: team.seasons.sort((a, b) => a - b) })),
    } }];
  });
}

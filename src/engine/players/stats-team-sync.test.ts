import { describe, it, expect } from 'vitest';
import { syncPlayerStatsTeamIds } from './stats';
import type { Player, PlayerSeasonStats } from '../../types/player';

/**
 * v23.1 regression: ensure stat.teamId is reconciled to match the live
 * squad after a manual transfer (or any other path that mutates squads
 * without going through the stat-sync routine).
 *
 * Why this matters: many UI surfaces group player stats by teamId
 * (top-scorer-per-team, season awards, team contribution %). A stale
 * teamId field misattributes the transferred player to their OLD team,
 * which the user reported as "好多地方的数据对不上".
 */

function mkStat(uuid: string, teamId: string, goals = 0): PlayerSeasonStats {
  return {
    playerId: uuid, teamId, goals, assists: 0,
    yellowCards: 0, redCards: 0, appearances: 30,
    cleanSheets: 0, saves: 0, keyBlocks: 0,
    bigChances: goals, keyPasses: 0,
  };
}

function mkPlayer(uuid: string, teamId: string): Player {
  return {
    uuid,
    teamId,
    number: 9,
    position: 'FW',
    rating: 80,
    name: uuid,
    age: 25,
  } as Player;
}

describe('syncPlayerStatsTeamIds', () => {
  it('updates stat.teamId when player is in a different squad', () => {
    const stats = {
      'p-1': mkStat('p-1', 'oldTeam', 10),
      'p-2': mkStat('p-2', 'unchanged', 5),
    };
    const squads = {
      newTeam: [mkPlayer('p-1', 'newTeam')],
      unchanged: [mkPlayer('p-2', 'unchanged')],
    };
    const out = syncPlayerStatsTeamIds(stats, squads);
    expect(out['p-1'].teamId).toBe('newTeam');
    expect(out['p-1'].goals).toBe(10); // counters preserved
    expect(out['p-2'].teamId).toBe('unchanged');
  });

  it('returns the same reference when nothing is stale (idempotent)', () => {
    const stats = {
      'p-1': mkStat('p-1', 'A', 3),
    };
    const squads = {
      A: [mkPlayer('p-1', 'A')],
    };
    const out = syncPlayerStatsTeamIds(stats, squads);
    expect(out).toBe(stats);
  });

  it('leaves stat rows alone when uuid no longer appears in any squad', () => {
    // Player retired or left the game world but their stats still
    // hang around (rare; usually pruned, but the helper should not
    // crash and should not invent a teamId).
    const stats = {
      'ghost': mkStat('ghost', 'graveyard', 100),
    };
    const squads = { A: [], B: [] };
    const out = syncPlayerStatsTeamIds(stats, squads);
    expect(out['ghost'].teamId).toBe('graveyard');
  });

  it('grouping by teamId is correct after sync (regression for top-scorer-per-team bug)', () => {
    // 小明 (p-1) was at oldTeam, transferred to newTeam mid-season,
    // accumulated 10 goals over the season. After sync, anyone
    // grouping stats by teamId should attribute them to newTeam.
    const stats = {
      'p-1': mkStat('p-1', 'oldTeam', 10),
      'p-other': mkStat('p-other', 'oldTeam', 3),
    };
    const squads = {
      oldTeam: [mkPlayer('p-other', 'oldTeam')],
      newTeam: [mkPlayer('p-1', 'newTeam')],
    };
    const synced = syncPlayerStatsTeamIds(stats, squads);
    const byTeam: Record<string, number> = {};
    for (const s of Object.values(synced)) {
      byTeam[s.teamId] = (byTeam[s.teamId] ?? 0) + s.goals;
    }
    expect(byTeam.newTeam).toBe(10); // p-1 goals counted under newTeam
    expect(byTeam.oldTeam).toBe(3);  // only p-other left in oldTeam
  });
});

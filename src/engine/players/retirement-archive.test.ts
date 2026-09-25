import { describe, expect, it } from 'vitest';
import { initializeGameWorld } from '../season/season-manager';
import { enforceStorageLimits } from '../season/storage-limits';
import { retainPlayerArchives } from './retirement-archive';
import { playerCareerAwards } from './player-honors';
import { buildPlayerNarrativeThread } from '../observation/narrative-threads';
import { computePlayerCareerTotals } from './career-totals';

function fixture() {
  const world = initializeGameWorld(20260709);
  const player = Object.values(world.squads).flat().find(player => player.position === 'DF')!;
  world.seasonState.seasonNumber = 5;
  world.retirementHistory = [{ uuid: player.uuid, name: player.name, teamId: player.teamId,
    teamName: world.teamBases[player.teamId].name, position: player.position,
    peakRating: 83, age: 36, seasonRetired: 4, careerGoals: 20 }];
  world.squads[player.teamId] = world.squads[player.teamId].filter(item => item.uuid !== player.uuid);
  world.playerAwardsHistory = [1, 2, 3].map(season => ({ season, type: 'mvp' as const,
    playerId: player.uuid, playerName: player.name, playerNumber: player.number,
    teamId: player.teamId, teamName: world.teamBases[player.teamId].name, statValue: 83, statLabel: '综合83' }));
  return { world, player };
}

describe('minimal retirement archives', () => {
  it('summarizes three Ballon dOr wins and merges same-season honors with specific evidence anchors', () => {
    const { world, player } = fixture();
    world.playerAwardsHistory.push({ ...world.playerAwardsHistory[0], type: 'best_defender' });
    const thread = buildPlayerNarrativeThread(world, player.uuid)!;
    expect(thread.summary).toContain('3届金球');
    expect(thread.entries.length).toBeLessThanOrEqual(4);
    expect(thread.entries[0].title).toContain('3届金球');
    expect(thread.entries.find(entry => entry.id.startsWith('first-award:'))?.detail).toContain('最佳后卫');
    expect(thread.entries.every(entry => entry.to?.startsWith(`/player/${player.uuid}#`))).toBe(true);
  });

  it('retains winners and observed retirees past the FIFO without retaining all retirees or mutating results', () => {
    const { world, player } = fixture();
    const template = world.retirementHistory[0];
    const followed = { ...template, uuid: 'followed', name: '已关注球员' };
    world.retirementHistory.push(followed, ...Array.from({ length: 305 }, (_, i) => ({ ...template, uuid: `ordinary-${i}` })));
    world.playerStats[player.uuid].appearances = 12;
    world.playerStats[player.uuid].minutesPlayed = 960;
    const original = JSON.stringify(world);
    const retirementHistory = retainPlayerArchives(world, [followed.uuid]);
    expect(JSON.stringify(world)).toBe(original);
    expect(retirementHistory).toHaveLength(302);
    const archivedWorld = { ...world, retirementHistory };
    expect(retainPlayerArchives(archivedWorld, [followed.uuid])).toEqual(retirementHistory);
    const old = retirementHistory.find(item => item.uuid === player.uuid)!;
    expect(old.careerSummary?.awards).toHaveLength(3);
    expect(old.careerSummary?.totals.minutesPlayed).toBe(960);
    expect(old.careerSummary?.totals.goals).toBe(20);
    // Simulate the normal rolling-history pruning, never a user's save.
    const future = enforceStorageLimits({ ...archivedWorld, playerStats: {}, playerStatsHistory: {},
      playerAwardsHistory: Array.from({ length: 51 }, (_, i) => ({ ...world.playerAwardsHistory[0], season: i + 10, playerId: `other-${i}` })),
      seasonState: { ...world.seasonState, seasonNumber: 61 } });
    expect(playerCareerAwards(future, player.uuid)).toHaveLength(3);
    expect(computePlayerCareerTotals(future, player.uuid).minutesPlayed).toBe(960);
    expect(buildPlayerNarrativeThread(future, player.uuid)?.summary).toContain('3届金球');
    expect(future.rngState).toBe(world.rngState);
    expect(future.seasonState.calendar).toBe(world.seasonState.calendar);
    expect(playerCareerAwards(JSON.parse(JSON.stringify(future)), player.uuid)).toHaveLength(3);
  });

  it('supports old sparse records without inventing a lost identity or title', () => {
    const { world, player } = fixture();
    world.playerAwardsHistory = [];
    world.playerStatsHistory = {};
    const rows = retainPlayerArchives(world, [player.uuid]);
    expect(rows[0].careerSummary?.awards).toEqual([]);
    expect(buildPlayerNarrativeThread({ ...world, retirementHistory: rows }, player.uuid)?.summary).not.toMatch(/金球|首次|从未/);
    expect(buildPlayerNarrativeThread({ ...world, retirementHistory: [] }, player.uuid)).toBeNull();
  });
});

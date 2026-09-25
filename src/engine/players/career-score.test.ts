import { describe, expect, it } from 'vitest';
import { initializeGameWorld } from '../season/season-manager';
import { enforceStorageLimits } from '../season/storage-limits';
import { playerCareerScore, preserveRetiredCareerScores } from './career-score';
import type { PlayerSeasonStatsHistoryEntry } from '../../types/player';
import { principalCareerHonor } from './player-honors';

function fixture() {
  const world = initializeGameWorld(20260709);
  const player = Object.values(world.squads).flat()[0];
  world.seasonState.seasonNumber = 9;
  world.retirementHistory = [{ uuid: player.uuid, name: player.name, teamId: player.teamId,
    teamName: world.teamBases[player.teamId].name, position: player.position, peakRating: 93,
    age: 36, seasonRetired: 8, careerGoals: 0 }];
  world.playerStatsHistory[player.uuid] = Array.from({ length: 8 }, (_, i): PlayerSeasonStatsHistoryEntry => ({
    season: i + 1, teamId: player.teamId, appearances: 10, minutesPlayed: 900, goals: 0, assists: 0,
    yellowCards: 0, redCards: 0, seasonScore: i < 4 ? 80 : 60,
    position: player.position, teamGoalsConceded: 10, teamMatches: 10,
  }));
  return { world, player };
}

describe('retired performance evidence', () => {
  it('freezes minute-weighted full recorded career before pruning, including when no details remain', () => {
    const { world, player } = fixture();
    const original = JSON.stringify(world);
    const retirementHistory = preserveRetiredCareerScores(world);
    expect(JSON.stringify(world)).toBe(original);
    const frozen = { ...world, retirementHistory };
    expect(playerCareerScore(frozen, player.uuid)).toEqual({ value: 70, label: '生涯评分' });
    frozen.playerStatsHistory.other = [{ ...world.playerStatsHistory[player.uuid][0], season: 40 }];
    const pruned = enforceStorageLimits(frozen);
    expect(pruned.playerStatsHistory[player.uuid]).toBeUndefined();
    expect(playerCareerScore(pruned, player.uuid)).toEqual({ value: 70, label: '生涯评分' });
    expect(preserveRetiredCareerScores(pruned)).toBe(pruned.retirementHistory);
    expect(playerCareerScore(JSON.parse(JSON.stringify(pruned)), player.uuid)).toEqual(playerCareerScore(frozen, player.uuid));
    expect(pruned.rngState).toBe(world.rngState);
    expect(pruned.seasonState).toBe(world.seasonState);
  });
  it('marks incomplete old archives honestly and does not freeze an unfinished retirement season', () => {
    const { world, player } = fixture();
    world.playerStatsHistory[player.uuid] = world.playerStatsHistory[player.uuid].slice(4);
    expect(playerCareerScore(world, player.uuid)).toEqual({ value: 60, label: '现存记录均分' });
    world.seasonState.seasonNumber = 8;
    expect(preserveRetiredCareerScores(world)).toBe(world.retirementHistory);
    world.seasonState.seasonNumber = 9;
    world.retirementHistory = preserveRetiredCareerScores(world);
    world.playerStatsHistory = {};
    expect(playerCareerScore(world, player.uuid)).toEqual({ value: 60, label: '现存记录均分' });
  });
  it('weights actual minutes and declines complete-career claims when a score is missing', () => {
    const { world, player } = fixture();
    world.playerStatsHistory[player.uuid][0].minutesPlayed = 1800;
    expect(playerCareerScore(world, player.uuid).value).toBeCloseTo(640 / 9);
    delete world.playerStatsHistory[player.uuid][0].seasonScore;
    expect(playerCareerScore(world, player.uuid).label).toBe('现存记录均分');
  });
  it('shows the most important deduplicated personal honor, not club trophies', () => {
    const { world, player } = fixture();
    expect(principalCareerHonor(world, player.uuid)).toBeNull();
    const award = { season: 1, type: 'mvp' as const, playerId: player.uuid, playerName: player.name,
      playerNumber: player.number, teamId: player.teamId, teamName: '球队', statValue: 80, statLabel: '80' };
    world.playerAwardsHistory = [award, award, { ...award, season: 2 }, { ...award, type: 'golden_boot' }];
    expect(principalCareerHonor(world, player.uuid)).toBe('2届金球');
  });
});

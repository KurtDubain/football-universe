import { describe, expect, it } from 'vitest';
import type { HonorRecord } from '../../types/honor';
import type { MatchResult } from '../../types/match';
import { emptyPlayerStat, playerTeamStatKey } from '../players/stats';
import { initializeGameWorld } from '../season/season-manager';
import {
  buildCoachNarrativeThread,
  buildPlayerNarrativeThread,
  buildTeamNarrativeThread,
  MAX_NARRATIVE_THREAD_ENTRIES,
} from './narrative-threads';

function honor(seasonNumber: number, champion: string): HonorRecord {
  return {
    seasonNumber,
    league1Champion: champion,
    league2Champion: champion,
    league3Champion: champion,
    leagueCupWinner: champion,
    superCupWinner: champion,
    promoted: [],
    relegated: [],
    coachChanges: [],
  };
}

function matchResult(teamId: string, opponentId: string, won: boolean, id: string): MatchResult {
  return {
    fixtureId: id,
    homeTeamId: teamId,
    awayTeamId: opponentId,
    homeGoals: won ? 1 : 0,
    awayGoals: won ? 0 : 1,
    extraTime: false,
    penalties: false,
    events: [],
    stats: {
      possession: [50, 50], shots: [8, 8], shotsOnTarget: [3, 3], corners: [3, 3],
      fouls: [8, 8], yellowCards: [1, 1], redCards: [0, 0],
    },
    competitionType: 'league',
    competitionName: '顶级联赛',
    roundLabel: id,
  };
}

describe('narrative detail threads', () => {
  it('stays absent for sparse team and player data instead of inventing a history', () => {
    const world = initializeGameWorld(20260818);
    const [teamId, squad] = Object.entries(world.squads)[0];

    expect(buildTeamNarrativeThread(world, teamId)).toBeNull();
    expect(buildPlayerNarrativeThread(world, squad[0].uuid)).toBeNull();
  });

  it('derives a bounded team thread for dynasty, promotion, and relegation records', () => {
    const world = initializeGameWorld(20260819);
    const [teamId] = Object.keys(world.teamBases);
    world.seasonState.seasonNumber = 4;
    world.honorHistory = [honor(1, teamId), honor(2, teamId), honor(3, teamId)];
    world.teamTrophies[teamId] = [
      { type: 'league1', seasonNumber: 1 },
      { type: 'league1', seasonNumber: 2 },
      { type: 'league1', seasonNumber: 3 },
    ];
    world.teamSeasonRecords[teamId] = [{
      seasonNumber: 3,
      leagueLevel: 1,
      leaguePosition: 1,
      leaguePlayed: 30,
      leagueWon: 23,
      leagueDrawn: 4,
      leagueLost: 3,
      leagueGF: 71,
      leagueGA: 19,
      leaguePoints: 73,
      coachId: Object.keys(world.coachBases)[0],
      promoted: false,
      relegated: false,
    }];

    const dynasty = buildTeamNarrativeThread(world, teamId);
    expect(dynasty?.entries).toContainEqual(expect.objectContaining({
      title: expect.stringContaining('建立王朝'),
      to: '/history',
      summaryOnly: true,
    }));
    expect(dynasty?.entries).toContainEqual(expect.objectContaining({
      title: '奖杯档案 · 队史3冠',
      to: '/history',
    }));
    expect(dynasty!.entries.length).toBeLessThanOrEqual(MAX_NARRATIVE_THREAD_ENTRIES);

    world.honorHistory = [];
    world.teamSeasonRecords[teamId]![0] = {
      ...world.teamSeasonRecords[teamId]![0],
      leaguePosition: 2,
      promoted: true,
    };
    expect(buildTeamNarrativeThread(world, teamId)?.entries[0].title).toContain('完成升级');
    world.teamSeasonRecords[teamId]![0] = {
      ...world.teamSeasonRecords[teamId]![0],
      promoted: false,
      relegated: true,
    };
    expect(buildTeamNarrativeThread(world, teamId)?.entries[0].title).toContain('遭遇降级');
  });

  it('reconstructs a mature, injured, transferred, awarded, and retired player career from canonical records', () => {
    const world = initializeGameWorld(20260820);
    const [teamId, otherTeamId] = Object.keys(world.teamBases);
    const player = world.squads[teamId][0];
    world.seasonState.seasonNumber = 3;
    const current = {
      ...emptyPlayerStat(player.uuid, teamId),
      appearances: 12,
      starts: 10,
      minutesPlayed: 960,
      teamMatchesAllCompetitions: 14,
      goals: 7,
      assists: 3,
      bigChances: 9,
      keyPasses: 5,
    };
    world.playerStats[player.uuid] = current;
    world.playerStatSegments = { [playerTeamStatKey(player.uuid, teamId)]: current };
    player.injuryHistory = [{ type: 'major', startSeason: 3, startWindow: 9, durationMatches: 7, reason: '膝伤' }];
    player.injuredUntilWindow = 99;
    world.playerStatsHistory[player.uuid] = [{
      season: 2,
      teamId: otherTeamId,
      teamName: world.teamBases[otherTeamId].name,
      position: player.position,
      goals: 16,
      assists: 4,
      appearances: 25,
      minutesPlayed: 2_100,
      starts: 24,
      yellowCards: 1,
      redCards: 0,
      teamGoalsConceded: 25,
      teamMatches: 30,
      teamMatchesAllCompetitions: 30,
      seasonScore: 82.4,
    }];
    world.playerAwardsHistory = [{
      season: 2,
      type: 'golden_boot',
      playerId: player.uuid,
      playerName: player.name,
      playerNumber: player.number,
      teamId: otherTeamId,
      teamName: world.teamBases[otherTeamId].name,
      statValue: 16,
      statLabel: '16球',
    }];
    world.transferHistory = [{
      season: 3,
      windowIndex: 0,
      playerId: player.uuid,
      playerName: player.name,
      playerNumber: player.number,
      position: player.position,
      fromTeamId: otherTeamId,
      fromTeamName: world.teamBases[otherTeamId].name,
      toTeamId: teamId,
      toTeamName: world.teamBases[teamId].name,
      type: 'transfer',
      fee: 36,
      reason: '核心补强',
    }];

    const active = buildPlayerNarrativeThread(world, player.uuid)!;
    expect(active.entries.map(entry => entry.id)).toEqual(expect.arrayContaining([
      expect.stringContaining('current-performance:'),
      expect.stringContaining('injury:'),
      expect.stringContaining('transfer:'),
      expect.stringContaining('award:'),
      expect.stringContaining('best-season:'),
    ]));
    expect(active.entries.find(entry => entry.id.startsWith('award:'))?.detail).toContain('金靴');
    expect(active.entries.length).toBe(MAX_NARRATIVE_THREAD_ENTRIES);

    world.squads[teamId] = world.squads[teamId].filter(item => item.uuid !== player.uuid);
    world.retirementHistory.push({
      uuid: player.uuid,
      name: player.name,
      teamId,
      teamName: world.teamBases[teamId].name,
      position: player.position,
      peakRating: player.peakRating,
      age: 36,
      seasonRetired: 4,
      careerGoals: 108,
    });
    const retired = buildPlayerNarrativeThread(world, player.uuid)!;
    expect(retired.summary).toContain('退役档案');
    expect(retired.entries).toContainEqual(expect.objectContaining({
      id: expect.stringContaining('retirement:'),
      to: '/legends',
      summaryOnly: true,
    }));
  });

  it('shows fired, rehired, trophy, and retired coach states without a second event store', () => {
    const world = initializeGameWorld(20260821);
    const coachId = Object.keys(world.coachBases)[0];
    const teamIds = Object.keys(world.teamBases);
    const state = world.coachStates[coachId];
    world.seasonState.seasonNumber = 3;
    world.seasonState.currentWindowIndex = 6;
    state.currentTeamId = teamIds[1];
    state.isUnemployed = false;
    state.contractEnd = 6;
    world.coachCareers[coachId] = [
      { teamId: teamIds[0], teamName: world.teamBases[teamIds[0]].name, fromSeason: 1, toSeason: 2, fired: true, trophies: [] },
      { teamId: teamIds[1], teamName: world.teamBases[teamIds[1]].name, fromSeason: 3, toSeason: null, fired: false, trophies: [] },
    ];
    world.coachTrophies[coachId] = [{ type: 'league_cup', seasonNumber: 3 }];
    const oldCoachId = Object.keys(world.coachBases).find(id => id !== coachId)!;
    world.coachChangesThisSeason = [{
      teamId: teamIds[1],
      oldCoachId,
      newCoachId: coachId,
      reason: '战绩不佳',
    }];
    world.seasonState.calendar = Array.from({ length: 7 }, (_, index) => ({
      id: index,
      type: 'league' as const,
      label: `第${index + 1}轮`,
      description: '测试赛程',
      fixtures: [],
      completed: true,
      results: [matchResult(teamIds[1], teamIds[2], index >= 4, `coach-thread-${index}`)],
    }));
    world.newsLog = [{
      id: 'coach-thread-hired',
      seasonNumber: 3,
      windowIndex: 3,
      type: 'coach_hired',
      subject: { teamIds: [teamIds[1]], coachIds: [coachId] },
      title: '新帅上任',
      description: '结构化变更',
    }];

    const rehired = buildCoachNarrativeThread(world, coachId)!;
    expect(rehired.entries).toContainEqual(expect.objectContaining({ title: expect.stringContaining('现任') }));
    expect(rehired.entries).toContainEqual(expect.objectContaining({ detail: expect.stringContaining('解雇') }));
    expect(rehired.entries).toContainEqual(expect.objectContaining({ title: expect.stringContaining('奖杯档案') }));
    expect(rehired.entries).toContainEqual(expect.objectContaining({
      title: '换帅后的第一段回应',
      detail: expect.stringContaining('上任后3场9分'),
    }));

    state.currentTeamId = null;
    state.isUnemployed = true;
    state.retired = true;
    world.coachRetirementHistory.push({
      id: coachId,
      name: world.coachBases[coachId].name,
      age: 68,
      seasonRetired: 5,
      totalSeasons: 5,
      trophies: world.coachTrophies[coachId],
      finalTeamId: teamIds[1],
      finalTeamName: world.teamBases[teamIds[1]].name,
    });
    const retired = buildCoachNarrativeThread(world, coachId)!;
    expect(retired.summary).toContain('完整任期');
    expect(retired.entries).toContainEqual(expect.objectContaining({
      id: expect.stringContaining('coach-retirement:'),
      to: '/legends',
    }));
    expect(retired.entries.length).toBeLessThanOrEqual(MAX_NARRATIVE_THREAD_ENTRIES);
  });
});

import { describe, expect, it } from 'vitest';
import type { HonorRecord } from '../../types/honor';
import { initializeGameWorld } from './season-manager';
import { buildTeamStory } from './team-story';

function honor(seasonNumber: number, champion: string): HonorRecord {
  return {
    seasonNumber,
    league1Champion: champion,
    league2Champion: 'league2-champion',
    league3Champion: 'league3-champion',
    leagueCupWinner: champion,
    superCupWinner: champion,
    promoted: [],
    relegated: [],
    coachChanges: [],
  };
}

describe('team story', () => {
  it('turns consecutive championships into a current dynasty chapter', () => {
    const world = initializeGameWorld(2024);
    const teamId = Object.keys(world.teamBases)[0];
    world.honorHistory = [honor(1, teamId), honor(2, teamId)];
    world.teamTrophies[teamId] = [
      { type: 'league1', seasonNumber: 1 },
      { type: 'league1', seasonNumber: 2 },
    ];
    world.teamFinances[teamId].cash = 80;

    const story = buildTeamStory(world, teamId);

    expect(story.chapter.title).toBe('王朝守擂');
    expect(story.chapter.summary).toContain('连续两个赛季');
    expect(story.chapter.signals).toContain('队史 2 冠');
  });

  it('keeps financial danger more prominent than a generic defending-title story', () => {
    const world = initializeGameWorld(2025);
    const teamId = Object.keys(world.teamBases)[0];
    world.honorHistory = [honor(1, teamId)];
    world.teamFinances[teamId].cash = -12.4;

    const story = buildTeamStory(world, teamId);

    expect(story.chapter.title).toBe('王冠下的危机');
    expect(story.chapter.tone).toBe('red');
    expect(story.chapter.signals).toContain('现金 -€12M');
  });

  it('builds a varied recent timeline from canonical club events', () => {
    const world = initializeGameWorld(2026);
    const [teamId, otherTeamId] = Object.keys(world.teamBases);
    const [oldCoachId, newCoachId] = Object.keys(world.coachBases);
    const seasonThree = honor(3, otherTeamId);
    seasonThree.promoted = [{ teamId, from: 2, to: 1 }];
    const seasonFour = honor(4, otherTeamId);
    seasonFour.coachChanges = [{ teamId, oldCoachId, newCoachId, reason: '战绩不佳' }];
    world.honorHistory = [seasonThree, seasonFour];
    world.teamTrophies[teamId] = [
      { type: 'league2', seasonNumber: 2 },
      { type: 'league_cup', seasonNumber: 2 },
    ];
    world.transferHistory = [{
      season: 5,
      windowIndex: 20,
      playerId: 'story-player',
      playerName: '故事新援',
      playerNumber: 9,
      position: 'FW',
      fromTeamId: otherTeamId,
      fromTeamName: world.teamBases[otherTeamId].name,
      toTeamId: teamId,
      toTeamName: world.teamBases[teamId].name,
      type: 'transfer',
      fee: 28,
      reason: '阵容补强',
    }];

    const moments = buildTeamStory(world, teamId).moments;

    expect(moments).toHaveLength(4);
    expect(moments.map(moment => moment.kind)).toEqual(['transfer', 'coach', 'transition', 'trophy']);
    expect(moments.find(moment => moment.kind === 'trophy')?.title).toBe('2冠赛季');
    expect(moments[0].detail).toContain('€28M');
  });

  it('derives a focus opponent from frequent close matches and reports team-relative results', () => {
    const world = initializeGameWorld(2027);
    const [teamId, closeOpponentId, occasionalOpponentId] = Object.keys(world.teamBases);
    world.matchHistory = [
      { season: 1, homeId: teamId, awayId: closeOpponentId, homeGoals: 1, awayGoals: 0, comp: '顶级联赛' },
      { season: 1, homeId: closeOpponentId, awayId: teamId, homeGoals: 2, awayGoals: 2, comp: '顶级联赛' },
      { season: 2, homeId: teamId, awayId: closeOpponentId, homeGoals: 0, awayGoals: 1, comp: '顶级联赛' },
      { season: 3, homeId: closeOpponentId, awayId: teamId, homeGoals: 1, awayGoals: 2, comp: '顶级联赛' },
      { season: 2, homeId: teamId, awayId: occasionalOpponentId, homeGoals: 4, awayGoals: 0, comp: '顶级联赛' },
      { season: 3, homeId: occasionalOpponentId, awayId: teamId, homeGoals: 0, awayGoals: 3, comp: '顶级联赛' },
    ];

    const rivalry = buildTeamStory(world, teamId).rivalry;

    expect(rivalry).toMatchObject({
      opponentId: closeOpponentId,
      meetings: 4,
      wins: 2,
      draws: 1,
      losses: 1,
      goalsFor: 5,
      goalsAgainst: 4,
      latest: 'S3 2-1 胜',
    });
  });
});

import { describe, expect, it } from 'vitest';
import type { MatchFixture } from '../../types/match';
import type { CalendarWindow } from '../../types/season';
import { initializeGameWorld, type GameWorld } from '../season/season-manager';
import { isInspectableKeyNode, planNextKeyNode } from './key-node';

function fixture(
  id: string,
  homeTeamId: string,
  awayTeamId: string,
  competitionType: MatchFixture['competitionType'] = 'league',
  roundLabel = 'R1',
): MatchFixture {
  return {
    id,
    homeTeamId,
    awayTeamId,
    competitionType,
    competitionName: competitionType === 'league' ? '顶级联赛' : '联赛杯',
    roundLabel,
  };
}

function window(
  id: number,
  type: CalendarWindow['type'],
  label: string,
  fixtures: MatchFixture[] = [],
): CalendarWindow {
  return { id, type, label, description: label, fixtures, completed: false, results: [] };
}

function buildWorld(): { world: GameWorld; favorite: string; storyTeam: string; other: string } {
  const initial = initializeGameWorld(20260726);
  const teamIds = Object.keys(initial.teamBases);
  const [favorite, storyTeam] = teamIds;
  const other = teamIds.at(-1)!;
  const fourth = teamIds.at(-2)!;
  return {
    favorite,
    storyTeam,
    other,
    world: {
      ...initial,
      teamBases: {
        ...initial.teamBases,
        [other]: {
          ...initial.teamBases[other],
          region: '测试洲+远方',
          overall: 1,
        },
      },
      seasonState: {
        ...initial.seasonState,
        currentWindowIndex: 0,
        calendar: [
          window(0, 'league', '普通联赛', [fixture('current', favorite, other)]),
          window(1, 'league', '下一轮联赛', [fixture('story', storyTeam, fourth)]),
          window(2, 'league_cup', '联赛杯 16强', [
            fixture('favorite-cup', favorite, storyTeam, 'league_cup', 'R16'),
          ]),
          window(3, 'season_end', '赛季结算'),
        ],
      },
      pendingObservationJudgment: null,
      activeStorylines: [],
    },
  };
}

describe('next key node planning', () => {
  it('stops at an observed team knockout before the generic season ending', () => {
    const { world, favorite } = buildWorld();
    expect(planNextKeyNode(world, [favorite])).toMatchObject({
      windowIndex: 2,
      skipWindows: 2,
      reason: 'favorite_match',
      fixtureId: 'favorite-cup',
      blocked: false,
    });
  });

  it('blocks the jump while the current observation judgment is unresolved', () => {
    const { world, favorite } = buildWorld();
    const guarded = {
      ...world,
      pendingObservationJudgment: {
        fixtureId: 'current',
        seasonNumber: world.seasonState.seasonNumber,
        windowIndex: 0,
        kind: 'outcome' as const,
        selection: 'home' as const,
      },
    };
    expect(planNextKeyNode(guarded, [favorite])).toMatchObject({
      windowIndex: 0,
      skipWindows: 0,
      reason: 'pending_judgment',
      blocked: true,
    });
  });

  it('prioritizes a climax story fixture over a later cup node', () => {
    const { world, favorite, storyTeam } = buildWorld();
    const withClimax: GameWorld = {
      ...world,
      activeStorylines: [{
        id: 'story-climax',
        type: 'dark_horse',
        teamId: storyTeam,
        seasonNumber: world.seasonState.seasonNumber,
        startedWindow: 0,
        startedElapsedWindow: 0,
        phase: '高潮',
        evidence: ['测试证据'],
        lastUpdatedWindow: 0,
        lastUpdatedElapsedWindow: 0,
        quietWindows: 0,
      }],
    };
    expect(planNextKeyNode(withClimax, [favorite])).toMatchObject({
      windowIndex: 1,
      skipWindows: 1,
      reason: 'story_climax',
      teamId: storyTeam,
    });
  });

  it('falls back to the next cup node without an observed team', () => {
    const { world } = buildWorld();
    expect(planNextKeyNode(world, [])).toMatchObject({
      windowIndex: 2,
      skipWindows: 2,
      reason: 'cup',
      blocked: false,
    });
  });

  it('stops at a configured group-stage finale before later knockout rounds', () => {
    const { world, favorite, other } = buildWorld();
    const groupWorld: GameWorld = {
      ...world,
      activeStorylines: [{
        id: 'group-stage-story',
        type: 'dark_horse',
        teamId: favorite,
        seasonNumber: world.seasonState.seasonNumber,
        startedWindow: 0,
        startedElapsedWindow: 0,
        phase: '高潮',
        evidence: ['测试证据'],
        lastUpdatedWindow: 0,
        lastUpdatedElapsedWindow: 0,
        quietWindows: 0,
      }],
      seasonState: {
        ...world.seasonState,
        calendar: [
          window(0, 'league', '普通联赛'),
          window(1, 'world_cup_group', '环球冠军杯 小组赛R2'),
          window(2, 'world_cup_group', '环球冠军杯 小组赛R3', [
            fixture('group-r3', favorite, other, 'world_cup_group', 'Group A - R3'),
          ]),
          window(3, 'world_cup', '环球冠军杯 16强'),
        ],
      },
    };

    const plan = planNextKeyNode(groupWorld, []);
    expect(plan).toMatchObject({
      windowIndex: 2,
      skipWindows: 2,
      reason: 'cup',
      reasonLabel: '小组赛收官',
      blocked: false,
    });
    expect(isInspectableKeyNode(plan)).toBe(true);
  });

  it('recognizes a starred current fixture as a protected node', () => {
    const { world } = buildWorld();
    expect(planNextKeyNode(world, [], ['current'])).toMatchObject({
      windowIndex: 0,
      reason: 'starred_match',
      blocked: true,
    });
  });

  it('plans a future starred fixture before a later generic cup node', () => {
    const { world } = buildWorld();
    expect(planNextKeyNode(world, [], ['story'])).toMatchObject({
      windowIndex: 1,
      skipWindows: 1,
      reason: 'starred_match',
      fixtureId: 'story',
      blocked: false,
    });
  });

  it('separates viewable match nodes from guards and season settlement', () => {
    const { world, favorite } = buildWorld();
    const cupNode = planNextKeyNode(world, [favorite]);
    expect(isInspectableKeyNode(cupNode)).toBe(true);

    const atSeasonEnd: GameWorld = {
      ...world,
      seasonState: {
        ...world.seasonState,
        currentWindowIndex: 3,
      },
    };
    expect(planNextKeyNode(atSeasonEnd, [favorite])).toMatchObject({ reason: 'season_end' });
    expect(isInspectableKeyNode(planNextKeyNode(atSeasonEnd, [favorite]))).toBe(false);
  });
});

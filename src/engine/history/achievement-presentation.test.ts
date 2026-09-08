import { describe, expect, it } from 'vitest';
import type { Achievement } from '../achievements';
import { buildAchievementPresentation } from './achievement-presentation';

function achievement(
  type: string,
  teamId: string,
  seasonNumber: number,
  title: string,
  includeTeamId = true,
): Achievement {
  return {
    id: `${type}-${teamId}-S${seasonNumber}`,
    title,
    description: `${teamId} ${title}`,
    seasonNumber,
    ...(includeTeamId ? { teamId } : {}),
  };
}

describe('buildAchievementPresentation', () => {
  it('groups repeated global achievements within one season', () => {
    const result = buildAchievementPresentation([
      achievement('first_relegation', 'a', 1, '降级深渊'),
      achievement('first_relegation', 'b', 1, '降级深渊'),
      achievement('first_relegation', 'c', 1, '降级深渊'),
    ], [], ['a', 'b', 'c']);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'group',
      key: 'achievement-group:1:first_relegation',
      seasonNumber: 1,
      teamIds: ['a', 'b', 'c'],
    });
    if (result[0].kind === 'group') expect(result[0].entries).toHaveLength(3);
  });

  it('keeps followed-team achievements separate and first', () => {
    const result = buildAchievementPresentation([
      achievement('first_relegation', 'a', 1, '降级深渊'),
      achievement('first_relegation', 'b', 1, '降级深渊'),
      achievement('legend_team', 'c', 1, '传奇队伍'),
    ], ['a'], ['a', 'b', 'c']);

    expect(result[0]).toMatchObject({ kind: 'single', teamId: 'a', followed: true });
    expect(result).toHaveLength(3);
  });

  it('keeps a followed achievement beside the matching non-followed group exactly once', () => {
    const rows = [
      achievement('first_relegation', 'datong', 1, '降级深渊'),
      achievement('first_relegation', 'other-a', 1, '降级深渊'),
      achievement('first_relegation', 'other-b', 1, '降级深渊'),
    ];
    const result = buildAchievementPresentation(
      rows,
      ['datong'],
      ['datong', 'other-a', 'other-b'],
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      kind: 'single',
      teamId: 'datong',
      followed: true,
    });
    expect(result[1]).toMatchObject({
      kind: 'group',
      teamIds: ['other-a', 'other-b'],
      followed: false,
    });

    const representedIds = result.flatMap(item => item.kind === 'single'
      ? [item.achievement.id]
      : item.entries.map(entry => entry.achievement.id));
    expect(representedIds).toHaveLength(rows.length);
    expect(new Set(representedIds).size).toBe(rows.length);
    expect([...representedIds].sort()).toEqual(rows.map(row => row.id).sort());
  });

  it('never merges the same achievement type across seasons', () => {
    const result = buildAchievementPresentation([
      achievement('first_relegation', 'a', 1, '降级深渊'),
      achievement('first_relegation', 'b', 2, '降级深渊'),
    ], [], ['a', 'b']);

    expect(result).toHaveLength(2);
    expect(result.every(item => item.kind === 'single')).toBe(true);
  });

  it('recovers team and type identity from legacy rows without teamId', () => {
    const result = buildAchievementPresentation([
      achievement('first_promotion', 'old-team-a', 4, '冲级成功', false),
      achievement('first_promotion', 'old-team-b', 4, '冲级成功', false),
    ], ['old-team-a'], ['old-team-a', 'old-team-b']);

    expect(result[0]).toMatchObject({
      kind: 'single',
      achievementType: 'first_promotion',
      teamId: 'old-team-a',
      followed: true,
    });
    expect(result[1]).toMatchObject({
      kind: 'single',
      achievementType: 'first_promotion',
      teamId: 'old-team-b',
    });
  });

  it('sorts deterministically regardless of input order', () => {
    const rows = [
      achievement('almost_perfect', 'b', 3, '一步之遥'),
      achievement('legend_team', 'a', 2, '传奇队伍'),
      achievement('first_promotion', 'c', 4, '冲级成功'),
    ];
    const forward = buildAchievementPresentation(rows, [], ['a', 'b', 'c']).map(item => item.key);
    const reverse = buildAchievementPresentation([...rows].reverse(), [], ['a', 'b', 'c']).map(item => item.key);
    expect(forward).toEqual(reverse);
  });
});

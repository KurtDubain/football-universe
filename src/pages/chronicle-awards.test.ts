import { describe, expect, it } from 'vitest';
import type { PlayerAward, PlayerAwardType } from '../types/award';
import type { GameWorld } from '../engine/season/season-manager';
import {
  buildAwardLeaderboard,
  buildAwardNarrativeClause,
  earliestAwardSeason,
  isSeasonAwardsArchived,
  seasonAwardState,
  selectSeasonTopScorer,
} from './chronicle-awards';

function award(
  type: PlayerAwardType,
  season: number,
  playerId: string,
  playerName: string,
  teamName = '球队A',
): PlayerAward {
  return {
    season,
    type,
    playerId,
    playerName,
    playerNumber: 9,
    teamId: 't1',
    teamName,
    statValue: 30,
    statLabel: '30球',
  };
}

/** 保留窗口内的存档：最早记录在 S51。 */
const windowHistory: PlayerAward[] = [
  award('mvp', 51, 'p-mvp', '金球先生'),
  award('golden_boot', 51, 'p-boot', '金靴先生'),
  award('best_defender', 51, 'p-def', '后卫先生'),
  award('golden_boot', 52, 'p-boot', '金靴先生'),
];

describe('归档判定', () => {
  it('早于最早记录赛季的赛季判为已归档', () => {
    expect(earliestAwardSeason(windowHistory)).toBe(51);
    expect(isSeasonAwardsArchived(windowHistory, 12)).toBe(true);
    expect(seasonAwardState(windowHistory, 12)).toEqual({ kind: 'archived' });
  });

  it('窗口内有奖项的赛季正常返回奖项，并按展示优先级排序', () => {
    expect(isSeasonAwardsArchived(windowHistory, 51)).toBe(false);
    const state = seasonAwardState(windowHistory, 51);
    expect(state.kind).toBe('awards');
    expect(state.kind === 'awards' && state.awards.map(a => a.type))
      .toEqual(['mvp', 'golden_boot', 'best_defender']);
  });

  it('窗口内但该赛季没有奖项记录时是 none，不是 archived', () => {
    expect(isSeasonAwardsArchived(windowHistory, 53)).toBe(false);
    expect(seasonAwardState(windowHistory, 53)).toEqual({ kind: 'none' });
  });

  it('存档完全没有奖项记录时不做归档判定', () => {
    expect(earliestAwardSeason([])).toBeNull();
    expect(isSeasonAwardsArchived([], 3)).toBe(false);
    expect(seasonAwardState([], 3)).toEqual({ kind: 'none' });
    expect(isSeasonAwardsArchived(undefined, 3)).toBe(false);
  });
});

describe('赛季叙事球员句子', () => {
  it('金球奖存在时优先生成金球句子', () => {
    expect(buildAwardNarrativeClause(windowHistory, 51))
      .toBe('金球先生（球队A）拿下了金球奖');
  });

  it('没有金球时退回金靴', () => {
    const history = [award('golden_boot', 51, 'p-boot', '金靴先生'), award('best_defender', 51, 'p-def', '后卫先生')];
    expect(buildAwardNarrativeClause(history, 51))
      .toBe('金靴先生（球队A）拿下了金靴奖');
  });

  it('金球金靴都没有时退回任意一个奖', () => {
    const history = [award('best_goalkeeper', 51, 'p-gk', '门将先生')];
    expect(buildAwardNarrativeClause(history, 51))
      .toBe('门将先生（球队A）拿下了最佳门将');
  });

  it('已归档赛季不生成球员句子', () => {
    expect(buildAwardNarrativeClause(windowHistory, 12)).toBeNull();
  });

  it('窗口内无奖项的赛季也不生成球员句子', () => {
    expect(buildAwardNarrativeClause(windowHistory, 53)).toBeNull();
    expect(buildAwardNarrativeClause([], 3)).toBeNull();
  });
});

function scorerWorld(): GameWorld {
  return {
    seasonState: { seasonNumber: 3 },
    teamBases: { t1: { id: 't1', name: '球队一', shortName: '一', color: '#ff0000' } },
    squads: {},
    retirementHistory: [],
    playerStats: {},
    playerStatsHistory: {
      p1: [{
        season: 2,
        teamId: 't1',
        playerName: '张三',
        position: 'FW',
        goals: 22,
        leagueGoals: 18,
        assists: 4,
        appearances: 30,
        yellowCards: 1,
        redCards: 0,
        teamGoalsConceded: 20,
        teamMatches: 30,
      }],
    },
    teamSeasonRecords: { t1: [{ seasonNumber: 2, leagueLevel: 1 }] },
    seasonStartLevels: {},
  } as unknown as GameWorld;
}

describe('赛季射手王', () => {
  it('取联赛口径的射手王，口径说明来自 seasonTopScorerLabel', () => {
    const scorer = selectSeasonTopScorer(scorerWorld(), 2);
    expect(scorer).not.toBeNull();
    expect(scorer?.playerId).toBe('p1');
    expect(scorer?.playerName).toBe('张三');
    expect(scorer?.teamName).toBe('球队一');
    expect(scorer?.teamColor).toBe('#ff0000');
    expect(scorer?.label.startsWith('联赛')).toBe(true);
    expect(scorer?.label).toContain('18球');
  });

  it('没有该赛季数据时返回 null', () => {
    expect(selectSeasonTopScorer(scorerWorld(), 99)).toBeNull();
  });
});

describe('个人荣誉排行', () => {
  it('按得奖次数排名，并记录最近一次获奖的球队', () => {
    const history = [
      award('mvp', 51, 'p1', '球员一', '球队A'),
      award('mvp', 52, 'p1', '球员一', '球队B'),
      award('mvp', 53, 'p2', '球员二', '球队C'),
      award('golden_boot', 51, 'p3', '球员三', '球队D'),
    ];

    const board = buildAwardLeaderboard(history, 'mvp');
    expect(board.map(row => [row.playerId, row.count])).toEqual([['p1', 2], ['p2', 1]]);
    expect(board[0].teamName).toBe('球队B');
    expect(board[0].playerName).toBe('球员一');

    expect(buildAwardLeaderboard(history, 'golden_boot').map(row => row.playerId)).toEqual(['p3']);
    expect(buildAwardLeaderboard(history, 'best_midfielder')).toEqual([]);
    expect(buildAwardLeaderboard(undefined, 'mvp')).toEqual([]);
  });
});

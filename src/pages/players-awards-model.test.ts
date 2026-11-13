import { describe, expect, it } from 'vitest';
import type { PlayerAward, PlayerAwardType } from '../types/award';
import {
  aggregateAwardLeaders,
  dedupeAwards,
  DEFAULT_AWARD_FILTERS,
  describeAwardCounts,
  filterAwards,
  normalizeAwardFilters,
  sortAwardRecords,
} from './players-awards-model';

function award(
  season: number,
  type: PlayerAwardType,
  playerId: string,
  overrides: Partial<PlayerAward> = {},
): PlayerAward {
  return {
    season,
    type,
    playerId,
    playerName: `${playerId} 号球员`,
    playerNumber: 9,
    teamId: 'team-a',
    teamName: '甲队',
    statValue: 30,
    statLabel: '30球',
    ...overrides,
  };
}

describe('player award board', () => {
  it('counts one win per player, season and award type', () => {
    const duplicated = [
      award(3, 'mvp', 'p1'),
      // Retained career summaries and live history overlap after saving.
      award(3, 'mvp', 'p1', { statLabel: '综合 88', statValue: 88, teamName: '乙队' }),
      award(3, 'golden_boot', 'p1'),
      award(4, 'mvp', 'p1'),
    ];

    expect(dedupeAwards(duplicated)).toHaveLength(3);

    const [leader] = aggregateAwardLeaders(duplicated);
    expect(leader.playerId).toBe('p1');
    expect(leader.total).toBe(3);
    expect(leader.counts.mvp).toBe(2);
    expect(leader.counts.golden_boot).toBe(1);
  });

  it('ranks by total wins, then Ballon d\'Or, Golden Boot and latest season', () => {
    const rows = aggregateAwardLeaders([
      // total 3
      award(1, 'mvp', 'a'),
      award(2, 'golden_boot', 'a'),
      award(3, 'best_forward', 'a'),
      // total 2, two Ballon d'Or
      award(1, 'mvp', 'b'),
      award(2, 'mvp', 'b'),
      // total 2, one Ballon d'Or + one Golden Boot
      award(1, 'mvp', 'c'),
      award(2, 'golden_boot', 'c'),
      // total 2, one Ballon d'Or, latest season 1
      award(1, 'mvp', 'd'),
      award(1, 'best_forward', 'd'),
      // total 2, one Ballon d'Or, latest season 4
      award(4, 'mvp', 'e', { teamId: 'team-e', teamName: '戊队' }),
      award(1, 'best_forward', 'e'),
    ]);

    expect(rows.map((row) => row.playerId)).toEqual(['a', 'b', 'c', 'e', 'd']);
    // The team shown is the one the player won their most recent award with.
    expect(rows[3].teamId).toBe('team-e');
    expect(rows[3].teamName).toBe('戊队');
    expect(rows[3].latestSeason).toBe(4);
  });

  it('reads positions from the supplied lookup and falls back to undefined', () => {
    const positions = new Map([['p1', 'FW' as const]]);
    const rows = aggregateAwardLeaders([award(1, 'mvp', 'p1'), award(1, 'mvp', 'p2')], positions);
    expect(rows.find((row) => row.playerId === 'p1')?.position).toBe('FW');
    expect(rows.find((row) => row.playerId === 'p2')?.position).toBeUndefined();
  });

  it('filters by award type, team and a trailing season window', () => {
    const awards = [
      award(5, 'mvp', 'old'),
      award(20, 'golden_boot', 'mid'),
      award(28, 'golden_boot', 'recent', { teamId: 'team-b', teamName: '乙队' }),
    ];

    expect(filterAwards(awards, DEFAULT_AWARD_FILTERS, 30)).toHaveLength(3);
    expect(filterAwards(awards, { ...DEFAULT_AWARD_FILTERS, type: 'golden_boot' }, 30)
      .map((row) => row.playerId)).toEqual(['mid', 'recent']);
    expect(filterAwards(awards, { ...DEFAULT_AWARD_FILTERS, teamId: 'team-b' }, 30)
      .map((row) => row.playerId)).toEqual(['recent']);
    // 最近 10 季 at season 30 keeps season >= 21.
    expect(filterAwards(awards, { ...DEFAULT_AWARD_FILTERS, seasons: '10' }, 30)
      .map((row) => row.season)).toEqual([28]);
    // 最近 25 季 keeps season >= 6.
    expect(filterAwards(awards, { ...DEFAULT_AWARD_FILTERS, seasons: '25' }, 30)
      .map((row) => row.season)).toEqual([20, 28]);
    expect(filterAwards(awards, { ...DEFAULT_AWARD_FILTERS, seasons: '50' }, 30)).toHaveLength(3);
  });

  it('dedupes before filtering so duplicates cannot inflate a window', () => {
    const awards = [award(28, 'mvp', 'p1'), award(28, 'mvp', 'p1')];
    expect(filterAwards(awards, { ...DEFAULT_AWARD_FILTERS, seasons: '10' }, 30)).toHaveLength(1);
  });

  it('lists records newest season first', () => {
    const records = sortAwardRecords([
      award(2, 'golden_boot', 'p1'),
      award(9, 'best_defender', 'p2'),
      award(9, 'mvp', 'p3'),
    ]);
    expect(records.map((row) => `${row.season}:${row.type}`))
      .toEqual(['9:mvp', '9:best_defender', '2:golden_boot']);
  });

  it('falls back to safe filters for missing, corrupt or stale persisted values', () => {
    expect(normalizeAwardFilters(undefined)).toEqual(DEFAULT_AWARD_FILTERS);
    expect(normalizeAwardFilters({ type: 'nope', seasons: '7', teamId: 42 }))
      .toEqual(DEFAULT_AWARD_FILTERS);
    // A team that no longer exists must not blank the board.
    expect(normalizeAwardFilters({ type: 'mvp', seasons: '10', teamId: 'gone' }, new Set(['team-a'])))
      .toEqual({ type: 'mvp', seasons: '10', teamId: 'all' });
    expect(normalizeAwardFilters({ teamId: 'team-a' }, new Set(['team-a'])).teamId).toBe('team-a');
  });

  it('summarises a player\'s awards most prestigious first', () => {
    const rows = aggregateAwardLeaders([
      award(1, 'mvp', 'p1'),
      award(2, 'mvp', 'p1'),
      award(3, 'golden_boot', 'p1'),
      award(4, 'best_defender', 'p1'),
    ]);
    expect(describeAwardCounts(rows[0].counts)).toBe('金球 ×2 · 金靴 ×1 · 最佳后卫 ×1');
    expect(describeAwardCounts(rows[0].counts, 2)).toBe('金球 ×2 · 金靴 ×1 等 3 项');
    expect(describeAwardCounts(rows[0].counts, 1)).toBe('金球 ×2 等 3 项');
  });
});

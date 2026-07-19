import { describe, expect, it } from 'vitest';
import type { PlayerPosition, PlayerSeasonStats } from '../types/player';
import { getPositionHeadlineMetrics } from './player-detail-metrics';

const stats: PlayerSeasonStats = {
  playerId: 'p1',
  teamId: 't1',
  appearances: 12,
  starts: 9,
  substituteAppearances: 3,
  minutesPlayed: 840,
  goals: 7,
  assists: 5,
  yellowCards: 2,
  redCards: 0,
  cleanSheets: 6,
  saves: 14,
  keyBlocks: 8,
  bigChances: 11,
  keyPasses: 13,
};

describe('position-specific player headlines', () => {
  it.each<[PlayerPosition, string[], number[]]>([
    ['FW', ['出场', '进球', '助攻', '关键射门'], [12, 7, 5, 11]],
    ['MF', ['出场', '助攻', '威胁传球', '进球'], [12, 5, 13, 7]],
    ['DF', ['出场', '零封', '关键封堵', '出场分钟'], [12, 6, 8, 840]],
    ['GK', ['出场', '零封', '神扑', '出场分钟'], [12, 6, 14, 840]],
  ])('uses relevant metrics for %s', (position, labels, values) => {
    const metrics = getPositionHeadlineMetrics(position, stats);
    expect(metrics.map(metric => metric.label)).toEqual(labels);
    expect(metrics.map(metric => metric.value)).toEqual(values);
  });

  it('returns a stable four-metric zero state when stats are absent', () => {
    const metrics = getPositionHeadlineMetrics('GK');
    expect(metrics).toHaveLength(4);
    expect(metrics.every(metric => metric.value === 0)).toBe(true);
  });
});

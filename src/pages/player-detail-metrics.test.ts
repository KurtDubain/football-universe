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
  routineSaves: 22,
  cleanSheetMinutes: 420,
  interceptions: 24,
  clearances: 30,
};

describe('position-specific player headlines', () => {
  it.each<[PlayerPosition, string[], number[]]>([
    ['FW', ['出场', '进球', '助攻', '额外关键机会'], [12, 7, 5, 4]],
    ['MF', ['出场', '助攻', '额外创造机会', '进球'], [12, 5, 8, 7]],
    ['DF', ['出场', '拦截', '解围', '门线封堵'], [12, 24, 30, 8]],
    ['GK', ['出场', '普通扑救', '关键扑救', '零封分钟'], [12, 22, 14, 420]],
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

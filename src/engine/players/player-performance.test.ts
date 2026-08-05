import { describe, expect, it } from 'vitest';
import type { PlayerSeasonStats } from '../../types/player';
import { computePlayerPerformance, getPlayerPerformanceMetrics } from './player-performance';

function stat(overrides: Partial<PlayerSeasonStats> = {}): PlayerSeasonStats {
  return {
    playerId: 'p1', teamId: 't1', goals: 0, assists: 0,
    yellowCards: 0, redCards: 0, appearances: 10,
    starts: 10, substituteAppearances: 0, minutesPlayed: 900,
    cleanSheets: 0, saves: 0, keyBlocks: 0, bigChances: 0, keyPasses: 0,
    routineSaves: 0, shotsOnTargetFaced: 0, cleanSheetMinutes: 0,
    goalsConcededWhileOnPitch: 0, interceptions: 0, clearances: 0,
    ...overrides,
  };
}

describe('position performance', () => {
  it('uses extra chances instead of counting goals and assists twice', () => {
    const forward = stat({ goals: 6, assists: 2, bigChances: 9 });
    const midfielder = stat({ goals: 3, assists: 7, keyPasses: 12 });
    expect(getPlayerPerformanceMetrics(forward).extraBigChancesPer90).toBeCloseTo(0.3);
    expect(getPlayerPerformanceMetrics(midfielder).extraKeyPassesPer90).toBeCloseTo(0.5);
    expect(computePlayerPerformance('FW', { ...forward, bigChances: 6 }).score)
      .toBeLessThan(computePlayerPerformance('FW', forward).score);
    expect(computePlayerPerformance('MF', { ...midfielder, keyPasses: 7 }).score)
      .toBeLessThan(computePlayerPerformance('MF', midfielder).score);
  });

  it('separates goalkeepers from the same team by individual save performance', () => {
    const shared = {
      cleanSheetMinutes: 360,
      goalsConcededWhileOnPitch: 12,
      shotsOnTargetFaced: 45,
    };
    const stronger = computePlayerPerformance('GK', stat({ ...shared, routineSaves: 30, saves: 3 }));
    const weaker = computePlayerPerformance('GK', stat({ ...shared, routineSaves: 22, saves: 1 }));
    expect(stronger.score).toBeGreaterThan(weaker.score);
  });

  it('separates defenders by personal actions with equal team context', () => {
    const shared = { cleanSheetMinutes: 360, goalsConcededWhileOnPitch: 12 };
    const active = computePlayerPerformance('DF', stat({ ...shared, interceptions: 38, clearances: 52, keyBlocks: 2 }));
    const quiet = computePlayerPerformance('DF', stat({ ...shared, interceptions: 16, clearances: 24, keyBlocks: 0 }));
    expect(active.score).toBeGreaterThan(quiet.score);
  });

  it('does not rank samples below 600 minutes', () => {
    expect(computePlayerPerformance('GK', stat({ minutesPlayed: 599 })).eligible).toBe(false);
    expect(computePlayerPerformance('GK', stat({ minutesPlayed: 600 })).eligible).toBe(true);
  });
});

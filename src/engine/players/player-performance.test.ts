import { describe, expect, it } from 'vitest';
import type { PlayerSeasonStats } from '../../types/player';
import {
  computePlayerPerformance,
  computeSegmentedPlayerPerformance,
  getPlayerPerformanceMetrics,
} from './player-performance';

function stat(overrides: Partial<PlayerSeasonStats> = {}): PlayerSeasonStats {
  return {
    playerId: 'p1', teamId: 't1', goals: 0, assists: 0,
    yellowCards: 0, redCards: 0, appearances: 10,
    starts: 10, substituteAppearances: 0, minutesPlayed: 900,
    cleanSheets: 0, saves: 0, keyBlocks: 0, bigChances: 0, keyPasses: 0,
    routineSaves: 0, shotsOnTargetFaced: 0, cleanSheetMinutes: 0,
    goalsConcededWhileOnPitch: 0, interceptions: 0, clearances: 0,
    teamMatchesAllCompetitions: 10, missedMatches: 0, injuryAbsenceMatches: 0,
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

  it('softly shrinks low samples instead of invalidating everything below 600 minutes', () => {
    const short = computePlayerPerformance('FW', stat({
      appearances: 2, minutesPlayed: 180, teamMatchesAllCompetitions: 10,
      goals: 3, bigChances: 4,
    }));
    const full = computePlayerPerformance('FW', stat({
      appearances: 10, minutesPlayed: 900, teamMatchesAllCompetitions: 10,
      goals: 15, bigChances: 20,
    }));
    expect(short.eligible).toBe(true);
    expect(short.confidenceLabel).toBe('low');
    expect(short.adjustedPositionQuality).toBeLessThan(full.adjustedPositionQuality);
    expect(computePlayerPerformance('FW', stat({ appearances: 0, minutesPlayed: 0 })).eligible).toBe(false);
  });

  it('keeps representative position medians on a comparable quality scale', () => {
    const minutes = 2700;
    const samples = [
      computePlayerPerformance('FW', stat({
        appearances: 30, starts: 30, minutesPlayed: minutes, teamMatchesAllCompetitions: 30,
        goals: 9.48, assists: 1.68, bigChances: 11.07,
      })),
      computePlayerPerformance('MF', stat({
        appearances: 30, starts: 30, minutesPlayed: minutes, teamMatchesAllCompetitions: 30,
        goals: 1.74, assists: 3.84, keyPasses: 5.01, bigChances: 2.73,
      })),
      computePlayerPerformance('DF', stat({
        appearances: 30, starts: 30, minutesPlayed: minutes, teamMatchesAllCompetitions: 30,
        goals: 0.5, assists: 1.45, interceptions: 61.89, clearances: 84.54,
        keyBlocks: 1.02, goalsConcededWhileOnPitch: 35.28, cleanSheetMinutes: 883,
      })),
      computePlayerPerformance('GK', stat({
        appearances: 30, starts: 30, minutesPlayed: minutes, teamMatchesAllCompetitions: 30,
        routineSaves: 87.99, saves: 2.25, shotsOnTargetFaced: 129.3,
        goalsConcededWhileOnPitch: 35.64, cleanSheetMinutes: 878,
      })),
    ];
    const qualities = samples.map(result => result.positionQuality);
    expect(Math.max(...qualities) - Math.min(...qualities)).toBeLessThanOrEqual(10);
    for (const result of samples) {
      expect(result.seasonScore).toBeGreaterThanOrEqual(0);
      expect(result.seasonScore).toBeLessThanOrEqual(100);
    }
  });

  it('uses minutes, appearances and injury-driven absences in availability', () => {
    const healthy = computePlayerPerformance('MF', stat({
      appearances: 30, starts: 30, minutesPlayed: 2700,
      teamMatchesAllCompetitions: 30, missedMatches: 0,
      goals: 5, assists: 8, keyPasses: 12,
    }));
    const injured = computePlayerPerformance('MF', stat({
      appearances: 18, starts: 18, minutesPlayed: 1620,
      teamMatchesAllCompetitions: 30, missedMatches: 12, injuryAbsenceMatches: 12,
      goals: 3, assists: 5, keyPasses: 7,
    }));
    expect(injured.metrics.injuryAbsenceMatches).toBe(12);
    expect(injured.availabilityScore).toBeLessThan(healthy.availabilityScore);
    expect(injured.seasonScore).toBeLessThan(healthy.seasonScore);
  });

  it('keeps league strength light and reverse defensive metrics directional', () => {
    const shared = stat({
      appearances: 20, minutesPlayed: 1800, teamMatchesAllCompetitions: 20,
      interceptions: 42, clearances: 58, goalsConcededWhileOnPitch: 20,
    });
    const top = computePlayerPerformance('DF', shared, 1);
    const lower = computePlayerPerformance('DF', shared, 3);
    const leakier = computePlayerPerformance('DF', { ...shared, goalsConcededWhileOnPitch: 40 }, 1);
    expect(top.seasonScore - lower.seasonScore).toBeCloseTo(1, 1);
    expect(leakier.positionQuality).toBeLessThan(top.positionQuality);
  });

  it('aggregates transfer segments by minutes without adopting only the current club level', () => {
    const first = stat({
      playerId: 'p1', teamId: 'top', appearances: 10, minutesPlayed: 900,
      teamMatchesAllCompetitions: 10, goals: 4, assists: 1, bigChances: 5,
    });
    const second = stat({
      playerId: 'p1', teamId: 'low', appearances: 5, minutesPlayed: 450,
      teamMatchesAllCompetitions: 5, goals: 1, assists: 1, bigChances: 2,
    });
    const result = computeSegmentedPlayerPerformance('FW', [first, second], { top: 1, low: 3 });
    expect(result.metrics.minutes).toBe(1350);
    expect(result.metrics.teamMatchesAllCompetitions).toBe(15);
    expect(result.leagueStrength).toBeCloseTo(96.7, 1);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

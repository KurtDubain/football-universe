import { describe, expect, it } from 'vitest';
import type { PlayerSeasonStats } from '../../types/player';
import {
  PLAYER_SCORE_CEILING,
  POSITION_QUALITY_CALIBRATION,
  POSITION_VALUE_OFFSET,
  TAIL_POSITION_QUALITY_TARGET,
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
    /** Season total that corresponds to a per-90 rate over `minutes`. */
    const at = (per90: number) => per90 * minutes / 90;
    // Every fixture sits exactly on its position's top-flight anchor medians, so
    // this asserts the calibration rather than four hand-picked seasons: the
    // median forward, midfielder, defender and keeper must still land in one
    // readable band even though their metric shapes have nothing in common.
    const samples = [
      computePlayerPerformance('FW', stat({
        appearances: 30, starts: 30, minutesPlayed: minutes, teamMatchesAllCompetitions: 30,
        goals: at(0.3), assists: at(0.03),
        bigChances: at(0.4346), keyPasses: at(0.0723),
      })),
      computePlayerPerformance('MF', stat({
        appearances: 30, starts: 30, minutesPlayed: minutes, teamMatchesAllCompetitions: 30,
        goals: at(0.05), assists: at(0.05),
        keyPasses: at(0.125), bigChances: at(0.0928),
        interceptions: at(0.5714), clearances: at(0.8125),
      })),
      computePlayerPerformance('DF', stat({
        appearances: 30, starts: 30, minutesPlayed: minutes, teamMatchesAllCompetitions: 30,
        goals: 0.5, assists: at(0.0536) - 0.5, interceptions: at(1.3333), clearances: at(1.8611),
        keyBlocks: at(0.0286), goalsConcededWhileOnPitch: at(1.0727),
        cleanSheetMinutes: 0.3534 * minutes,
      })),
      computePlayerPerformance('GK', stat({
        appearances: 30, starts: 30, minutesPlayed: minutes, teamMatchesAllCompetitions: 30,
        routineSaves: at(3.6154), saves: at(0.0763),
        shotsOnTargetFaced: (at(3.6154) + at(0.0763)) / 0.7739,
        goalsConcededWhileOnPitch: at(1.0789), cleanSheetMinutes: 0.3529 * minutes,
      })),
    ];
    const qualities = samples.map(result => result.positionQuality);
    // Each fixture sits on its position's top-flight anchor medians, but those
    // medians are not the same thing as the group's median raw quality. The
    // sparse anchors are sampled from the NON-ZERO rows, so a fixture sitting on
    // them is above the real median player on exactly those terms, and the
    // shrinkage above only partly closes the gap. The forward shows it most: its
    // sparse term carries 0.30 of its weight and 37% to 54% of forwards record
    // nothing on it, which is why the tolerance below is 8 points and not 1.
    // What has to hold is that every position still lands near its own
    // calibrated median plus its cross-position value weight, and that the four
    // stay inside one readable band. The four targets are deliberately NOT
    // monotone — POSITION_VALUE_OFFSET is solved against top-twenty pool shares,
    // so it compensates for each position's score distribution rather than
    // ranking the positions by worth.
    const targets = (['FW', 'MF', 'DF', 'GK'] as const).map(position => 50 + POSITION_VALUE_OFFSET[position]);
    qualities.forEach((quality, index) => {
      expect(quality).toBeGreaterThanOrEqual(40);
      expect(quality).toBeLessThanOrEqual(66);
      expect(Math.abs(quality - targets[index])).toBeLessThanOrEqual(8);
    });
    expect(Math.max(...qualities) - Math.min(...qualities)).toBeLessThanOrEqual(22);
    for (const result of samples) {
      expect(result.seasonScore).toBeGreaterThanOrEqual(0);
      expect(result.seasonScore).toBeLessThanOrEqual(PLAYER_SCORE_CEILING);
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

  it('scores a tier-median defender the same in every division', () => {
    const minutes = 1800;
    const at = (per90: number) => per90 * minutes / 90;
    // Each fixture sits on its OWN tier's defender anchor medians. From score
    // version 4 the anchors are per tier, because the lower divisions generate
    // far fewer shots and a keeper's rate metrics collapse with them; scoring
    // everyone against top-flight anchors pinned the median third-tier keeper
    // to 15 out of 120. So the reference population, not the division, is what
    // output is measured against, and `leagueStrength` (10% weight, 100/95/90)
    // is the only term that still knows where the season was played.
    const tierMedian = (tier: 1 | 2 | 3) => {
      const anchor = {
        1: { int: 1.3333, clr: 1.8611, blk: 0.0286, gc: 1.0727, cs: 0.3534, atk: 0.0536 },
        2: { int: 1.3065, clr: 1.7861, blk: 0.0517, gc: 1.1379, cs: 0.3333, atk: 0.0625 },
        3: { int: 1.2105, clr: 1.5882, blk: 0.0625, gc: 1.2489, cs: 0.3276, atk: 0.0667 },
      }[tier];
      return stat({
        appearances: 20, minutesPlayed: minutes, teamMatchesAllCompetitions: 20,
        interceptions: at(anchor.int), clearances: at(anchor.clr), keyBlocks: at(anchor.blk),
        goalsConcededWhileOnPitch: at(anchor.gc), cleanSheetMinutes: anchor.cs * minutes,
        goals: 0.5, assists: at(anchor.atk) - 0.5,
      });
    };

    const top = computePlayerPerformance('DF', tierMedian(1), 1);
    const mid = computePlayerPerformance('DF', tierMedian(2), 2);
    const lower = computePlayerPerformance('DF', tierMedian(3), 3);
    // The band sits below 50 because a defender carries the largest negative
    // POSITION_VALUE_OFFSET: the same tier-median season that reads 50 for a
    // position of neutral value reads in the low forties here. What matters is
    // that all three divisions land within a couple of points of each other,
    // which is what the tier cap on the calibration scale protects: without it
    // the lower divisions are stretched to fit their own narrower spread.
    for (const result of [top, mid, lower]) {
      expect(result.positionQuality).toBeGreaterThanOrEqual(40);
      expect(result.positionQuality).toBeLessThanOrEqual(48);
    }
    expect(Math.max(top.positionQuality, mid.positionQuality, lower.positionQuality)
      - Math.min(top.positionQuality, mid.positionQuality, lower.positionQuality)).toBeLessThanOrEqual(4);
    // Two whole divisions apart, and league strength is still worth ~1 point.
    expect(Math.abs(top.seasonScore - lower.seasonScore)).toBeLessThanOrEqual(2);

    // Reverse metrics stay directional inside a tier: conceding more is worse.
    const leakier = computePlayerPerformance('DF', {
      ...tierMedian(1), goalsConcededWhileOnPitch: at(2.5),
    }, 1);
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
    expect(result.score).toBeLessThanOrEqual(PLAYER_SCORE_CEILING);
  });
});

describe('two-segment calibration above P95', () => {
  const positions = ['GK', 'DF', 'MF', 'FW'] as const;
  const tiers = [1, 2, 3] as const;

  it('meets the two segments exactly at the knee', () => {
    // A discontinuity here would make a player who is one event better read
    // worse than one who is one event worse, which is the one failure a
    // piecewise curve can have that a single slope cannot.
    for (const position of positions) {
      for (const tier of tiers) {
        const c = POSITION_QUALITY_CALIBRATION[position][tier];
        const fromBelow = 50 + (c.knee - c.median) * c.scale + POSITION_VALUE_OFFSET[position];
        expect(c.kneeQuality).toBeCloseTo(fromBelow, 6);
      }
    }
  });

  it('lands every top-flight group on the tail target at its own P99.9', () => {
    // This is the whole point of the second segment: the four positions used to
    // read 104.1 / 93.7 / 100.6 / 104.1 here, and no goalkeeper in 231,866 rows
    // ever reached a season score of 100. They now read the same number.
    for (const position of positions) {
      const c = POSITION_QUALITY_CALIBRATION[position][1];
      expect(c.kneeQuality + (c.tail - c.knee) * c.tailScale)
        .toBeCloseTo(TAIL_POSITION_QUALITY_TARGET, 6);
    }
  });

  it('still lands every group on 50 plus its offset at its own median', () => {
    // The second segment must not have moved the first: everything at or below
    // P95 scores what it scored under score version 9.
    for (const position of positions) {
      for (const tier of tiers) {
        const c = POSITION_QUALITY_CALIBRATION[position][tier];
        expect(50 + (c.median - c.median) * c.scale + POSITION_VALUE_OFFSET[position])
          .toBeCloseTo(50 + POSITION_VALUE_OFFSET[position], 6);
      }
    }
  });

  it('never stretches a lower division past its own top flight', () => {
    for (const position of positions) {
      const top = POSITION_QUALITY_CALIBRATION[position][1];
      for (const tier of [2, 3] as const) {
        const c = POSITION_QUALITY_CALIBRATION[position][tier];
        expect(c.scale).toBeLessThanOrEqual(top.scale);
        expect(c.tailScale).toBeLessThanOrEqual(top.tailScale);
      }
    }
  });

  it('keeps both slopes positive and the break points ordered', () => {
    for (const position of positions) {
      for (const tier of tiers) {
        const c = POSITION_QUALITY_CALIBRATION[position][tier];
        expect(c.scale).toBeGreaterThan(0);
        expect(c.tailScale).toBeGreaterThan(0);
        expect(c.knee).toBeGreaterThan(c.median);
        expect(c.tail).toBeGreaterThan(c.knee);
      }
    }
  });

  const minutes = 2700;
  const at = (per90: number) => per90 * minutes / 90;
  const full = {
    appearances: 38, starts: 38, minutesPlayed: minutes, teamMatchesAllCompetitions: 38,
  };

  /**
   * A season strictly better than every step below it, at every metric the
   * position reads. Deliberately built from "more is better" rather than from
   * the anchor table, so it cannot drift when the anchors are resampled.
   */
  const ladder = (position: typeof positions[number], step: number) => {
    switch (position) {
      case 'FW':
        return stat({
          ...full, goals: at(0.5 * step), assists: at(0.1 * step),
          bigChances: at(0.5 * step), keyPasses: at(0.08 * step),
        });
      case 'MF':
        return stat({
          ...full, goals: at(0.06 * step), assists: at(0.06 * step),
          keyPasses: at(0.13 * step), bigChances: at(0.09 * step),
          interceptions: at(0.57 * step), clearances: at(0.81 * step),
        });
      case 'DF':
        return stat({
          ...full, goals: 0.5, assists: at(0.05 * step),
          interceptions: at(1.33 * step), clearances: at(1.86 * step),
          keyBlocks: at(0.029 * step), goalsConcededWhileOnPitch: at(1.07 / step),
          cleanSheetMinutes: (0.24 + 0.09 * step) * minutes,
        });
      case 'GK': {
        const routine = 3.6 * step;
        const key = 0.076 * step;
        const ratio = Math.min(0.56 + 0.055 * step, 0.94);
        return stat({
          ...full, routineSaves: at(routine), saves: at(key),
          shotsOnTargetFaced: (at(routine) + at(key)) / ratio,
          goalsConcededWhileOnPitch: at(1.08 / step),
          cleanSheetMinutes: (0.24 + 0.05 * step) * minutes,
        });
      }
    }
  };

  it('never scores a strictly better season lower, across the knee', () => {
    // The step range deliberately overshoots every group's P99.9, so the walk
    // crosses from the first segment into the second and out past its end.
    for (const position of positions) {
      let previous = -Infinity;
      for (let step = 0.5; step <= 8.001; step += 0.25) {
        const quality = computePlayerPerformance(position, ladder(position, step)).positionQuality;
        expect(quality).toBeGreaterThanOrEqual(previous);
        previous = quality;
      }
    }
  });
});


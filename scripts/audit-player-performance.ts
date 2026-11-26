import {
  executeCurrentWindow,
  getCurrentWindow,
  initializeGameWorld,
} from '../src/engine/season/season-manager';
import {
  PLAYER_SCORE_CEILING,
  computeSegmentedPlayerPerformance,
} from '../src/engine/players/player-performance';
import type { PlayerPosition, PlayerTeamSeasonStats } from '../src/types/player';

const fast = process.env.PLAYER_PERFORMANCE_AUDIT_FAST === '1';
// Ten seeds x 100 seasons, sampling only the last twenty of each.
//
// The window matters more than the sample size here. The simulator drifts for
// its first sixty to eighty seasons — goals per match fall 2.45 -> 2.17, a
// second-tier keeper's routine saves rise 2.57 -> 3.11 per 90 — and a save is
// played for far longer than that, so the steady state is what the calibration
// actually has to hold up in. The old matrix was 30 seeds x 20 seasons, which is
// entirely inside the opening drift: it read the cross-position P90 spread at
// 4.48 under score version 8 and at 9.80 for the same version measured on
// seasons 81-200. A gate that cannot see a 9.80 is not measuring the thing it
// was written to catch. Same total season budget, one third more wall clock,
// and the number it reports is now the one a long save will experience.
const seedCount = fast ? 2 : 10;
const seasonsPerSeed = fast ? 2 : 100;
const warmupSeasons = fast ? 0 : 80;
const positions: PlayerPosition[] = ['GK', 'DF', 'MF', 'FW'];

interface Sample {
  position: PlayerPosition;
  score: number;
  quality: number;
  availability: number;
  confidence: number;
  leagueStrength: number;
  injuryAbsences: number;
}

const samples: Sample[] = [];
const top20ByPosition = Object.fromEntries(positions.map(position => [position, 0])) as Record<PlayerPosition, number>;
let lowConfidenceTop20 = 0;
let invalidScores = 0;
let invalidAttendance = 0;
let completedSeasons = 0;

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * ratio)] ?? 0;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

for (let seedIndex = 0; seedIndex < seedCount; seedIndex++) {
  let world = initializeGameWorld(20260808 + seedIndex * 104729);
  let seasons = 0;
  let safety = 0;
  while (seasons < seasonsPerSeed && safety < 20_000) {
    const window = getCurrentWindow(world);
    if (!window) throw new Error(`Seed ${seedIndex}: missing calendar window`);
    if (window.type === 'season_end') {
      const playerById = new Map(
        Object.values(world.squads).flat().map(player => [player.uuid, player]),
      );
      const segmentsByPlayer = new Map<string, PlayerTeamSeasonStats[]>();
      for (const segment of Object.values(world.playerStatSegments ?? {})) {
        const rows = segmentsByPlayer.get(segment.playerId) ?? [];
        rows.push(segment);
        segmentsByPlayer.set(segment.playerId, rows);
      }
      const seasonSamples: Sample[] = [];
      // Validity is checked in every season, including the warm-up — an invalid
      // score is wrong wherever it appears. Only the distribution gates wait for
      // the drift to settle.
      const collecting = seasons >= warmupSeasons;
      for (const stat of Object.values(world.playerStats)) {
        const player = playerById.get(stat.playerId);
        if (!player) continue;
        const result = computeSegmentedPlayerPerformance(
          player.position,
          segmentsByPlayer.get(player.uuid) ?? [],
          world.seasonStartLevels ?? {},
          stat,
        );
        const sample: Sample = {
          position: player.position,
          score: result.seasonScore,
          quality: result.positionQuality,
          availability: result.availabilityScore,
          confidence: result.confidence,
          leagueStrength: result.leagueStrength,
          injuryAbsences: result.metrics.injuryAbsenceMatches,
        };
        seasonSamples.push(sample);
        if (collecting) samples.push(sample);
        if (
          !Number.isFinite(sample.score)
          || !Number.isFinite(sample.quality)
          || sample.score < 0
          || sample.score > PLAYER_SCORE_CEILING
          || sample.quality < 0
          || sample.quality > PLAYER_SCORE_CEILING
        ) invalidScores++;
        if (
          result.metrics.missedMatches > result.metrics.teamMatchesAllCompetitions
          || result.metrics.injuryAbsenceMatches > result.metrics.missedMatches
          || result.metrics.appearances > result.metrics.teamMatchesAllCompetitions
        ) invalidAttendance++;
      }
      if (collecting) {
        seasonSamples
          .filter(sample => sample.confidence > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 20)
          .forEach(sample => {
            top20ByPosition[sample.position]++;
            if (sample.confidence < 0.5) lowConfidenceTop20++;
          });
      }
      seasons++;
      completedSeasons++;
    }
    world = executeCurrentWindow(world).world;
    safety++;
  }
  if (seasons !== seasonsPerSeed) {
    throw new Error(`Seed ${seedIndex}: completed ${seasons}/${seasonsPerSeed} seasons`);
  }
}

const trusted = samples.filter(sample => sample.confidence >= 0.5);
const distributions = Object.fromEntries(positions.map(position => {
  const rows = trusted.filter(sample => sample.position === position);
  const scores = rows.map(sample => sample.score);
  const qualities = rows.map(sample => sample.quality);
  return [position, {
    count: rows.length,
    scoreP10: round(percentile(scores, 0.1)),
    scoreMedian: round(percentile(scores, 0.5)),
    scoreP90: round(percentile(scores, 0.9)),
    qualityMedian: round(percentile(qualities, 0.5)),
    qualityP90: round(percentile(qualities, 0.9)),
    // Score version 3 targets a median of 50 and a P99 of 93 at every position.
    qualityP99: round(percentile(qualities, 0.99)),
  }];
})) as Record<PlayerPosition, {
  count: number;
  scoreP10: number;
  scoreMedian: number;
  scoreP90: number;
  qualityMedian: number;
  qualityP90: number;
  qualityP99: number;
}>;

const medians = positions.map(position => distributions[position].scoreMedian);
const p90s = positions.map(position => distributions[position].scoreP90);
const medianSpread = Math.max(...medians) - Math.min(...medians);
const p90Spread = Math.max(...p90s) - Math.min(...p90s);
const top20Total = Object.values(top20ByPosition).reduce((sum, count) => sum + count, 0);
const injured = trusted.filter(sample => sample.injuryAbsences > 0);
const healthy = trusted.filter(sample => sample.injuryAbsences === 0);

// medianSpread was capped at 5 back when the four positions were deliberately
// levelled, and a spread that wide meant an anchor or a scale had drifted. Score
// version 6 introduced POSITION_VALUE_OFFSET, so the positions are now SUPPOSED
// to sit apart, and the cap moved to 8 to give that ordering room. Under version
// 9 the offsets span 10.75 quality points, which is not a free parameter — it is
// what filling a 1:2:3:3 top twenty out of pool shares of 8.9/35.7/34.2/21.2
// costs — and it lands near 6 season-score points once the confidence factor and
// the 0.75 weight are applied. Measured on the steady window this reads 4.80 at
// P90 and 5.10 at the median.
//
// A genuine calibration error still shifts a whole position by far more than the
// cap: the third-tier keeper pinned to 15 out of 120 under the old top-flight
// anchors is the kind of failure this is here to catch. Note that the cap is
// only meaningful because the window above was fixed at the same time — read on
// the opening twenty seasons, version 8 scored 4.48 here and version 9 scores
// 8.49, which says nothing about either version's behaviour in a real save.
const report = {
  passed: invalidScores === 0
    && invalidAttendance === 0
    && medianSpread <= 8
    && p90Spread <= 8
    && lowConfidenceTop20 / Math.max(1, top20Total) <= 0.05,
  matrix: { seedCount, seasonsPerSeed, completedSeasons },
  distributions,
  crossPosition: {
    medianSpread: round(medianSpread),
    p90Spread: round(p90Spread),
    top20ByPosition,
    lowConfidenceTop20,
    lowConfidenceTop20Rate: round(lowConfidenceTop20 / Math.max(1, top20Total), 4),
  },
  availability: {
    trustedInjurySamples: injured.length,
    injuredAverageAvailability: round(injured.reduce((sum, row) => sum + row.availability, 0) / Math.max(1, injured.length)),
    healthyAverageAvailability: round(healthy.reduce((sum, row) => sum + row.availability, 0) / Math.max(1, healthy.length)),
  },
  anomalies: { invalidScores, invalidAttendance },
};

console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;

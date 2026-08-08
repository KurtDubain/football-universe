import {
  executeCurrentWindow,
  getCurrentWindow,
  initializeGameWorld,
} from '../src/engine/season/season-manager';
import { computeSegmentedPlayerPerformance } from '../src/engine/players/player-performance';
import type { PlayerPosition, PlayerTeamSeasonStats } from '../src/types/player';

const fast = process.env.PLAYER_PERFORMANCE_AUDIT_FAST === '1';
const seedCount = fast ? 2 : 30;
const seasonsPerSeed = fast ? 2 : 20;
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
        samples.push(sample);
        if (
          !Number.isFinite(sample.score)
          || !Number.isFinite(sample.quality)
          || sample.score < 0
          || sample.score > 100
          || sample.quality < 0
          || sample.quality > 100
        ) invalidScores++;
        if (
          result.metrics.missedMatches > result.metrics.teamMatchesAllCompetitions
          || result.metrics.injuryAbsenceMatches > result.metrics.missedMatches
          || result.metrics.appearances > result.metrics.teamMatchesAllCompetitions
        ) invalidAttendance++;
      }
      seasonSamples
        .filter(sample => sample.confidence > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
        .forEach(sample => {
          top20ByPosition[sample.position]++;
          if (sample.confidence < 0.5) lowConfidenceTop20++;
        });
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
  }];
})) as Record<PlayerPosition, {
  count: number;
  scoreP10: number;
  scoreMedian: number;
  scoreP90: number;
  qualityMedian: number;
  qualityP90: number;
}>;

const medians = positions.map(position => distributions[position].scoreMedian);
const p90s = positions.map(position => distributions[position].scoreP90);
const medianSpread = Math.max(...medians) - Math.min(...medians);
const p90Spread = Math.max(...p90s) - Math.min(...p90s);
const top20Total = Object.values(top20ByPosition).reduce((sum, count) => sum + count, 0);
const injured = trusted.filter(sample => sample.injuryAbsences > 0);
const healthy = trusted.filter(sample => sample.injuryAbsences === 0);

const report = {
  passed: invalidScores === 0
    && invalidAttendance === 0
    && medianSpread <= 5
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

import LZString from 'lz-string';
import {
  executeCurrentWindow,
  getCurrentWindow,
  initializeGameWorld,
  type GameWorld,
} from '../src/engine/season/season-manager';
import { computePlayerPerformance } from '../src/engine/players/player-performance';
import { validateWorldData } from '../src/engine/validation/world-data';
import { measureWorldSaveSize } from '../src/store/save-size';
import type { MatchResult } from '../src/types/match';
import type { Player, PlayerPosition, PlayerSeasonStats } from '../src/types/player';

interface PositionSample {
  playerId: string;
  playerName: string;
  position: PlayerPosition;
  minutes: number;
  routineSaves: number;
  keySaves: number;
  shotsFaced: number;
  cleanSheetMinutes: number;
  goalsConceded: number;
  interceptions: number;
  clearances: number;
  newScore: number;
  legacyScore: number;
  eligible: boolean;
}

interface RankingComparison {
  seed: number;
  season: number;
  position: 'GK' | 'DF';
  overlap: number;
  legacyTop: string[];
  newTop: string[];
}

interface AuditAccumulator {
  matches: number;
  routineSaves: number;
  keySaves: number;
  goalLineBlocks: number;
  samples: PositionSample[];
  comparisons: RankingComparison[];
  anomalyCounts: Record<string, number>;
  validationErrors: number;
  validationWarnings: number;
  validationCodes: Record<string, number>;
}

const fast = process.env.DEFENSE_AUDIT_FAST === '1';
const { compressToUTF16 } = LZString;
const matrices = fast
  ? [{ seeds: [20260805], seasons: 1 }]
  : [
      { seeds: Array.from({ length: 20 }, (_, index) => 20260805 + index * 7919), seasons: 3 },
      { seeds: Array.from({ length: 10 }, (_, index) => 90260805 + index * 104729), seasons: 10 },
    ];

const accumulator: AuditAccumulator = {
  matches: 0,
  routineSaves: 0,
  keySaves: 0,
  goalLineBlocks: 0,
  samples: [],
  comparisons: [],
  anomalyCounts: {},
  validationErrors: 0,
  validationWarnings: 0,
  validationCodes: {},
};

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function addCount(target: Record<string, number>, key: string, amount = 1): void {
  target[key] = (target[key] ?? 0) + amount;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)));
  return round(sorted[index]);
}

function distribution(values: number[]) {
  return {
    count: values.length,
    min: percentile(values, 0),
    p10: percentile(values, 0.1),
    median: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    max: percentile(values, 1),
    mean: round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)),
  };
}

function per90(value: number, minutes: number): number {
  return minutes > 0 ? value * 90 / minutes : 0;
}

function playerIndex(world: GameWorld): Map<string, Player> {
  return new Map(Object.values(world.squads).flatMap(squad => squad).map(player => [player.uuid, player]));
}

function observeResults(results: MatchResult[]): void {
  for (const result of results) {
    accumulator.matches++;
    for (const event of result.events ?? []) {
      if (event.type === 'save') accumulator.routineSaves++;
      if (event.type === 'gk_save') accumulator.keySaves++;
      if (event.type === 'df_block') accumulator.goalLineBlocks++;
    }
    for (const contribution of Object.values(result.defensiveContributions ?? {})) {
      accumulator.routineSaves += contribution.routineSaves ?? 0;
    }
  }
}

function legacyScore(position: 'GK' | 'DF', stat: PlayerSeasonStats): number {
  if (position === 'GK') return stat.cleanSheets * 2 + stat.saves * 0.5 + stat.appearances * 0.1;
  return stat.cleanSheets * 2 + stat.keyBlocks * 0.8 + stat.appearances * 0.1;
}

function noteAnomalies(position: PlayerPosition, stat: PlayerSeasonStats): void {
  const numericFields = [
    'routineSaves', 'shotsOnTargetFaced', 'cleanSheetMinutes',
    'goalsConcededWhileOnPitch', 'interceptions', 'clearances',
  ] as const;
  for (const field of numericFields) {
    const value = stat[field] ?? 0;
    if (!Number.isFinite(value) || value < 0) addCount(accumulator.anomalyCounts, `invalid_${field}`);
  }
  const minutes = stat.minutesPlayed ?? stat.appearances * 90;
  if ((stat.cleanSheetMinutes ?? 0) > minutes) addCount(accumulator.anomalyCounts, 'clean_sheet_minutes_over_minutes');
  if (position !== 'GK' && ((stat.routineSaves ?? 0) > 0 || (stat.shotsOnTargetFaced ?? 0) > 0)) {
    addCount(accumulator.anomalyCounts, 'goalkeeper_stat_on_outfielder');
  }
  if (position !== 'DF' && ((stat.interceptions ?? 0) > 0 || (stat.clearances ?? 0) > 0)) {
    addCount(accumulator.anomalyCounts, 'defender_stat_on_other_position');
  }
  if (position === 'GK') {
    const expectedShots = (stat.routineSaves ?? 0) + stat.saves + (stat.goalsConcededWhileOnPitch ?? 0);
    if ((stat.shotsOnTargetFaced ?? 0) !== expectedShots) addCount(accumulator.anomalyCounts, 'goalkeeper_shots_faced_mismatch');
  }
}

function observeSeason(world: GameWorld, seed: number): void {
  const validation = validateWorldData(world);
  accumulator.validationErrors += validation.errors.length;
  accumulator.validationWarnings += validation.warnings.length;
  for (const issue of validation.issues) addCount(accumulator.validationCodes, issue.code);

  const players = playerIndex(world);
  const seasonSamples: PositionSample[] = [];
  for (const stat of Object.values(world.playerStats)) {
    const player = players.get(stat.playerId);
    if (!player) continue;
    noteAnomalies(player.position, stat);
    if (player.position !== 'GK' && player.position !== 'DF') continue;
    const performance = computePlayerPerformance(
      player.position,
      stat,
      world.teamStates[stat.teamId]?.leagueLevel,
    );
    const sample: PositionSample = {
      playerId: stat.playerId,
      playerName: player.name,
      position: player.position,
      minutes: performance.metrics.minutes,
      routineSaves: stat.routineSaves ?? 0,
      keySaves: stat.saves,
      shotsFaced: stat.shotsOnTargetFaced ?? 0,
      cleanSheetMinutes: stat.cleanSheetMinutes ?? 0,
      goalsConceded: stat.goalsConcededWhileOnPitch ?? 0,
      interceptions: stat.interceptions ?? 0,
      clearances: stat.clearances ?? 0,
      newScore: performance.score,
      legacyScore: legacyScore(player.position, stat),
      eligible: performance.eligible,
    };
    seasonSamples.push(sample);
    accumulator.samples.push(sample);
  }

  for (const position of ['GK', 'DF'] as const) {
    const eligible = seasonSamples.filter(sample => sample.position === position && sample.eligible);
    const oldTop = [...eligible].sort((a, b) => b.legacyScore - a.legacyScore).slice(0, 10);
    const newTop = [...eligible].sort((a, b) => b.newScore - a.newScore).slice(0, 10);
    const newIds = new Set(newTop.map(sample => sample.playerId));
    accumulator.comparisons.push({
      seed,
      season: world.seasonState.seasonNumber,
      position,
      overlap: oldTop.filter(sample => newIds.has(sample.playerId)).length,
      legacyTop: oldTop.map(sample => sample.playerName),
      newTop: newTop.map(sample => sample.playerName),
    });
  }
}

function run(seed: number, seasons: number): GameWorld {
  let world = initializeGameWorld(seed);
  let completed = 0;
  let safety = 0;
  while (completed < seasons && safety < 10_000) {
    const window = getCurrentWindow(world);
    if (!window) throw new Error(`Seed ${seed}: no current window in season ${world.seasonState.seasonNumber}`);
    if (window.type === 'season_end') {
      observeSeason(world, seed);
      completed++;
      if (completed >= seasons) break;
    }
    const execution = executeCurrentWindow(world);
    observeResults(execution.results);
    world = execution.world;
    safety++;
  }
  if (completed !== seasons) throw new Error(`Seed ${seed}: completed ${completed}/${seasons} seasons`);
  return world;
}

function stripDefensiveFields(world: GameWorld): GameWorld {
  const clone = JSON.parse(JSON.stringify(world)) as GameWorld;
  const fields = [
    'routineSaves', 'shotsOnTargetFaced', 'cleanSheetMinutes',
    'goalsConcededWhileOnPitch', 'interceptions', 'clearances',
  ];
  const strip = (row: Record<string, unknown>) => fields.forEach(field => delete row[field]);
  Object.values(clone.playerStats).forEach(row => strip(row as unknown as Record<string, unknown>));
  Object.values(clone.playerStatSegments ?? {}).forEach(row => strip(row as unknown as Record<string, unknown>));
  Object.values(clone.playerStatsHistory ?? {}).flat().forEach(row => strip(row as unknown as Record<string, unknown>));
  for (const window of clone.seasonState.calendar) {
    for (const result of window.results ?? []) {
      delete result.defensiveContributions;
      result.events = result.events.filter(event => event.type !== 'save');
    }
  }
  return clone;
}

let largestWorld: GameWorld | null = null;
const matrixReports = matrices.map((matrix) => {
  const started = Date.now();
  for (const seed of matrix.seeds) {
    const world = run(seed, matrix.seasons);
    if (!largestWorld || JSON.stringify(world).length > JSON.stringify(largestWorld).length) largestWorld = world;
  }
  return {
    seeds: matrix.seeds.length,
    seasonsPerSeed: matrix.seasons,
    completedSeasons: matrix.seeds.length * matrix.seasons,
    elapsedMs: Date.now() - started,
  };
});

if (!largestWorld) throw new Error('Audit produced no world');
const currentSize = measureWorldSaveSize(largestWorld, 'current', compressToUTF16).total;
const strippedWorld = stripDefensiveFields(largestWorld);
const strippedSize = measureWorldSaveSize(strippedWorld, 'without-new-defense', compressToUTF16).total;

const goalkeeperSamples = accumulator.samples.filter(sample => sample.position === 'GK' && sample.eligible);
const defenderSamples = accumulator.samples.filter(sample => sample.position === 'DF' && sample.eligible);
const cleanSheetBands = [
  { label: '<600', min: 0, max: 599 },
  { label: '600-1799', min: 600, max: 1799 },
  { label: '1800+', min: 1800, max: Number.POSITIVE_INFINITY },
].map((band) => {
  const rows = accumulator.samples.filter(sample => sample.minutes >= band.min && sample.minutes <= band.max);
  return {
    band: band.label,
    count: rows.length,
    averageMinutes: round(rows.reduce((sum, row) => sum + row.minutes, 0) / Math.max(1, rows.length)),
    averageCleanSheetMinutes: round(rows.reduce((sum, row) => sum + row.cleanSheetMinutes, 0) / Math.max(1, rows.length)),
    averageContributionRate: round(rows.reduce(
      (sum, row) => sum + row.cleanSheetMinutes / Math.max(1, row.minutes),
      0,
    ) / Math.max(1, rows.length)),
  };
});

const comparisonSummary = (position: 'GK' | 'DF') => {
  const rows = accumulator.comparisons.filter(row => row.position === position);
  const lowest = [...rows].sort((a, b) => a.overlap - b.overlap)[0];
  return {
    seasonsCompared: rows.length,
    averageTop10Overlap: round(rows.reduce((sum, row) => sum + row.overlap, 0) / Math.max(1, rows.length)),
    lowestOverlapExample: lowest,
  };
};

const report = {
  passed: Object.keys(accumulator.anomalyCounts).length === 0
    && accumulator.validationErrors === 0
    && accumulator.validationWarnings === 0,
  matrices: matrixReports,
  matchTotals: {
    matches: accumulator.matches,
    routineSavesPerMatch: round(accumulator.routineSaves / Math.max(1, accumulator.matches)),
    keySavesPerMatch: round(accumulator.keySaves / Math.max(1, accumulator.matches)),
    goalLineBlocksPerMatch: round(accumulator.goalLineBlocks / Math.max(1, accumulator.matches)),
  },
  goalkeeperDistribution: {
    savePercentage: distribution(goalkeeperSamples.map(sample => (
      (sample.routineSaves + sample.keySaves) / Math.max(1, sample.shotsFaced)
    ))),
    routineSavesPer90: distribution(goalkeeperSamples.map(sample => per90(sample.routineSaves, sample.minutes))),
    keySavesPer90: distribution(goalkeeperSamples.map(sample => per90(sample.keySaves, sample.minutes))),
    goalsConcededPer90: distribution(goalkeeperSamples.map(sample => per90(sample.goalsConceded, sample.minutes))),
    score: distribution(goalkeeperSamples.map(sample => sample.newScore)),
  },
  defenderDistribution: {
    interceptionsPer90: distribution(defenderSamples.map(sample => per90(sample.interceptions, sample.minutes))),
    clearancesPer90: distribution(defenderSamples.map(sample => per90(sample.clearances, sample.minutes))),
    goalsConcededPer90: distribution(defenderSamples.map(sample => per90(sample.goalsConceded, sample.minutes))),
    score: distribution(defenderSamples.map(sample => sample.newScore)),
  },
  cleanSheetContributionByMinutes: cleanSheetBands,
  rankingChanges: {
    goalkeepers: comparisonSummary('GK'),
    defenders: comparisonSummary('DF'),
  },
  saveSize: {
    currentRawBytes: currentSize.rawBytes,
    currentCompressedBytes: currentSize.compressedBytes,
    estimatedAddedRawBytes: currentSize.rawBytes - strippedSize.rawBytes,
    estimatedAddedCompressedBytes: currentSize.compressedBytes - strippedSize.compressedBytes,
    estimatedCompressedIncreasePct: round(
      (currentSize.compressedBytes - strippedSize.compressedBytes) / Math.max(1, strippedSize.compressedBytes) * 100,
    ),
  },
  compatibility: { oldStyleOptionalFieldsLoad: 'covered by parseCurrentSave unit test' },
  validation: {
    errors: accumulator.validationErrors,
    warnings: accumulator.validationWarnings,
    codes: accumulator.validationCodes,
  },
  anomalies: accumulator.anomalyCounts,
};

console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;

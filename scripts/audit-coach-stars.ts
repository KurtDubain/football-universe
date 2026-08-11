import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import LZString from 'lz-string';
import {
  executeCurrentWindow,
  getCurrentWindow,
  initializeGameWorld,
  type GameWorld,
} from '../src/engine/season/season-manager';
import { validateWorldData } from '../src/engine/validation/world-data';
import {
  buildRecentPlayerForm,
  selectStarObservations,
} from '../src/engine/players/star-presence';
import { measureWorldSaveSize } from '../src/store/save-size';
import type { CoachFormation, MatchApproach } from '../src/types/coach';
import type { MatchResult } from '../src/types/match';
import type { Player, PlayerPosition } from '../src/types/player';

const fast = process.env.COACH_STAR_AUDIT_FAST === '1';
const probe = process.env.COACH_STAR_AUDIT_PROBE === '1';
const positions: PlayerPosition[] = ['GK', 'DF', 'MF', 'FW'];
const formations: CoachFormation[] = ['4-3-3', '4-2-3-1', '4-4-2', '5-4-1'];
const approaches: MatchApproach[] = ['pressing', 'control', 'balanced', 'counter', 'low_block'];
const matrices = fast
  ? [
      { name: 'long', seeds: [20260812, 20365531], seasons: 3, checkpoints: [0, 3] },
      { name: 'endurance', seeds: [90260812], seasons: 5, checkpoints: [5] },
    ]
  : probe
    ? [
        { name: 'long', seeds: [20260812], seasons: 3, checkpoints: [0, 3] },
        { name: 'endurance', seeds: [90260812], seasons: 100, checkpoints: [50, 100] },
      ]
  : [
      {
        name: 'long',
        seeds: Array.from({ length: 20 }, (_, index) => 20260812 + index * 104729),
        seasons: 30,
        checkpoints: [0, 10, 30],
      },
      {
        name: 'endurance',
        seeds: Array.from({ length: 5 }, (_, index) => 90260812 + index * 130363),
        seasons: 100,
        checkpoints: [50, 100],
      },
    ];

interface OutcomeBucket {
  appearances: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  possessionTotal: number;
  expectedPoints: number;
  expectedSamples: number;
  counterOrigins: number;
  openPlayOrigins: number;
}

interface HorizonBucket {
  worlds: number;
  ratings: number[];
  count85: number[];
  count90: number[];
  u23Count80: number[];
  focusCounts: number[];
  risingCounts: number[];
  count85ByPosition: Record<PlayerPosition, number[]>;
}

interface AuditState {
  matches: number;
  goals: number;
  draws: number;
  formations: Record<CoachFormation, OutcomeBucket>;
  approaches: Record<MatchApproach, OutcomeBucket>;
  coachStyles: Record<string, Record<MatchApproach, number>>;
  motmByPosition: Record<PlayerPosition | 'unknown', number>;
  featuredByPosition: Record<PlayerPosition, number>;
  featuredMatches: number;
  missingTactics: number;
  invalidTacticalValues: number;
  invalidFeaturedSnapshots: number;
  validationErrors: number;
  validationWarnings: number;
  validationCodes: Record<string, number>;
  executionTimes: number[];
  horizons: Record<string, HorizonBucket>;
}

function emptyOutcome(): OutcomeBucket {
  return {
    appearances: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    possessionTotal: 0,
    expectedPoints: 0,
    expectedSamples: 0,
    counterOrigins: 0,
    openPlayOrigins: 0,
  };
}

const audit: AuditState = {
  matches: 0,
  goals: 0,
  draws: 0,
  formations: Object.fromEntries(formations.map(formation => [formation, emptyOutcome()])) as Record<CoachFormation, OutcomeBucket>,
  approaches: Object.fromEntries(approaches.map(approach => [approach, emptyOutcome()])) as Record<MatchApproach, OutcomeBucket>,
  coachStyles: {},
  motmByPosition: { GK: 0, DF: 0, MF: 0, FW: 0, unknown: 0 },
  featuredByPosition: { GK: 0, DF: 0, MF: 0, FW: 0 },
  featuredMatches: 0,
  missingTactics: 0,
  invalidTacticalValues: 0,
  invalidFeaturedSnapshots: 0,
  validationErrors: 0,
  validationWarnings: 0,
  validationCodes: {},
  executionTimes: [],
  horizons: {},
};

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * ratio)] ?? 0;
}

function increment(target: Record<string, number>, key: string, amount = 1): void {
  target[key] = (target[key] ?? 0) + amount;
}

function activePlayers(world: GameWorld): Player[] {
  return Object.values(world.squads).flat();
}

function currentSeasonResults(world: GameWorld): MatchResult[] {
  return world.seasonState.calendar.flatMap(window => window.results ?? []);
}

function horizonBucket(label: string): HorizonBucket {
  if (!audit.horizons[label]) {
    audit.horizons[label] = {
      worlds: 0,
      ratings: [],
      count85: [],
      count90: [],
      u23Count80: [],
      focusCounts: [],
      risingCounts: [],
      count85ByPosition: { GK: [], DF: [], MF: [], FW: [] },
    };
  }
  return audit.horizons[label];
}

function observeWorld(world: GameWorld, label: string): void {
  const players = activePlayers(world);
  const playerMap = new Map(players.map(player => [player.uuid, player]));
  const recentForms = buildRecentPlayerForm(currentSeasonResults(world), playerMap);
  const observations = selectStarObservations(players, {
    playerStats: world.playerStats,
    playerStatSegments: world.playerStatSegments,
    seasonStartLevels: world.seasonStartLevels,
  }, recentForms);
  const bucket = horizonBucket(label);
  bucket.worlds++;
  bucket.ratings.push(...players.map(player => player.rating));
  bucket.count85.push(players.filter(player => player.rating >= 85).length);
  bucket.count90.push(players.filter(player => player.rating >= 90).length);
  bucket.u23Count80.push(players.filter(player => player.age <= 22 && player.rating >= 80).length);
  bucket.focusCounts.push(observations.worldFocus.length);
  bucket.risingCounts.push(observations.risingStars.length);
  for (const position of positions) {
    bucket.count85ByPosition[position].push(
      players.filter(player => player.position === position && player.rating >= 85).length,
    );
  }
}

function matchWinner(result: MatchResult): string | null {
  const home = result.homeGoals + (result.etHomeGoals ?? 0);
  const away = result.awayGoals + (result.etAwayGoals ?? 0);
  if (home > away) return result.homeTeamId;
  if (away > home) return result.awayTeamId;
  if ((result.penaltyHome ?? 0) > (result.penaltyAway ?? 0)) return result.homeTeamId;
  if ((result.penaltyAway ?? 0) > (result.penaltyHome ?? 0)) return result.awayTeamId;
  return null;
}

function observeSide(
  result: MatchResult,
  side: 'home' | 'away',
  winnerId: string | null,
  coachStyle: string | undefined,
): void {
  const tactics = side === 'home' ? result.homeTactics : result.awayTactics;
  if (!tactics) {
    audit.missingTactics++;
    return;
  }
  const teamId = side === 'home' ? result.homeTeamId : result.awayTeamId;
  const goalsFor = side === 'home'
    ? result.homeGoals + (result.etHomeGoals ?? 0)
    : result.awayGoals + (result.etAwayGoals ?? 0);
  const goalsAgainst = side === 'home'
    ? result.awayGoals + (result.etAwayGoals ?? 0)
    : result.homeGoals + (result.etHomeGoals ?? 0);
  const prediction = result.prediction;
  const expectedPoints = prediction
    ? ((side === 'home' ? prediction.homeWinPct : prediction.awayWinPct) + prediction.drawPct * 0.5) / 100
    : null;
  const buckets = [audit.formations[tactics.formation], audit.approaches[tactics.approach]];
  for (const bucket of buckets) {
    bucket.appearances++;
    if (winnerId === null) bucket.draws++;
    else if (winnerId === teamId) bucket.wins++;
    else bucket.losses++;
    bucket.goalsFor += goalsFor;
    bucket.goalsAgainst += goalsAgainst;
    bucket.possessionTotal += result.stats.possession[side === 'home' ? 0 : 1];
    if (expectedPoints !== null) {
      bucket.expectedPoints += expectedPoints;
      bucket.expectedSamples++;
    }
  }
  if (coachStyle) {
    audit.coachStyles[coachStyle] ??= Object.fromEntries(approaches.map(approach => [approach, 0])) as Record<MatchApproach, number>;
    audit.coachStyles[coachStyle][tactics.approach]++;
  }
  for (const event of result.events) {
    if (event.teamId !== teamId || (event.type !== 'goal' && event.type !== 'miss')) continue;
    if (event.playOrigin === 'counter') {
      audit.formations[tactics.formation].counterOrigins++;
      audit.approaches[tactics.approach].counterOrigins++;
    } else if (event.playOrigin === 'open_play' || event.playOrigin === undefined) {
      audit.formations[tactics.formation].openPlayOrigins++;
      audit.approaches[tactics.approach].openPlayOrigins++;
    }
  }
  const values = [tactics.attackDelta, tactics.midfieldDelta, tactics.defenseDelta];
  if (values.some(value => !Number.isFinite(value) || Math.abs(value) > 3)) {
    audit.invalidTacticalValues++;
  }
}

function observeResult(world: GameWorld, result: MatchResult): void {
  audit.matches++;
  const homeGoals = result.homeGoals + (result.etHomeGoals ?? 0);
  const awayGoals = result.awayGoals + (result.etAwayGoals ?? 0);
  audit.goals += homeGoals + awayGoals;
  const winnerId = matchWinner(result);
  if (winnerId === null) audit.draws++;
  const homeCoachId = Object.values(world.coachStates).find(state => state.currentTeamId === result.homeTeamId)?.id;
  const awayCoachId = Object.values(world.coachStates).find(state => state.currentTeamId === result.awayTeamId)?.id;
  observeSide(result, 'home', winnerId, homeCoachId ? world.coachBases[homeCoachId]?.style : undefined);
  observeSide(result, 'away', winnerId, awayCoachId ? world.coachBases[awayCoachId]?.style : undefined);

  const snapshots = [result.homeMatchday, result.awayMatchday].filter(Boolean);
  const starterIds = new Set(snapshots.flatMap(snapshot => snapshot?.players
    .filter(player => player.role === 'starter' || player.enteredMinute === 0)
    .map(player => player.playerId) ?? []));
  const snapshotPositions = new Map(snapshots.flatMap(snapshot => snapshot?.players
    .map(player => [player.playerId, player.position] as const) ?? []));
  const featured = result.featuredPlayers ?? [];
  if (featured.length > 0) audit.featuredMatches++;
  const featuredIds = new Set<string>();
  if (featured.length > 5) audit.invalidFeaturedSnapshots++;
  for (const player of featured) {
    audit.featuredByPosition[player.position]++;
    if (
      featuredIds.has(player.playerId)
      || !starterIds.has(player.playerId)
      || player.marginalUnitImpact < 0
      || !Number.isFinite(player.marginalUnitImpact)
    ) audit.invalidFeaturedSnapshots++;
    featuredIds.add(player.playerId);
  }
  if (result.motm) {
    const position = snapshotPositions.get(result.motm.playerId) ?? 'unknown';
    audit.motmByPosition[position]++;
  }
}

function validateWorld(world: GameWorld): void {
  const validation = validateWorldData(world);
  audit.validationErrors += validation.errors.length;
  audit.validationWarnings += validation.warnings.length;
  for (const issue of validation.issues) increment(audit.validationCodes, issue.code);
}

function stripNewPresentationFields(world: GameWorld): GameWorld {
  const clone = JSON.parse(JSON.stringify(world)) as GameWorld;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    delete record.homeTactics;
    delete record.awayTactics;
    delete record.featuredPlayers;
    Object.values(record).forEach(visit);
  };
  visit(clone);
  Object.values(clone.coachBases).forEach(coach => delete coach.preferredFormation);
  return clone;
}

function digestAfterSeasons(seed: number, seasons: number): string {
  let world = initializeGameWorld(seed);
  let completed = 0;
  let safety = 0;
  while (completed < seasons && safety++ < seasons * 100) {
    const window = getCurrentWindow(world);
    if (!window) throw new Error(`Determinism seed ${seed}: missing window`);
    if (window.type === 'season_end') {
      completed++;
      if (completed >= seasons) break;
    }
    world = executeCurrentWindow(world).world;
  }
  return createHash('sha256').update(JSON.stringify(world)).digest('hex');
}

let largestWorld: GameWorld | null = null;
const matrixReports = matrices.map(matrix => {
  const startedAt = performance.now();
  let advances = 0;
  for (const seed of matrix.seeds) {
    let world = initializeGameWorld(seed);
    if (matrix.checkpoints.includes(0)) observeWorld(world, `${matrix.name}:S1-start`);
    let completed = 0;
    let safety = 0;
    while (completed < matrix.seasons && safety++ < matrix.seasons * 100) {
      const window = getCurrentWindow(world);
      if (!window) throw new Error(`${matrix.name}/${seed}: missing window after ${completed} seasons`);
      if (window.type === 'season_end') {
        completed++;
        if (matrix.checkpoints.includes(completed)) observeWorld(world, `${matrix.name}:S${completed}-end`);
        if (completed >= matrix.seasons) break;
      }
      const before = performance.now();
      const execution = executeCurrentWindow(world);
      audit.executionTimes.push(performance.now() - before);
      advances++;
      for (const result of execution.results) observeResult(world, result);
      world = execution.world;
    }
    if (completed !== matrix.seasons) {
      throw new Error(`${matrix.name}/${seed}: completed ${completed}/${matrix.seasons} seasons`);
    }
    validateWorld(world);
    if (!largestWorld || world.seasonState.seasonNumber > largestWorld.seasonState.seasonNumber) {
      largestWorld = world;
    }
  }
  return {
    name: matrix.name,
    seeds: matrix.seeds.length,
    seasonsPerSeed: matrix.seasons,
    completedSeasons: matrix.seeds.length * matrix.seasons,
    advances,
    elapsedMs: round(performance.now() - startedAt, 1),
  };
});

if (!largestWorld) throw new Error('Coach/star audit produced no world');
const { compressToUTF16 } = LZString;
const currentSize = measureWorldSaveSize(largestWorld, 'coach-stars', compressToUTF16).total;
const strippedSize = measureWorldSaveSize(stripNewPresentationFields(largestWorld), 'without-coach-stars', compressToUTF16).total;
const determinismDigest = digestAfterSeasons(20260812, fast ? 1 : 3);
const determinismRepeat = digestAfterSeasons(20260812, fast ? 1 : 3);

function outcomeReport(bucket: OutcomeBucket) {
  const actualPoints = (bucket.wins + bucket.draws * 0.5) / Math.max(1, bucket.appearances);
  const expectedPoints = bucket.expectedPoints / Math.max(1, bucket.expectedSamples);
  const openOrigins = bucket.counterOrigins + bucket.openPlayOrigins;
  return {
    appearances: bucket.appearances,
    share: round(bucket.appearances / Math.max(1, audit.matches * 2), 4),
    winRate: round(bucket.wins / Math.max(1, bucket.appearances), 4),
    drawRate: round(bucket.draws / Math.max(1, bucket.appearances), 4),
    goalsFor: round(bucket.goalsFor / Math.max(1, bucket.appearances)),
    goalsAgainst: round(bucket.goalsAgainst / Math.max(1, bucket.appearances)),
    possession: round(bucket.possessionTotal / Math.max(1, bucket.appearances)),
    expectedPoints: round(expectedPoints, 4),
    actualPoints: round(actualPoints, 4),
    calibrationGap: round(actualPoints - expectedPoints, 4),
    counterOriginRate: round(bucket.counterOrigins / Math.max(1, openOrigins), 4),
  };
}

const horizonReports = Object.fromEntries(Object.entries(audit.horizons).map(([label, bucket]) => [label, {
  worlds: bucket.worlds,
  activePlayers: bucket.ratings.length,
  ratingP50: round(percentile(bucket.ratings, 0.5)),
  ratingP90: round(percentile(bucket.ratings, 0.9)),
  ratingP95: round(percentile(bucket.ratings, 0.95)),
  ratingMax: round(percentile(bucket.ratings, 1)),
  average85Plus: round(average(bucket.count85)),
  average90Plus: round(average(bucket.count90)),
  averageU23At80Plus: round(average(bucket.u23Count80)),
  averageWorldFocus: round(average(bucket.focusCounts)),
  averageRisingStars: round(average(bucket.risingCounts)),
  average85PlusByPosition: Object.fromEntries(positions.map(position => [
    position,
    round(average(bucket.count85ByPosition[position])),
  ])),
}])) as Record<string, {
  worlds: number;
  activePlayers: number;
  ratingP50: number;
  ratingP90: number;
  ratingP95: number;
  ratingMax: number;
  average85Plus: number;
  average90Plus: number;
  averageU23At80Plus: number;
  averageWorldFocus: number;
  averageRisingStars: number;
  average85PlusByPosition: Record<PlayerPosition, number>;
}>;

const formationReports = Object.fromEntries(formations.map(formation => [formation, outcomeReport(audit.formations[formation])])) as Record<CoachFormation, ReturnType<typeof outcomeReport>>;
const approachReports = Object.fromEntries(approaches.map(approach => [approach, outcomeReport(audit.approaches[approach])])) as Record<MatchApproach, ReturnType<typeof outcomeReport>>;
const fullReplacement = horizonReports['endurance:S100-end'];
const initial = horizonReports['long:S1-start'];
const tacticalCalibrationGap = Math.max(
  ...Object.values(approachReports).filter(row => row.appearances >= 100).map(row => Math.abs(row.calibrationGap)),
  ...Object.values(formationReports).filter(row => row.appearances >= 100).map(row => Math.abs(row.calibrationGap)),
  0,
);
const allPositionsRetainStars = fullReplacement
  ? positions.every(position => fullReplacement.average85PlusByPosition[position] > 0)
  : false;
const saveIncreasePct = (currentSize.compressedBytes - strippedSize.compressedBytes)
  / Math.max(1, strippedSize.compressedBytes) * 100;
const totalFeaturedPlayers = Object.values(audit.featuredByPosition).reduce((sum, count) => sum + count, 0);
const featuredMatchRate = audit.featuredMatches / Math.max(1, audit.matches);
const featuredPlayersPerMatch = totalFeaturedPlayers / Math.max(1, audit.matches);
const checks = {
  deterministic: determinismDigest === determinismRepeat,
  noValidationIssues: audit.validationErrors === 0 && audit.validationWarnings === 0,
  tacticsAlwaysFrozen: audit.missingTactics === 0,
  tacticalValuesBounded: audit.invalidTacticalValues === 0,
  featuredSnapshotsValid: audit.invalidFeaturedSnapshots === 0,
  everyFormationUsed: formations.every(formation => formationReports[formation].appearances > 0),
  everyApproachUsed: approaches.every(approach => approachReports[approach].appearances > 0),
  noTacticalMonoculture: Object.values(formationReports).every(row => row.share < 0.6)
    && Object.values(approachReports).every(row => row.share < 0.5),
  reasonableScoreline: audit.goals / Math.max(1, audit.matches) >= 1.5
    && audit.goals / Math.max(1, audit.matches) <= 4,
  reasonableDrawRate: audit.draws / Math.max(1, audit.matches) >= 0.12
    && audit.draws / Math.max(1, audit.matches) <= 0.38,
  tacticsCalibrated: tacticalCalibrationGap <= (fast ? 0.12 : 0.035),
  counterIdentityVisible: approachReports.counter.counterOriginRate > approachReports.control.counterOriginRate
    && approachReports.counter.counterOriginRate > approachReports.pressing.counterOriginRate,
  longTermStarsSustainable: fast || (Boolean(fullReplacement)
    && fullReplacement.average85Plus >= 25
    && fullReplacement.average85Plus <= 45
    && fullReplacement.average90Plus >= 6
    && fullReplacement.average90Plus <= 15),
  risingStarsSustainable: fast || (Boolean(fullReplacement)
    && fullReplacement.averageU23At80Plus >= 3
    && fullReplacement.averageU23At80Plus <= 10),
  allPositionsRetainStars: fast || allPositionsRetainStars,
  noPopulationInflation: fast || (Boolean(initial && fullReplacement)
    && fullReplacement.ratingP50 <= initial.ratingP50 + 4
    && fullReplacement.ratingP90 <= initial.ratingP90 + 5),
  saveIncreaseUnderThreePct: fast || saveIncreasePct <= 3,
  liveFocusRemainsSelective: featuredMatchRate >= 0.2
    && featuredMatchRate <= 0.8
    && featuredPlayersPerMatch >= 0.5
    && featuredPlayersPerMatch <= 3
    && positions.every(position => audit.featuredByPosition[position] > 0),
  advancementPerformance: percentile(audit.executionTimes, 0.95) <= 30,
};

const report = {
  passed: Object.values(checks).every(Boolean),
  mode: fast ? 'fast' : probe ? 'probe' : 'full',
  matrices: matrixReports,
  checks,
  matches: {
    total: audit.matches,
    goalsPerMatch: round(audit.goals / Math.max(1, audit.matches)),
    drawRate: round(audit.draws / Math.max(1, audit.matches), 4),
  },
  formations: formationReports,
  approaches: approachReports,
  coachStyles: audit.coachStyles,
  stars: {
    horizons: horizonReports,
    featuredMatches: audit.featuredMatches,
    featuredMatchRate: round(featuredMatchRate, 4),
    featuredPlayersPerMatch: round(featuredPlayersPerMatch),
    featuredByPosition: audit.featuredByPosition,
    motmByPosition: audit.motmByPosition,
  },
  performance: {
    advances: audit.executionTimes.length,
    p50Ms: round(percentile(audit.executionTimes, 0.5)),
    p95Ms: round(percentile(audit.executionTimes, 0.95)),
    maxMs: round(percentile(audit.executionTimes, 1)),
    heapUsedMb: round(process.memoryUsage().heapUsed / 1024 / 1024, 1),
  },
  saveSize: {
    season: largestWorld.seasonState.seasonNumber,
    currentCompressedBytes: currentSize.compressedBytes,
    estimatedAddedCompressedBytes: currentSize.compressedBytes - strippedSize.compressedBytes,
    estimatedIncreasePct: round(saveIncreasePct),
  },
  validation: {
    errors: audit.validationErrors,
    warnings: audit.validationWarnings,
    codes: audit.validationCodes,
    missingTactics: audit.missingTactics,
    invalidTacticalValues: audit.invalidTacticalValues,
    invalidFeaturedSnapshots: audit.invalidFeaturedSnapshots,
  },
  determinism: { digest: determinismDigest, repeat: determinismRepeat },
};

console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;

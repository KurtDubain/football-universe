import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { buildObservationTheme } from '../src/engine/observation/observation-theme';
import { advanceNarrativeMemory } from '../src/engine/observation/narrative-director';
import { buildMatchdayNarrativeDigest } from '../src/engine/observation/narrative-sources';
import {
  buildWorldNarrativeCandidates,
  WORLD_NARRATIVE_CAPS,
} from '../src/engine/observation/narrative-world-scan';
import type {
  NarrativeDigest,
  NarrativeEditorialState,
  NarrativeMemoryEntry,
  NarrativeSource,
} from '../src/engine/observation/narrative-types';
import { pickFocusMatches } from '../src/engine/season/match-importance';
import {
  executeCurrentWindow,
  getCurrentWindow,
  initializeGameWorld,
  type GameWorld,
} from '../src/engine/season/season-manager';
import { validateWorldData } from '../src/engine/validation/world-data';

const seedCount = Number.parseInt(process.env.NARRATIVE_AUDIT_SEEDS ?? '8', 10);
const seasonsPerSeed = Number.parseInt(process.env.NARRATIVE_AUDIT_SEASONS ?? '8', 10);
const baselineSeedCount = Number.parseInt(process.env.NARRATIVE_BASELINE_SEEDS ?? '2', 10);
const baselineSeasons = Number.parseInt(process.env.NARRATIVE_BASELINE_SEASONS ?? '5', 10);

for (const [label, value] of Object.entries({ seedCount, seasonsPerSeed, baselineSeedCount, baselineSeasons })) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
}

const derivedSources = ['player_story', 'coach_story', 'transfer', 'competition', 'record'] as const;
type DerivedSource = typeof derivedSources[number];

const candidateCounts = Object.fromEntries(derivedSources.map(source => [source, 0])) as Record<DerivedSource, number>;
const selectedCounts = Object.fromEntries(derivedSources.map(source => [source, 0])) as Record<DerivedSource, number>;
const selectedAllSources: Partial<Record<NarrativeSource, number>> = {};
const worldMomentSources: Partial<Record<NarrativeSource, number>> = {};
const buildDurations: number[] = [];
const digestDurations: number[] = [];
const violations: string[] = [];
let windowsScanned = 0;
let maxCandidatePool = 0;
let maxDigestPool = 0;
let digestWithFeature = 0;
let digestWithWorldMoment = 0;
let maxMoreItems = 0;
let emergentPlayerCandidates = 0;
const editorialStateCounts: Record<NarrativeEditorialState, number> = {
  new: 0,
  changed: 0,
  ongoing: 0,
};
const playerLeaderPositions = new Set<string>();
let baselineWindows = 0;

function digestWorld(world: GameWorld): string {
  return createHash('sha256').update(JSON.stringify(world)).digest('hex');
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function activePlayerIds(world: GameWorld): Set<string> {
  return new Set(Object.values(world.squads).flat().map(player => player.uuid));
}

function checkDestinations(world: GameWorld, digest: NarrativeDigest, label: string): void {
  const players = activePlayerIds(world);
  const retainedPlayers = new Set([
    ...players,
    ...(world.retirementHistory ?? []).map(player => player.uuid),
    ...Object.keys(world.playerStatsHistory ?? {}),
  ]);
  const currentFixtureIds = new Set(getCurrentWindow(world)?.fixtures.map(fixture => fixture.id) ?? []);
  const retainedFixtureIds = new Set((world.memorableMatches ?? []).map(match => match.result.fixtureId));
  const items = [digest.worldMoment, digest.feature, ...digest.signals, ...digest.more]
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  for (const item of items) {
    for (const destination of item.destinations ?? []) {
      if (destination.fixtureId
        && !currentFixtureIds.has(destination.fixtureId)
        && !retainedFixtureIds.has(destination.fixtureId)) {
        violations.push(`${label}: unresolved fixture destination ${destination.fixtureId}`);
      }
      if (!destination.to) continue;
      const [, kind, id] = destination.to.split('/');
      const valid = kind === 'team'
        ? Boolean(world.teamBases[id])
        : kind === 'coach'
          ? Boolean(world.coachBases[id])
          : kind === 'player'
            ? retainedPlayers.has(id)
            : kind === 'history' || kind === 'legends' || kind === 'memorable';
      if (!valid) violations.push(`${label}: unresolved route ${destination.to}`);
    }
  }
}

function containsInvalidNumber(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value === 'number') return !Number.isFinite(value);
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some(item => containsInvalidNumber(item, seen));
}

function inspectDigest(world: GameWorld, digest: NarrativeDigest, label: string): void {
  const items = [digest.feature, ...digest.signals, ...digest.more]
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const arcs = items.map(item => `${item.seasonNumber}:${item.arcKey}`);
  if (new Set(arcs).size !== arcs.length) violations.push(`${label}: duplicate semantic arc`);
  if (digest.signals.length > 2) violations.push(`${label}: ${digest.signals.length} signals`);
  if (digest.more.length > 6) violations.push(`${label}: ${digest.more.length} More items`);
  if (digest.worldMoment && digest.worldMoment.visualLevel !== 'world_moment') {
    violations.push(`${label}: ineligible World Moment`);
  }
  if (containsInvalidNumber(digest)) violations.push(`${label}: NaN or Infinity in digest`);
  if (JSON.stringify(digest).includes('peakRating') || JSON.stringify(digest).includes('潜力上限')) {
    violations.push(`${label}: hidden potential leaked`);
  }
  if (digest.candidateCount > 64) {
    violations.push(`${label}: unbounded digest pool ${digest.candidateCount}/${digest.more.length}`);
  }
  checkDestinations(world, digest, label);
}

function watchlist(world: GameWorld): string[] {
  const players = Object.keys(world.squads).sort()
    .flatMap(teamId => [...world.squads[teamId]].sort((a, b) => a.uuid.localeCompare(b.uuid)));
  const firstByPosition = ['GK', 'DF', 'MF', 'FW'].flatMap(position => {
    const matches = players.filter(player => player.position === position);
    return matches.slice(0, 2).map(player => player.uuid);
  });
  return firstByPosition.slice(0, 8);
}

function buildDigest(world: GameWorld, memory: NarrativeMemoryEntry[], favoriteTeamId: string): NarrativeDigest | null {
  const currentWindow = getCurrentWindow(world);
  if (!currentWindow) return null;
  const focusMatches = pickFocusMatches(currentWindow.fixtures, world, [favoriteTeamId], 2, favoriteTeamId);
  return buildMatchdayNarrativeDigest({
    world,
    currentWindow,
    observationTheme: buildObservationTheme(world, favoriteTeamId, 'auto'),
    focusMatches,
    playerHighlights: [],
    favoriteTeamIds: [favoriteTeamId],
    favoritePlayerIds: watchlist(world),
    primaryFavoriteTeamId: favoriteTeamId,
    memory,
  });
}

const startedAt = performance.now();
for (let seedOffset = 1; seedOffset <= seedCount; seedOffset++) {
  const seed = 965_000 + seedOffset;
  let world = initializeGameWorld(seed);
  let memory: NarrativeMemoryEntry[] = [];
  const favoriteTeamId = Object.keys(world.teamBases).sort()[seedOffset % Object.keys(world.teamBases).length];
  const finalSeason = world.seasonState.seasonNumber + seasonsPerSeed - 1;
  while (world.seasonState.seasonNumber <= finalSeason) {
    const currentWindow = getCurrentWindow(world);
    if (!currentWindow) throw new Error(`No current window for seed ${seed}, S${world.seasonState.seasonNumber}.`);
    const label = `seed ${seed} S${world.seasonState.seasonNumber} W${world.seasonState.currentWindowIndex}`;
    const beforeHash = world.seasonState.currentWindowIndex === 0 ? digestWorld(world) : null;

    const worldBuildStarted = performance.now();
    const candidates = buildWorldNarrativeCandidates({
      world,
      currentWindow,
      favoriteTeamIds: [favoriteTeamId],
      favoritePlayerIds: watchlist(world),
    });
    buildDurations.push(performance.now() - worldBuildStarted);
    maxCandidatePool = Math.max(maxCandidatePool, candidates.length);
    windowsScanned++;
    for (const source of derivedSources) {
      const family = candidates.filter(candidate => candidate.source === source);
      candidateCounts[source] += family.length;
      if (family.length > WORLD_NARRATIVE_CAPS[source === 'player_story' ? 'player' : source === 'coach_story' ? 'coach' : source]) {
        violations.push(`${label}: ${source} adapter exceeded cap`);
      }
    }
    const playerCandidates = candidates.filter(candidate => candidate.source === 'player_story');
    const leaders = playerCandidates.filter(candidate => candidate.id.startsWith('player-leader:'));
    if (leaders.length > 2) violations.push(`${label}: ${leaders.length} reserved player leaders`);
    for (const leader of leaders) {
      const position = leader.id.split(':')[2];
      if (position) playerLeaderPositions.add(position);
    }
    emergentPlayerCandidates += playerCandidates.length - leaders.length;
    if (candidates.length > WORLD_NARRATIVE_CAPS.total) violations.push(`${label}: world pool exceeded total cap`);
    if (containsInvalidNumber(candidates)) violations.push(`${label}: invalid number in source candidates`);

    const digestStarted = performance.now();
    const digest = buildDigest(world, memory, favoriteTeamId);
    digestDurations.push(performance.now() - digestStarted);
    if (digest) {
      maxDigestPool = Math.max(maxDigestPool, digest.candidateCount);
      inspectDigest(world, digest, label);
      if (digest.feature) digestWithFeature++;
      if (digest.worldMoment) {
        digestWithWorldMoment++;
        worldMomentSources[digest.worldMoment.source] = (worldMomentSources[digest.worldMoment.source] ?? 0) + 1;
      }
      maxMoreItems = Math.max(maxMoreItems, digest.more.length);
      for (const item of [digest.feature, ...digest.signals, ...digest.more]
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))) {
        editorialStateCounts[item.editorialState]++;
      }
      for (const item of [digest.feature, ...digest.signals]
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))) {
        selectedAllSources[item.source] = (selectedAllSources[item.source] ?? 0) + 1;
        if (derivedSources.includes(item.source as DerivedSource)) {
          selectedCounts[item.source as DerivedSource]++;
        }
      }
      memory = advanceNarrativeMemory(memory, digest, world.totalElapsedWindows ?? 0);
    }
    if (beforeHash && digestWorld(world) !== beforeHash) violations.push(`${label}: scan mutated world`);

    const seasonBefore = world.seasonState.seasonNumber;
    world = executeCurrentWindow(world).world;
    if (world.seasonState.seasonNumber !== seasonBefore) {
      const validation = validateWorldData(world);
      if (validation.errors.length > 0) {
        violations.push(`seed ${seed} rollover S${seasonBefore}: ${validation.errors.map(error => error.code).join(',')}`);
      }
    }
  }
}

for (let seedOffset = 1; seedOffset <= baselineSeedCount; seedOffset++) {
  const seed = 975_000 + seedOffset;
  let observed = initializeGameWorld(seed);
  let baseline = initializeGameWorld(seed);
  let memory: NarrativeMemoryEntry[] = [];
  const favoriteTeamId = Object.keys(observed.teamBases).sort()[0];
  const finalSeason = observed.seasonState.seasonNumber + baselineSeasons - 1;
  while (observed.seasonState.seasonNumber <= finalSeason) {
    const digest = buildDigest(observed, memory, favoriteTeamId);
    if (digest) memory = advanceNarrativeMemory(memory, digest, observed.totalElapsedWindows ?? 0);
    const observedExecution = executeCurrentWindow(observed);
    const baselineExecution = executeCurrentWindow(baseline);
    baselineWindows++;
    if (digestWorld(observedExecution.world) !== digestWorld(baselineExecution.world)) {
      violations.push(`baseline seed ${seed}: authoritative world diverged at window ${baselineWindows}`);
      break;
    }
    observed = observedExecution.world;
    baseline = baselineExecution.world;
  }
}

const totalDerivedSelected = Object.values(selectedCounts).reduce((sum, count) => sum + count, 0);
const selectedShares = Object.fromEntries(derivedSources.map(source => [
  source,
  totalDerivedSelected > 0 ? Math.round(selectedCounts[source] / totalDerivedSelected * 10_000) / 100 : 0,
])) as Record<DerivedSource, number>;

if (seasonsPerSeed >= 10 && seedCount >= 5) {
  for (const source of derivedSources) {
    if (candidateCounts[source] === 0) violations.push(`${source} never appeared in the long audit`);
  }
  const largestShare = Math.max(...Object.values(selectedShares));
  if (largestShare > 72) violations.push(`one derived family monopolized selected slots at ${largestShare}%`);
}

const buildP95 = percentile(buildDurations, 0.95);
const digestP95 = percentile(digestDurations, 0.95);
if (buildP95 > 20) violations.push(`world scan p95 ${buildP95.toFixed(2)}ms exceeds 20ms`);
if (digestP95 > 35) violations.push(`full digest p95 ${digestP95.toFixed(2)}ms exceeds 35ms`);

const report = {
  seedCount,
  seasonsPerSeed,
  baselineSeedCount,
  baselineSeasons,
  windowsScanned,
  baselineWindows,
  durationMs: Math.round(performance.now() - startedAt),
  candidateCounts,
  selectedCounts,
  selectedShares,
  selectedAllSources,
  maxCandidatePool,
  maxDigestPool,
  digestWithFeature,
  digestWithWorldMoment,
  worldMomentSources,
  maxMoreItems,
  editorialStateCounts,
  playerNarrative: {
    leaderPositions: [...playerLeaderPositions].sort(),
    emergentCandidates: emergentPlayerCandidates,
  },
  performance: {
    worldBuildP50Ms: Math.round(percentile(buildDurations, 0.5) * 100) / 100,
    worldBuildP95Ms: Math.round(buildP95 * 100) / 100,
    worldBuildMaxMs: Math.round(Math.max(...buildDurations) * 100) / 100,
    digestP50Ms: Math.round(percentile(digestDurations, 0.5) * 100) / 100,
    digestP95Ms: Math.round(digestP95 * 100) / 100,
    digestMaxMs: Math.round(Math.max(...digestDurations) * 100) / 100,
  },
  violations: [...new Set(violations)],
};

console.log(JSON.stringify(report, null, 2));
if (report.violations.length > 0) process.exitCode = 1;

/**
 * Season-score parameter study for rating-and-records-redesign.md 6.6.
 *
 * One simulated world, many scoring parameter sets applied to the same
 * player-seasons. The simulation is the expensive part and the rescore is
 * arithmetic, so every candidate is evaluated against identical data: this
 * isolates the formula change from simulation drift and makes candidates
 * directly comparable.
 *
 * Answers the four questions the design document makes a hard prerequisite
 * for stage D:
 *   1. Per-position score distribution change (median / P10 / P90).
 *   2. Ballon d'Or winner distribution by position, tier and table place.
 *   3. narrative-world-scan.ts threshold sensitivity (70 / 76 / 85 / 75 /
 *      confidence 0.25).
 *   4. Whether the star-player-presence-plan.md acceptance still holds
 *      (four-position median spread 1.9, P90 spread 2.0).
 *
 * Only the calibration 'scale' changes per position, never 'median', so
 * positionQuality maps across exactly:
 *
 *   qualityNew = 50 + (qualityOld - 50) * (scaleNew / scaleOld)
 *
 * Caveat: positionQuality is clamped to [0, 100] before we see it, so
 * samples on the clamp cannot be mapped exactly. The report counts them
 * (about 1%) and the bias direction is known: clamped samples understate
 * the candidate score.
 *
 * The feedback path is deliberately NOT modelled. Under a different formula
 * the engine's own transfer and market-value decisions would differ, so this
 * measures distributional impact, not the second-order world that would
 * emerge from it.
 *
 * Usage: npx tsx scripts/audit-score-params.ts
 * Env: SCORE_PARAM_SEEDS (default 5), SCORE_PARAM_SEASONS (default 10).
 */
import {
  executeCurrentWindow,
  getCurrentWindow,
  initializeGameWorld,
} from '../src/engine/season/season-manager';
import { computeSegmentedPlayerPerformance } from '../src/engine/players/player-performance';
import {
  ballonDorScore,
  buildBallonDorContextResolver,
} from '../src/engine/awards/ballon-dor';
import type { PlayerPosition, PlayerTeamSeasonStats } from '../src/types/player';
import type { StandingEntry } from '../src/types/league';

const SEED_COUNT = Number(process.env.SCORE_PARAM_SEEDS ?? 5);
const SEASONS_PER_SEED = Number(process.env.SCORE_PARAM_SEASONS ?? 10);

const POSITIONS: PlayerPosition[] = ['GK', 'DF', 'MF', 'FW'];

interface Params {
  scale: Record<PlayerPosition, number>;
  league: Record<1 | 2 | 3, number>;
  weights: { quality: number; availability: number; league: number };
}

const CURRENT: Params = {
  scale: { GK: 0.83, DF: 1.85, MF: 1.42, FW: 1.14 },
  league: { 1: 100, 2: 95, 3: 90 },
  weights: { quality: 0.70, availability: 0.20, league: 0.10 },
};

const DOC_WEIGHTS = { quality: 0.73, availability: 0.12, league: 0.15 };
const DOC_LEAGUE: Record<1 | 2 | 3, number> = { 1: 100, 2: 88, 3: 76 };

/**
 * Candidates under study.
 *
 * 'doc' is the design document's full proposal. The dfOnly family changes the
 * defender scale alone, separating "the defender tail is too fat" from the
 * document's other two changes. 'tuned' is a balanced attempt to keep the
 * cross-position P90 spread near the accepted value while still compressing
 * the defender tail that dominates the Ballon d'Or.
 */
const CANDIDATES: Record<string, Params> = {
  current: CURRENT,
  doc: {
    scale: { GK: 1.00, DF: 1.15, MF: 1.25, FW: 1.20 },
    league: DOC_LEAGUE,
    weights: DOC_WEIGHTS,
  },
  dfOnly_1_60: { ...CURRENT, scale: { ...CURRENT.scale, DF: 1.60 } },
  dfOnly_1_40: { ...CURRENT, scale: { ...CURRENT.scale, DF: 1.40 } },
  dfOnly_1_25: { ...CURRENT, scale: { ...CURRENT.scale, DF: 1.25 } },
  tuned: {
    scale: { GK: 0.90, DF: 1.45, MF: 1.38, FW: 1.16 },
    league: DOC_LEAGUE,
    weights: DOC_WEIGHTS,
  },
};

const CANDIDATE_NAMES = Object.keys(CANDIDATES);

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * ratio)] ?? 0;
}

interface Row {
  uuid: string;
  teamId: string;
  position: PlayerPosition;
  age: number;
  appearances: number;
  minutes: number;
  confidence: number;
  boundary: boolean;
  leagueLevel: 1 | 2 | 3;
  /** Score under each candidate, by candidate name. */
  scores: Record<string, number>;
}

interface SeasonFrame {
  season: number;
  standings: StandingEntry[];
  seasonStartLevels: Record<string, 1 | 2 | 3 | undefined>;
  continentalWinners: string[];
  worldCupWinner?: string;
  rows: Row[];
}

/**
 * Re-score one player-season under one candidate.
 *
 * leagueStrength is recomputed from the segments rather than rescaled: the
 * engine blends it by minutes across a mid-season transfer's segments, so a
 * single blended value cannot be mapped across two different level tables.
 */
function rescore(
  params: Params,
  position: PlayerPosition,
  oldQuality: number,
  confidence: number,
  availability: number,
  segments: PlayerTeamSeasonStats[],
  seasonStartLevels: Record<string, 1 | 2 | 3 | undefined>,
): number {
  const scaleRatio = params.scale[position] / CURRENT.scale[position];
  const qualityNew = clamp(50 + (oldQuality - 50) * scaleRatio, 0, 100);
  const adjustedNew = 50 + (qualityNew - 50) * confidence;

  const active = segments.filter(
    segment => (segment.minutesPlayed ?? 0) > 0 || (segment.teamMatchesAllCompetitions ?? 0) > 0,
  );
  const totalMinutes = active.reduce((sum, segment) => sum + (segment.minutesPlayed ?? 0), 0);
  const readLeague = (segment: PlayerTeamSeasonStats) =>
    params.league[seasonStartLevels[segment.teamId] ?? 1];
  const leagueScore = active.length === 0
    ? params.league[1]
    : totalMinutes <= 0
      ? active.reduce((sum, segment) => sum + readLeague(segment), 0) / active.length
      : active.reduce((sum, segment) => sum + readLeague(segment) * (segment.minutesPlayed ?? 0), 0)
        / totalMinutes;

  return round1(clamp(
    adjustedNew * params.weights.quality
    + availability * params.weights.availability
    + leagueScore * params.weights.league,
    0,
    100,
  ));
}

const frames: SeasonFrame[] = [];
let boundarySamples = 0;
let invalidScores = 0;

for (let seedIndex = 0; seedIndex < SEED_COUNT; seedIndex++) {
  let world = initializeGameWorld(20261111 + seedIndex * 104729);
  let seasons = 0;
  let safety = 0;

  while (seasons < SEASONS_PER_SEED && safety < 40_000) {
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
      const seasonStartLevels = world.seasonStartLevels ?? {};

      const rows: Row[] = [];
      for (const stat of Object.values(world.playerStats)) {
        const player = playerById.get(stat.playerId);
        if (!player) continue;
        const segments = segmentsByPlayer.get(player.uuid) ?? [];
        const result = computeSegmentedPlayerPerformance(
          player.position,
          segments,
          seasonStartLevels,
          stat,
        );
        if (!result.eligible) continue;

        const boundary = result.positionQuality <= 0 || result.positionQuality >= 100;
        if (boundary) boundarySamples++;

        const scores: Record<string, number> = {};
        for (const name of CANDIDATE_NAMES) {
          const score = rescore(
            CANDIDATES[name],
            player.position,
            result.positionQuality,
            result.confidence,
            result.availabilityScore,
            segments,
            seasonStartLevels,
          );
          if (!Number.isFinite(score) || score < 0 || score > 100) invalidScores++;
          scores[name] = score;
        }

        rows.push({
          uuid: player.uuid,
          teamId: stat.teamId,
          position: player.position,
          age: player.age,
          appearances: stat.appearances,
          minutes: result.metrics.minutes,
          confidence: result.confidence,
          boundary,
          leagueLevel: seasonStartLevels[stat.teamId] ?? 1,
          scores,
        });
      }

      const cups = world.continentalCups ?? { mainland_cup: null, southern_cup: null, eastern_cup: null };
      frames.push({
        season: world.seasonState.seasonNumber,
        standings: world.league1Standings,
        seasonStartLevels,
        continentalWinners: [cups.mainland_cup, cups.southern_cup, cups.eastern_cup]
          .filter(cup => cup?.completed && cup.winnerId)
          .map(cup => cup!.winnerId!),
        worldCupWinner: world.worldCup?.completed ? world.worldCup.winnerId : undefined,
        rows,
      });

      seasons++;
    }

    world = executeCurrentWindow(world).world;
    safety++;
  }
  if (seasons !== SEASONS_PER_SEED) {
    throw new Error(`Seed ${seedIndex}: completed ${seasons}/${SEASONS_PER_SEED} seasons`);
  }
}

const allRows = frames.flatMap(frame => frame.rows);
const trusted = allRows.filter(row => row.confidence >= 0.5);

function distributionFor(position: PlayerPosition, candidate: string) {
  const scores = trusted.filter(row => row.position === position).map(row => row.scores[candidate]);
  return {
    count: scores.length,
    p10: round(percentile(scores, 0.1)),
    median: round(percentile(scores, 0.5)),
    p90: round(percentile(scores, 0.9)),
  };
}

function pickBallonDor(frame: SeasonFrame, candidate: string): Row | null {
  const contextFor = buildBallonDorContextResolver(
    frame.standings,
    { continentalCupWinners: frame.continentalWinners },
    frame.seasonStartLevels,
    frame.worldCupWinner ? ({ completed: true, winnerId: frame.worldCupWinner } as never) : null,
  );
  const ranked = frame.rows
    .filter(row => row.appearances >= 5)
    .map(row => ({
      row,
      award: ballonDorScore(row.scores[candidate], contextFor(row.teamId, row.minutes)),
    }));
  if (ranked.length === 0) return null;
  return ranked.reduce((best, entry) => {
    if (entry.award > best.award) return entry;
    if (entry.award < best.award) return best;
    if (entry.row.minutes > best.row.minutes) return entry;
    if (entry.row.minutes < best.row.minutes) return best;
    return entry.row.uuid.localeCompare(best.row.uuid) < 0 ? entry : best;
  }).row;
}

function tablePosition(frame: SeasonFrame, teamId: string): number {
  const sorted = [...frame.standings].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    return a.teamId.localeCompare(b.teamId);
  });
  const index = sorted.findIndex(row => row.teamId === teamId);
  return index === -1 ? 0 : index + 1;
}

function evaluate(candidate: string) {
  const distributions = Object.fromEntries(POSITIONS.map(position => [
    position,
    distributionFor(position, candidate),
  ])) as Record<PlayerPosition, { count: number; p10: number; median: number; p90: number }>;

  const medians = POSITIONS.map(position => distributions[position].median);
  const p90s = POSITIONS.map(position => distributions[position].p90);
  const p10s = POSITIONS.map(position => distributions[position].p10);

  const winners = frames
    .map(frame => ({ frame, winner: pickBallonDor(frame, candidate) }))
    .filter((entry): entry is { frame: SeasonFrame; winner: Row } => entry.winner !== null);

  const byPosition: Record<PlayerPosition, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
  const byLevel: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
  let champions = 0;
  let placeSum = 0;
  let ranked = 0;
  for (const { frame, winner } of winners) {
    byPosition[winner.position]++;
    byLevel[winner.leagueLevel]++;
    if (winner.leagueLevel === 1) {
      const place = tablePosition(frame, winner.teamId);
      placeSum += place;
      ranked++;
      if (place === 1) champions++;
    }
  }

  const rising = allRows.filter(row =>
    row.age <= 22 && row.scores[candidate] >= 70 && row.confidence >= 0.25);
  const veteran = allRows.filter(row => row.age >= 31 && row.scores[candidate] >= 76);
  const elite = allRows.filter(row => row.scores[candidate] >= 85);
  const transferGate = allRows.filter(row =>
    row.scores[candidate] >= 75 && row.minutes >= 450);

  let eliteLeaders = 0;
  for (const frame of frames) {
    for (const position of POSITIONS) {
      const leader = frame.rows
        .filter(row => row.position === position && row.minutes >= 360)
        .sort((a, b) => b.scores[candidate] - a.scores[candidate]
          || b.minutes - a.minutes
          || a.uuid.localeCompare(b.uuid))[0];
      if (leader && leader.scores[candidate] >= 85) eliteLeaders++;
    }
  }

  const changed = frames.reduce((sum, frame) => {
    const before = pickBallonDor(frame, 'current');
    const after = pickBallonDor(frame, candidate);
    return sum + (before?.uuid === after?.uuid ? 0 : 1);
  }, 0);

  return {
    spread: {
      p10: round(Math.max(...p10s) - Math.min(...p10s)),
      median: round(Math.max(...medians) - Math.min(...medians)),
      p90: round(Math.max(...p90s) - Math.min(...p90s)),
    },
    distributions,
    ballonDor: {
      byPosition,
      byLevel,
      championWinners: champions,
      averageTablePosition: ranked > 0 ? round(placeSum / ranked) : null,
      changedVsCurrent: changed,
      changedRate: round(changed / Math.max(1, frames.length), 4),
    },
    narrative: {
      risingPool: rising.length,
      veteranPool: veteran.length,
      elitePool: elite.length,
      eliteLeaders,
      transferGatePool: transferGate.length,
    },
  };
}

const candidates = Object.fromEntries(CANDIDATE_NAMES.map(name => [name, evaluate(name)]));

const report = {
  matrix: {
    seedCount: SEED_COUNT,
    seasonsPerSeed: SEASONS_PER_SEED,
    completedSeasons: frames.length,
  },
  sample: {
    playerSeasons: allRows.length,
    trustedPlayerSeasons: trusted.length,
    boundarySamples,
    boundaryRate: round(boundarySamples / Math.max(1, allRows.length), 4),
    invalidScores,
  },
  acceptance: {
    source: 'star-player-presence-plan.md, 30 seeds x 20 seasons',
    medianSpread: 1.9,
    p90Spread: 2.0,
  },
  candidates,
};

console.log(JSON.stringify(report, null, 2));

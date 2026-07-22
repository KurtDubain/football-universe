import type { GameWorld } from '../engine/season/season-manager';
import type { MatchResult } from '../types/match';
import { SAVE_SCHEMA_VERSION } from './save-constants';
import { conservativeUTF16Bytes } from './save-budget';

export type SaveCompressor = (value: string) => string;

export interface SaveSizeMetric {
  rawBytes: number;
  compressedBytes: number;
}

export interface SaveSizeReport {
  season: number;
  phase: string;
  total: SaveSizeMetric;
  categories: Record<string, SaveSizeMetric>;
  counts: {
    completedResults: number;
    eventRows: number;
    matchdaySnapshots: number;
    playerHistoryRows: number;
    matchHistorySeasons: number;
    transferHistorySeasons: number;
    honorSeasons: number;
    coaches: number;
  };
}

export function createPersistedSaveEnvelope(world: GameWorld) {
  return {
    version: SAVE_SCHEMA_VERSION,
    state: {
      world,
      initialized: true,
      lastResults: [],
      lastNews: [],
      favoriteTeamId: null,
      favoriteTeamIds: [],
    },
  };
}

function metric(value: unknown, compress: SaveCompressor): SaveSizeMetric {
  const json = JSON.stringify(value);
  return {
    rawBytes: new TextEncoder().encode(json).byteLength,
    compressedBytes: conservativeUTF16Bytes(compress(json)),
  };
}

function resultCore(result: MatchResult): Record<string, unknown> {
  return Object.fromEntries(Object.entries(result).filter(([key]) => (
    key !== 'events' && key !== 'homeMatchday' && key !== 'awayMatchday' && key !== 'prediction'
  )));
}

export function measureWorldSaveSize(
  world: GameWorld,
  phase: string,
  compress: SaveCompressor,
): SaveSizeReport {
  const completedResults = world.seasonState.calendar
    .filter((window) => window.completed)
    .flatMap((window) => window.results ?? []);
  const events = completedResults.flatMap((result) => result.events ?? []);
  const matchdaySnapshots = completedResults.flatMap((result) => (
    [result.homeMatchday, result.awayMatchday].filter(Boolean)
  ));
  const playerHistoryRows = Object.values(world.playerStatsHistory ?? {})
    .reduce((sum, rows) => sum + rows.length, 0);

  const categories = {
    seasonState: metric(world.seasonState, compress),
    currentResultCore: metric(completedResults.map(resultCore), compress),
    currentEvents: metric(events, compress),
    matchdaySnapshots: metric(matchdaySnapshots, compress),
    playerHistory: metric(world.playerStatsHistory, compress),
    matchHistory: metric(world.matchHistory, compress),
    squads: metric(world.squads, compress),
    coaches: metric({
      bases: world.coachBases,
      states: world.coachStates,
      careers: world.coachCareers,
      trophies: world.coachTrophies,
      candidates: world.coachCandidatePool,
      retirements: world.coachRetirementHistory,
    }, compress),
    honorsAndTrophies: metric({
      honors: world.honorHistory,
      teamTrophies: world.teamTrophies,
      records: world.teamSeasonRecords,
    }, compress),
    transfers: metric(world.transferHistory, compress),
    finances: metric(world.teamFinances, compress),
    awards: metric(world.playerAwardsHistory, compress),
    forecastsAndPredictions: metric({
      currentPrediction: world.prediction,
      history: world.predictionHistory,
      matchForecasts: completedResults.map((result) => result.prediction),
      pendingObservation: world.pendingObservationJudgment,
      observationRecord: world.observationRecord,
    }, compress),
    seasonBuffs: metric({ current: world.seasonBuffs, history: world.seasonBuffsHistory }, compress),
    news: metric(world.newsLog, compress),
  };

  return {
    season: world.seasonState.seasonNumber,
    phase,
    total: metric(createPersistedSaveEnvelope(world), compress),
    categories,
    counts: {
      completedResults: completedResults.length,
      eventRows: events.length,
      matchdaySnapshots: matchdaySnapshots.length,
      playerHistoryRows,
      matchHistorySeasons: new Set((world.matchHistory ?? []).map((entry) => entry.season)).size,
      transferHistorySeasons: new Set((world.transferHistory ?? []).map((entry) => entry.season)).size,
      honorSeasons: world.honorHistory.length,
      coaches: Object.keys(world.coachBases).length,
    },
  };
}

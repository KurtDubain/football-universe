import type { Achievement } from '../engine/achievements';
import {
  appendObserverSeasonTrajectory,
  buildObserverSeasonTrajectory,
} from '../engine/observation/season-trajectory';
import { settleObservationJudgment, type ObservationSettlement } from '../engine/observation/judgment';
import { buildObservationTheme, type ObservationThemePreference } from '../engine/observation/observation-theme';
import type { AdvanceWindowOutcome, AdvanceWorldResponse } from '../engine/observation/world-response';
import {
  executeCurrentWindow,
  getCurrentWindow,
  type GameWorld,
  type NewsItem,
} from '../engine/season/season-manager';
import type { MatchResult } from '../types/match';

export interface AdvanceCompletion {
  previousWorld: GameWorld;
  world: GameWorld;
  favoriteTeamIds: string[];
  lastResults: MatchResult[];
  lastNews: NewsItem[];
  lastObservationSettlements: ObservationSettlement[];
  lastWorldResponse: AdvanceWorldResponse | null;
}

interface AdvanceQueueState {
  advanceTick: number;
  newAchievements: Achievement[];
}

export interface CompletedAdvanceState {
  world: GameWorld;
  lastResults: MatchResult[];
  lastNews: NewsItem[];
  lastObservationSettlements: ObservationSettlement[];
  lastWorldResponse: AdvanceWorldResponse | null;
  isAdvancing: false;
  advanceTick: number;
  newAchievements: Achievement[];
}

function getAchievementNotifications(
  previousWorld: GameWorld,
  world: GameWorld,
  favoriteTeamIds: string[],
): Achievement[] {
  const previousIds = new Set((previousWorld.achievements ?? []).map(achievement => achievement.id));
  const favoriteIds = new Set(favoriteTeamIds);
  return (world.achievements ?? []).filter(achievement => (
    !previousIds.has(achievement.id)
    && (achievement.teamId == null || favoriteIds.has(achievement.teamId))
  ));
}

export function buildAdvanceCompletionState(
  state: AdvanceQueueState,
  completion: AdvanceCompletion,
): CompletedAdvanceState {
  const queuedIds = new Set(state.newAchievements.map(achievement => achievement.id));
  const newAchievements = getAchievementNotifications(
    completion.previousWorld,
    completion.world,
    completion.favoriteTeamIds,
  ).filter(achievement => !queuedIds.has(achievement.id));

  return {
    world: completion.world,
    lastResults: completion.lastResults,
    lastNews: completion.lastNews,
    lastObservationSettlements: completion.lastObservationSettlements,
    lastWorldResponse: completion.lastWorldResponse,
    isAdvancing: false,
    advanceTick: state.advanceTick + 1,
    newAchievements: [...state.newAchievements, ...newAchievements],
  };
}

export function executeWindowWithObservationSettlement(
  world: GameWorld,
  favoriteTeamIds: string[],
  observationThemePreference: ObservationThemePreference,
) {
  const currentWindow = getCurrentWindow(world);
  if (!currentWindow) throw new Error('当前没有可推进的比赛窗口');
  const seasonNumber = world.seasonState.seasonNumber;
  const windowIndex = world.seasonState.currentWindowIndex;
  const primaryTeamId = favoriteTeamIds[0];
  const observationTheme = currentWindow.type === 'season_end' && primaryTeamId
    ? buildObservationTheme(world, primaryTeamId, observationThemePreference)
    : null;
  const seasonTrajectory = currentWindow.type === 'season_end' && primaryTeamId
    ? buildObserverSeasonTrajectory(world, primaryTeamId, observationTheme)
    : null;
  const result = executeCurrentWindow(world, { favoriteTeamIds });
  const settlement = settleObservationJudgment(
    result.world.observationRecord,
    result.world.pendingObservationJudgment,
    result.results,
  );
  const observationSettlements = settlement.settlements;
  const outcome: AdvanceWindowOutcome = {
    seasonNumber,
    windowIndex,
    windowLabel: currentWindow.label,
    results: result.results,
    news: result.news,
    observationSettlements,
  };
  const settledWorld = observationSettlements.length > 0
    ? {
        ...result.world,
        pendingObservationJudgment: settlement.pending,
        observationRecord: settlement.record,
      }
    : result.world;

  return {
    ...result,
    observationSettlements,
    outcome,
    world: appendObserverSeasonTrajectory(settledWorld, seasonTrajectory),
  };
}

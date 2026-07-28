import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { compressedStorage } from './compressed-storage';
import { createCurrentSavePersistStorage, SAVE_SCHEMA_VERSION, SAVE_STORAGE_KEY } from './save-schema';
import { exportCurrentSave, importCurrentSave } from './save-backup';
import { GameWorld, NewsItem, initializeGameWorld, executeCurrentWindow, getCurrentWindow, isSeasonFullyComplete } from '../engine/season/season-manager';
import { applyOfferTransfer, applyOutgoingBid, signFreeAgent, autoResolveRemaining } from './transfer-window-actions';
import { syncPlayerStatsTeamIds } from '../engine/players/stats';
import { processCoachFiring } from '../engine/coaches/coach-hiring';
import { getTeamCoachId } from '../engine/coaches/coach-lookup';
import { SeededRNG } from '../engine/match/rng';
import {
  counterAcceptanceProbability,
  isKeySquadPlayer,
  sellerAcceptanceProbability,
  suggestCounterFee,
} from '../engine/transfers/transfer-decision';
import { CalendarWindow } from '../types/season';
import { MatchResult } from '../types/match';
import type { Achievement } from '../engine/achievements';
import { enforceStorageLimits } from '../engine/season/storage-limits';
import { archiveCompletedMatchDetails, boundWorldStorageMetadata, type StorageCleanupResult } from './save-compaction';
import {
  isObservationSelectionValid,
  settleObservationJudgment,
  type ObservationJudgmentKind,
  type ObservationSelection,
  type ObservationSettlement,
} from '../engine/observation/judgment';
import { applyGodHandIntervention } from '../engine/season/god-hand';
import {
  buildAdvanceWorldResponse,
  readableAdvanceError,
  type AdvanceWindowOutcome,
  type AdvanceWorldResponse,
} from '../engine/observation/world-response';
import {
  appendObserverSeasonTrajectory,
  buildObserverSeasonTrajectory,
} from '../engine/observation/season-trajectory';
import {
  getCurrentKeyNodeGuard,
  planNextKeyNode,
} from '../engine/observation/key-node';
import {
  buildObservationTheme,
  type ObservationThemePreference,
} from '../engine/observation/observation-theme';

interface GameStore {
  world: GameWorld | null;
  initialized: boolean;
  lastResults: MatchResult[];
  lastNews: NewsItem[];
  lastObservationSettlements: ObservationSettlement[];
  lastWorldResponse: AdvanceWorldResponse | null;
  isAdvancing: boolean;
  advanceError: string | null;
  /** Bumps on every successful advance — Dashboard listens for changes to trigger
   *  auto-live / celebration / tab switch reliably each advance, not just the first. */
  advanceTick: number;
  /** Single-team selection — kept for backward compatibility. Prefer `favoriteTeamIds`. */
  favoriteTeamId: string | null;
  /** Multi-favorite list (up to 3 teams). */
  favoriteTeamIds: string[];
  /** Display-only lens for the current observer route. Never read by simulation. */
  observationThemePreference: ObservationThemePreference;
  /** Transient set of fixtures the user starred for auto-live (cleared on advance). */
  starredFixtureIds: string[];
  newAchievements: Achievement[];

  dismissAchievement: () => void;

  newGame: (seed?: number, options?: { gameMode?: import('../types/game-mode').GameMode; customTeams?: import('../types/team').TeamBase[] }) => void;
  advanceWindow: () => Promise<boolean>;
  batchAdvance: (count: number) => Promise<boolean>;
  advanceUntil: (type: 'cup' | 'season_end') => Promise<boolean>;
  advanceToNextKeyNode: () => Promise<boolean>;
  dismissAdvanceError: () => void;
  /** Sets the legacy primary favorite. */
  setFavoriteTeam: (teamId: string | null) => void;
  /** Sets the entire favorites list (max 3 entries). */
  setFavoriteTeams: (ids: string[]) => void;
  /** Promotes an existing favorite to the primary observer focus. */
  setPrimaryFavoriteTeam: (teamId: string) => void;
  /** Toggle a team's membership in the favorites list. */
  toggleFavoriteTeam: (teamId: string) => void;
  setObservationThemePreference: (preference: ObservationThemePreference) => void;
  setPrediction: (champion: string, relegated: string) => void;
  useGodHand: (teamId: string, type: 'boost' | 'nerf') => void;
  fireCoach: (teamId: string) => void;
  toggleStarFixture: (fixtureId: string) => void;
  clearStarredFixtures: () => void;
  setObservationJudgment: (fixtureId: string, kind: ObservationJudgmentKind, selection: ObservationSelection) => void;
  cancelObservationJudgment: () => void;
  // ── Phase 2: transfer window actions ──
  acceptIncomingOffer: (offerId: string) => void;
  rejectIncomingOffer: (offerId: string) => void;
  counterIncomingOffer: (offerId: string) => void;
  bidForOutgoingTarget: (targetId: string, fee: number) => void;
  signFromFreeAgentPool: (uuid: string, teamId?: string) => void;
  closeTransferWindow: (autoResolveRest: boolean) => void;
  resetGame: () => void;
  getCurrentWindow: () => CalendarWindow | null;
  getTeamsByLeague: (level: 1 | 2 | 3) => string[];
  isGameOver: () => boolean;
  trimStorage: () => StorageCleanupResult | null;
}

type PersistedGameState = Pick<GameStore,
  | 'world'
  | 'initialized'
  | 'lastResults'
  | 'lastNews'
  | 'favoriteTeamId'
  | 'favoriteTeamIds'
  | 'observationThemePreference'
>;

const EMPTY_PERSISTED_RESULTS: MatchResult[] = [];
const EMPTY_PERSISTED_NEWS: NewsItem[] = [];

function reconstructLastResults(world: GameWorld | null): MatchResult[] {
  if (!world) return [];
  for (let index = world.seasonState.calendar.length - 1; index >= 0; index--) {
    const window = world.seasonState.calendar[index];
    if (window.completed && window.results.length > 0) return window.results;
  }
  return [];
}

function mergePersistedGameState(
  persistedState: unknown,
  current: GameStore,
): GameStore {
  const persisted = persistedState as PersistedGameState;
  const merged = { ...current, ...persisted };
  const favoriteTeamIds = [...new Set(merged.favoriteTeamIds)].slice(0, 3);
  const primaryId = merged.favoriteTeamId && favoriteTeamIds.includes(merged.favoriteTeamId)
    ? merged.favoriteTeamId
    : favoriteTeamIds[0] ?? null;
  const orderedFavorites = primaryId
    ? [primaryId, ...favoriteTeamIds.filter(id => id !== primaryId)]
    : favoriteTeamIds;
  return {
    ...merged,
    favoriteTeamId: primaryId,
    favoriteTeamIds: orderedFavorites,
    observationThemePreference: merged.observationThemePreference ?? 'auto',
    lastResults: reconstructLastResults(merged.world),
    lastNews: merged.world?.newsLog.slice(-30) ?? [],
    lastObservationSettlements: [],
    lastWorldResponse: null,
    isAdvancing: false,
    advanceError: null,
  };
}

function yieldForAdvanceFeedback(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function executeWindowWithObservationSettlement(
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
  const settlementChanged = settlement.settlements.length > 0;
  const observationSettlements = settlement.settlements;
  const outcome: AdvanceWindowOutcome = {
    seasonNumber,
    windowIndex,
    windowLabel: currentWindow.label,
    results: result.results,
    news: result.news,
    observationSettlements,
  };
  const settledWorld = settlementChanged
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

function hashActionSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}

function transferActionRng(world: GameWorld, actionKey: string): SeededRNG {
  const season = world.transferWindow?.season ?? world.seasonState.seasonNumber;
  return new SeededRNG(world.rngState ^ hashActionSeed(`${season}:${actionKey}`));
}

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => ({
      world: null,
      initialized: false,
      lastResults: [],
      lastNews: [],
      lastObservationSettlements: [],
      lastWorldResponse: null,
      isAdvancing: false,
      advanceError: null,
      advanceTick: 0,
      favoriteTeamId: null,
      favoriteTeamIds: [],
      observationThemePreference: 'auto',
      starredFixtureIds: [],
      newAchievements: [],

      dismissAchievement: () => {
        set(s => ({ newAchievements: s.newAchievements.slice(1) }));
      },

      newGame: (seed?: number, options?: { gameMode?: import('../types/game-mode').GameMode; customTeams?: import('../types/team').TeamBase[] }) => {
        const actualSeed = seed ?? Math.floor(Math.random() * 1000000);
        const world = initializeGameWorld(actualSeed, options);
        set({
          world,
          initialized: true,
          lastResults: [],
          lastNews: [],
          lastObservationSettlements: [],
          lastWorldResponse: null,
          advanceError: null,
          observationThemePreference: 'auto',
        });
      },

      advanceWindow: async () => {
        const { world, isAdvancing } = get();
        if (!world || isAdvancing) return false;
        set({ isAdvancing: true, advanceError: null });
        await yieldForAdvanceFeedback();
        try {
          const favoriteTeamIds = get().favoriteTeamIds;
          const result = executeWindowWithObservationSettlement(
            world,
            favoriteTeamIds,
            get().observationThemePreference,
          );
          const updatedWorld = boundWorldStorageMetadata(result.world);
          const worldResponse = buildAdvanceWorldResponse(
            'single',
            [result.outcome],
            updatedWorld,
            favoriteTeamIds,
            get().favoriteTeamId,
          );

          // Detect new achievements (compare against pre-advance state)
          const oldAchIds = new Set((world.achievements ?? []).map(a => a.id));
          const newAch = (updatedWorld.achievements ?? []).filter(a => !oldAchIds.has(a.id));

          set({
            world: updatedWorld,
            lastResults: result.results,
            lastNews: result.news,
            lastObservationSettlements: result.observationSettlements,
            lastWorldResponse: worldResponse,
            isAdvancing: false,
            advanceTick: get().advanceTick + 1,
            newAchievements: [...get().newAchievements, ...newAch],
          });
          return true;
        } catch (e) {
          console.error('Error advancing window:', e);
          set({ isAdvancing: false, advanceError: readableAdvanceError() });
          return false;
        }
      },

      batchAdvance: async (count: number) => {
        let { world } = get();
        if (!world || get().isAdvancing) return false;
        set({ isAdvancing: true, advanceError: null });
        await yieldForAdvanceFeedback();
        try {
          const favoriteTeamIds = get().favoriteTeamIds;
          const observationThemePreference = get().observationThemePreference;
          let allResults: MatchResult[] = [];
          let allNews: NewsItem[] = [];
          let observationSettlements: ObservationSettlement[] = [];
          const outcomes: AdvanceWindowOutcome[] = [];
          for (let i = 0; i < count; i++) {
            const cw = getCurrentWindow(world);
            if (!cw) break;
            const result = executeWindowWithObservationSettlement(
              world,
              favoriteTeamIds,
              observationThemePreference,
            );
            world = result.world;
            allResults = result.results; // keep only last window's results
            allNews = [...allNews, ...result.news];
            observationSettlements = [...observationSettlements, ...result.observationSettlements];
            outcomes.push(result.outcome);
          }
          if (outcomes.length === 0) {
            set({ isAdvancing: false });
            return false;
          }
          // Trim news to last 30
          if (allNews.length > 30) allNews = allNews.slice(-30);
          world = boundWorldStorageMetadata(enforceStorageLimits(world));
          const worldResponse = buildAdvanceWorldResponse(
            'batch',
            outcomes,
            world,
            favoriteTeamIds,
            get().favoriteTeamId,
          );
          set({
            world,
            lastResults: allResults,
            lastNews: allNews,
            lastObservationSettlements: observationSettlements,
            lastWorldResponse: worldResponse,
            isAdvancing: false,
            advanceTick: get().advanceTick + 1,
          });
          return true;
        } catch (e) {
          console.error('Error in batch advance:', e);
          set({ isAdvancing: false, advanceError: readableAdvanceError() });
          return false;
        }
      },

      advanceUntil: async (type: 'cup' | 'season_end') => {
        let { world } = get();
        if (!world || get().isAdvancing) return false;
        set({ isAdvancing: true, advanceError: null });
        await yieldForAdvanceFeedback();
        try {
          const favoriteTeamIds = get().favoriteTeamIds;
          const observationThemePreference = get().observationThemePreference;
          let allNews: NewsItem[] = [];
          let lastResults: MatchResult[] = [];
          let observationSettlements: ObservationSettlement[] = [];
          const outcomes: AdvanceWindowOutcome[] = [];
          let safety = 0;
          while (safety < 60) {
            const cw = getCurrentWindow(world);
            if (!cw) break;
            // Stop conditions
            if (type === 'cup' && (cw.type === 'league_cup' || cw.type === 'super_cup' || cw.type === 'super_cup_group')) break;
            if (type === 'season_end' && cw.type === 'season_end') break;
            const result = executeWindowWithObservationSettlement(
              world,
              favoriteTeamIds,
              observationThemePreference,
            );
            world = result.world;
            lastResults = result.results;
            allNews = [...allNews, ...result.news];
            observationSettlements = [...observationSettlements, ...result.observationSettlements];
            outcomes.push(result.outcome);
            safety++;
          }
          if (outcomes.length === 0) {
            set({ isAdvancing: false });
            return false;
          }
          if (allNews.length > 30) allNews = allNews.slice(-30);
          world = boundWorldStorageMetadata(enforceStorageLimits(world));
          const worldResponse = buildAdvanceWorldResponse(
            type === 'cup' ? 'cup' : 'season_end',
            outcomes,
            world,
            favoriteTeamIds,
            get().favoriteTeamId,
          );
          set({
            world,
            lastResults,
            lastNews: allNews,
            lastObservationSettlements: observationSettlements,
            lastWorldResponse: worldResponse,
            isAdvancing: false,
            advanceTick: get().advanceTick + 1,
          });
          return true;
        } catch (e) {
          console.error('Error in advanceUntil:', e);
          set({ isAdvancing: false, advanceError: readableAdvanceError() });
          return false;
        }
      },

      advanceToNextKeyNode: async () => {
        let { world } = get();
        if (!world || get().isAdvancing) return false;
        const favoriteTeamIds = get().favoriteTeamIds;
        const observationThemePreference = get().observationThemePreference;
        const starredFixtureIds = get().starredFixtureIds;
        const initialPlan = planNextKeyNode(world, favoriteTeamIds, starredFixtureIds);
        if (!initialPlan || initialPlan.blocked || initialPlan.skipWindows <= 0) return false;

        set({ isAdvancing: true, advanceError: null });
        await yieldForAdvanceFeedback();
        try {
          let allNews: NewsItem[] = [];
          let lastResults: MatchResult[] = [];
          let observationSettlements: ObservationSettlement[] = [];
          const outcomes: AdvanceWindowOutcome[] = [];
          let safety = 0;

          while (safety < 60) {
            const currentWindow = getCurrentWindow(world);
            if (!currentWindow) break;
            if (
              world.seasonState.seasonNumber === initialPlan.seasonNumber
              && world.seasonState.currentWindowIndex === initialPlan.windowIndex
            ) break;
            if (outcomes.length > 0) {
              const emergentGuard = getCurrentKeyNodeGuard(world, favoriteTeamIds, starredFixtureIds);
              if (emergentGuard) break;
            }

            const result = executeWindowWithObservationSettlement(
              world,
              favoriteTeamIds,
              observationThemePreference,
            );
            world = result.world;
            lastResults = result.results;
            allNews = [...allNews, ...result.news];
            observationSettlements = [...observationSettlements, ...result.observationSettlements];
            outcomes.push(result.outcome);
            safety++;

            const reachedStoryClimax = result.news.some(
              item => item.type === 'storyline' && item.importance === 'major',
            );
            if (result.observationSettlements.length > 0 || reachedStoryClimax) break;
          }

          if (outcomes.length === 0) {
            set({ isAdvancing: false });
            return false;
          }
          if (allNews.length > 30) allNews = allNews.slice(-30);
          world = boundWorldStorageMetadata(enforceStorageLimits(world));
          const worldResponse = buildAdvanceWorldResponse(
            'key_node',
            outcomes,
            world,
            favoriteTeamIds,
            get().favoriteTeamId,
          );
          set({
            world,
            lastResults,
            lastNews: allNews,
            lastObservationSettlements: observationSettlements,
            lastWorldResponse: worldResponse,
            isAdvancing: false,
            advanceTick: get().advanceTick + 1,
          });
          return true;
        } catch (e) {
          console.error('Error advancing to key node:', e);
          set({ isAdvancing: false, advanceError: readableAdvanceError() });
          return false;
        }
      },

      dismissAdvanceError: () => set({ advanceError: null }),

      setFavoriteTeam: (teamId: string | null) => {
        if (teamId === null) {
          set({ favoriteTeamId: null, favoriteTeamIds: [] });
        } else {
          const cur = get().favoriteTeamIds;
          const ordered = [teamId, ...cur.filter(id => id !== teamId)].slice(0, 3);
          set({ favoriteTeamId: teamId, favoriteTeamIds: ordered });
        }
      },

      setFavoriteTeams: (ids: string[]) => {
        const trimmed = [...new Set(ids.filter(Boolean))].slice(0, 3);
        set({ favoriteTeamIds: trimmed, favoriteTeamId: trimmed[0] ?? null });
      },

      setPrimaryFavoriteTeam: (teamId: string) => {
        const cur = get().favoriteTeamIds;
        if (!cur.includes(teamId)) return;
        const ordered = [teamId, ...cur.filter(id => id !== teamId)];
        set({ favoriteTeamId: teamId, favoriteTeamIds: ordered });
      },

      toggleFavoriteTeam: (teamId: string) => {
        const cur = get().favoriteTeamIds;
        let next: string[];
        if (cur.includes(teamId)) {
          next = cur.filter((id) => id !== teamId);
        } else {
          if (cur.length >= 3) {
            next = [...cur.slice(0, 2), teamId];
          } else {
            next = [...cur, teamId];
          }
        }
        const currentPrimary = get().favoriteTeamId;
        const primary = currentPrimary && next.includes(currentPrimary)
          ? currentPrimary
          : next[0] ?? null;
        const ordered = primary ? [primary, ...next.filter(id => id !== primary)] : next;
        set({ favoriteTeamIds: ordered, favoriteTeamId: primary });
      },

      setObservationThemePreference: (preference) => {
        set({ observationThemePreference: preference });
      },

      setPrediction: (champion: string, relegated: string) => {
        const { world } = get();
        if (!world || world.prediction) return;
        set({ world: { ...world, prediction: { champion, relegated } } });
      },

      useGodHand: (teamId: string, type: 'boost' | 'nerf') => {
        const { world } = get();
        if (!world) return;
        const updatedWorld = applyGodHandIntervention(world, teamId, type);
        if (updatedWorld !== world) set({ world: updatedWorld });
      },

      fireCoach: (teamId: string) => {
        const { world, favoriteTeamIds } = get();
        // Allow firing coach for any favorited team
        if (!world || !favoriteTeamIds.includes(teamId)) return;
        // Coach is derived from coachStates (single source of truth post-v7).
        const coachId = getTeamCoachId(world.coachStates, teamId);
        if (!coachId) return;
        const teamBase = world.teamBases[teamId];
        const rng = new SeededRNG(world.rngState);
        const allCoachData = Object.entries(world.coachStates).map(([id, cs]) => ({
          base: world.coachBases[id], state: cs,
        })).filter(c => c.base != null);
        const result = processCoachFiring(teamId, coachId, teamBase, allCoachData, world.seasonState.seasonNumber, rng);

        const coachStates = { ...world.coachStates };
        coachStates[coachId] = { ...coachStates[coachId], ...result.firedCoachUpdate };
        if (coachStates[result.newCoachId]) {
          coachStates[result.newCoachId] = { ...coachStates[result.newCoachId], ...result.newCoachUpdate };
        } else {
          coachStates[result.newCoachId] = { id: result.newCoachId, currentTeamId: teamId, isUnemployed: false, unemployedSince: null };
        }

        // teamStates only carries pressure now — the coach assignment lives on
        // coachStates[result.newCoachId].currentTeamId (set above).
        const teamStates = { ...world.teamStates };
        teamStates[teamId] = { ...teamStates[teamId], coachPressure: 10 };

        const coachCareers = { ...world.coachCareers };
        const firedCareer = [...(coachCareers[coachId] ?? [])];
        const lastEntry = firedCareer[firedCareer.length - 1];
        if (lastEntry && lastEntry.toSeason === null) {
          firedCareer[firedCareer.length - 1] = { ...lastEntry, ...result.firedCareerUpdate };
        }
        coachCareers[coachId] = firedCareer;
        const newCareer = [...(coachCareers[result.newCoachId] ?? [])];
        newCareer.push(result.newCareerEntry);
        coachCareers[result.newCoachId] = newCareer;

        const sn = world.seasonState.seasonNumber;
        const wi = world.seasonState.currentWindowIndex;
        const firedName = world.coachBases[coachId]?.name ?? coachId;
        const newName = world.coachBases[result.newCoachId]?.name ?? result.newCoachId;
        const news: NewsItem[] = [
          { id: `manual-fire-${teamId}-S${sn}`, seasonNumber: sn, windowIndex: wi, type: 'coach_fired', title: `${firedName} 被管理层解雇 — ${teamBase.name}`, description: `${teamBase.name}管理层决定解雇${firedName}。` },
          { id: `manual-hire-${teamId}-S${sn}`, seasonNumber: sn, windowIndex: wi, type: 'coach_hired', title: `${teamBase.name} 聘用新帅 ${newName}`, description: `${newName} 正式执教 ${teamBase.name}。` },
        ];
        const coachChanges = [...world.coachChangesThisSeason, { teamId, oldCoachId: coachId, newCoachId: result.newCoachId, reason: '管理层决定' }];

        set({ world: { ...world, teamStates, coachStates, coachCareers, coachChangesThisSeason: coachChanges, newsLog: [...world.newsLog, ...news], rngState: rng.getState() } });
      },

      setObservationJudgment: (fixtureId, kind, selection) => {
        const { world } = get();
        if (!world) return;
        if (!isObservationSelectionValid(kind, selection)) return;
        const window = getCurrentWindow(world);
        if (!window?.fixtures.some(fixture => fixture.id === fixtureId)) return;
        set({
          world: {
            ...world,
            pendingObservationJudgment: {
              fixtureId,
              seasonNumber: world.seasonState.seasonNumber,
              windowIndex: world.seasonState.currentWindowIndex,
              kind,
              selection,
            },
          },
        });
      },

      cancelObservationJudgment: () => {
        const { world } = get();
        if (world?.pendingObservationJudgment) {
          set({ world: { ...world, pendingObservationJudgment: null } });
        }
      },

      toggleStarFixture: (fixtureId: string) => {
        const cur = get().starredFixtureIds;
        if (cur.includes(fixtureId)) {
          set({ starredFixtureIds: cur.filter((id) => id !== fixtureId) });
        } else {
          set({ starredFixtureIds: [...cur, fixtureId] });
        }
      },

      clearStarredFixtures: () => {
        set({ starredFixtureIds: [] });
      },

      // ── Phase 2: transfer window actions ─────────────────────
      // All mutate `world.transferWindow` + (when accepted) move players
      // and adjust cash. After every action the world snapshot is updated
      // and persisted via the debounced compressed-storage layer.

      acceptIncomingOffer: (offerId: string) => {
        const { world } = get();
        if (!world?.transferWindow) return;
        const tw = world.transferWindow;
        const offer = tw.incomingOffers.find(o => o.id === offerId);
        if (!offer || offer.resolution !== 'pending') return;
        const fee = offer.counterFee ?? offer.fee;
        const newWorld = applyOfferTransfer(world, offer, fee);
        const resolution = newWorld === world ? 'withdrawn' as const : 'accepted' as const;
        const updatedOffers = tw.incomingOffers.map(o => o.id === offerId
          ? { ...o, resolution }
          : o);
        set({ world: { ...newWorld, transferWindow: { ...tw, incomingOffers: updatedOffers } }, advanceTick: get().advanceTick + 1 });
      },

      rejectIncomingOffer: (offerId: string) => {
        const { world } = get();
        if (!world?.transferWindow) return;
        const tw = world.transferWindow;
        const updatedOffers = tw.incomingOffers.map(o => o.id === offerId
          ? { ...o, resolution: 'rejected' as const }
          : o);
        set({ world: { ...world, transferWindow: { ...tw, incomingOffers: updatedOffers } }, advanceTick: get().advanceTick + 1 });
      },

      counterIncomingOffer: (offerId: string) => {
        const { world } = get();
        if (!world?.transferWindow) return;
        const tw = world.transferWindow;
        const offer = tw.incomingOffers.find(o => o.id === offerId);
        if (!offer || offer.resolution !== 'pending') return;
        const counterFee = suggestCounterFee(offer);
        const buyerFinance = world.teamFinances[offer.buyerId];
        const buyerValuation = offer.buyerValuation
          ?? Math.max(offer.fee * 1.2, (offer.marketValue ?? offer.fee) * 1.05);
        const acceptanceProbability = counterAcceptanceProbability({
          counterFee,
          buyerValuation,
          buyerCash: buyerFinance?.cash,
          needScore: offer.needScore,
        });
        const rng = transferActionRng(world, `counter:${offerId}:${offer.counterFee ?? offer.fee}`);
        const accepts = rng.next() < acceptanceProbability;
        if (accepts) {
          const newWorld = applyOfferTransfer(world, offer, counterFee);
          const resolution = newWorld === world ? 'withdrawn' as const : 'countered_accepted' as const;
          const updatedOffers = tw.incomingOffers.map(o => o.id === offerId
            ? { ...o, counterFee, resolution }
            : o);
          set({ world: { ...newWorld, transferWindow: { ...tw, incomingOffers: updatedOffers } }, advanceTick: get().advanceTick + 1 });
        } else {
          const updatedOffers = tw.incomingOffers.map(o => o.id === offerId
            ? { ...o, counterFee, resolution: 'countered_rejected' as const }
            : o);
          set({ world: { ...world, transferWindow: { ...tw, incomingOffers: updatedOffers } }, advanceTick: get().advanceTick + 1 });
        }
      },

      bidForOutgoingTarget: (targetId: string, fee: number) => {
        const { world } = get();
        if (!world?.transferWindow) return;
        const tw = world.transferWindow;
        const target = tw.outgoingTargets.find(t => t.id === targetId);
        if (!target || target.resolution !== 'pending') return;
        const finance = world.teamFinances[target.toTeamId];
        if (!finance || finance.cash < fee) {
          // Cash check failed — silently mark skipped
          const updatedTargets = tw.outgoingTargets.map(t => t.id === targetId
            ? { ...t, bidFee: fee, resolution: 'skipped' as const }
            : t);
          set({ world: { ...world, transferWindow: { ...tw, outgoingTargets: updatedTargets } }, advanceTick: get().advanceTick + 1 });
          return;
        }
        const sellerSquad = world.squads[target.fromTeamId] ?? [];
        const player = sellerSquad.find((candidate) => candidate.uuid === target.playerId);
        if (!player) return;
        const acceptanceProbability = sellerAcceptanceProbability({
          bid: fee,
          askingValue: target.suggestedFee,
          sellerCash: world.teamFinances[target.fromTeamId]?.cash,
          keyPlayer: isKeySquadPlayer(sellerSquad, player),
        });
        const rng = transferActionRng(world, `bid:${targetId}:${fee}`);
        const accepted = rng.next() < acceptanceProbability;
        if (accepted) {
          const newWorld = applyOutgoingBid(world, target, fee);
          const resolution = newWorld === world ? 'skipped' as const : 'bid_accepted' as const;
          const updatedTargets = tw.outgoingTargets.map(t => t.id === targetId
            ? { ...t, bidFee: fee, resolution }
            : t);
          set({ world: { ...newWorld, transferWindow: { ...tw, outgoingTargets: updatedTargets } }, advanceTick: get().advanceTick + 1 });
        } else {
          const updatedTargets = tw.outgoingTargets.map(t => t.id === targetId
            ? { ...t, bidFee: fee, resolution: 'bid_rejected' as const }
            : t);
          set({ world: { ...world, transferWindow: { ...tw, outgoingTargets: updatedTargets } }, advanceTick: get().advanceTick + 1 });
        }
      },

      signFromFreeAgentPool: (uuid: string, requestedTeamId?: string) => {
        const { world, favoriteTeamIds } = get();
        if (!world?.transferWindow) return;
        const tw = world.transferWindow;
        if (tw.signedFromPool.includes(uuid)) return;
        if (favoriteTeamIds.length === 0) return;
        const targetTeamId = requestedTeamId && favoriteTeamIds.includes(requestedTeamId)
          ? requestedTeamId
          : favoriteTeamIds[0];
        const newWorld = signFreeAgent(world, uuid, targetTeamId);
        if (!newWorld) return; // sign failed
        set({
          world: { ...newWorld, transferWindow: { ...tw, signedFromPool: [...tw.signedFromPool, uuid] } },
          advanceTick: get().advanceTick + 1,
        });
      },

      closeTransferWindow: (autoResolveRest: boolean) => {
        let { world } = get();
        if (!world?.transferWindow) return;
        if (autoResolveRest) {
          world = autoResolveRemaining(world);
        }
        // v23 — non-blocking architecture. The new season was already
        // initialised at season_end time, so closing the window is just
        // a UI commit: clear the staged decisions.
        // v23.1 — also reconcile playerStats teamIds as a safety net,
        // in case any future code path forgets to sync after moving a
        // player (avoids the "stat row pinned to old team" bug class
        // that surfaced as misattributed top-scorers + skipped awards).
        const cleared = {
          ...world,
          transferWindow: null,
          playerStats: syncPlayerStatsTeamIds(world.playerStats, world.squads),
        };
        set({ world: cleared, advanceTick: get().advanceTick + 1 });
      },

      resetGame: () => {
        set({
          world: null,
          initialized: false,
          lastResults: [],
          lastNews: [],
          lastObservationSettlements: [],
          lastWorldResponse: null,
          advanceError: null,
          favoriteTeamId: null,
          favoriteTeamIds: [],
          observationThemePreference: 'auto',
        });
        compressedStorage.removeItem(SAVE_STORAGE_KEY);
      },

      getCurrentWindow: () => {
        const { world } = get();
        if (!world) return null;
        return getCurrentWindow(world);
      },

      getTeamsByLeague: (level: 1 | 2 | 3) => {
        const { world } = get();
        if (!world) return [];
        return Object.values(world.teamStates).filter(s => s.leagueLevel === level).map(s => s.id);
      },

      isGameOver: () => {
        const { world } = get();
        if (!world) return false;
        return isSeasonFullyComplete(world);
      },

      trimStorage: () => {
        const { world } = get();
        if (!world) return null;
        const cleanup = archiveCompletedMatchDetails(world);
        set({ world: cleanup.world });
        return cleanup;
      },
    }),
    {
      name: SAVE_STORAGE_KEY,
      version: SAVE_SCHEMA_VERSION,
      // Validate the complete current envelope before Zustand can hydrate it.
      // Invalid payloads are quarantined and removed from the active key.
      storage: createCurrentSavePersistStorage<PersistedGameState>(),
      partialize: (state) => ({
        world: state.world,
        initialized: state.initialized,
        // Both batches already exist in the current calendar/news log and are
        // reconstructed on hydration. Keep empty schema fields for readable
        // current-save validation without duplicating a large match batch.
        lastResults: EMPTY_PERSISTED_RESULTS,
        lastNews: EMPTY_PERSISTED_NEWS,
        favoriteTeamId: state.favoriteTeamId,
        favoriteTeamIds: state.favoriteTeamIds,
        observationThemePreference: state.observationThemePreference,
      }),
      merge: mergePersistedGameState,
    }
  )
);


// The production audit runs against a built preview. Expose the local-only
// store bridge only for an explicit audit URL; normal sessions expose nothing.
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('audit')) {
  const auditWindow = window as unknown as {
    __gameStore?: typeof useGameStore;
    __gameAudit?: {
      exportSave: () => string;
      importSave: (text: string) => void;
    };
  };
  auditWindow.__gameStore = useGameStore;
  auditWindow.__gameAudit = {
    exportSave: () => exportCurrentSave(SAVE_STORAGE_KEY),
    importSave: (text) => importCurrentSave(SAVE_STORAGE_KEY, text),
  };
}

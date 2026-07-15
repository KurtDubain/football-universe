import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { compressedStorage } from './compressed-storage';
import { currentSaveStorage, SAVE_SCHEMA_VERSION, SAVE_STORAGE_KEY } from './save-schema';
import { GameWorld, NewsItem, initializeGameWorld, executeCurrentWindow, getCurrentWindow, isSeasonFullyComplete } from '../engine/season/season-manager';
import { applyOfferTransfer, applyOutgoingBid, signFreeAgent, autoResolveRemaining } from './transfer-window-actions';
import { syncPlayerStatsTeamIds } from '../engine/players/stats';
import { processCoachFiring } from '../engine/coaches/coach-hiring';
import { getTeamCoachId } from '../engine/coaches/coach-lookup';
import { SeededRNG } from '../engine/match/rng';
import { CalendarWindow } from '../types/season';
import { MatchResult } from '../types/match';
import type { Achievement } from '../engine/achievements';
import { enforceStorageLimits } from '../engine/season/storage-limits';

interface GameStore {
  world: GameWorld | null;
  initialized: boolean;
  lastResults: MatchResult[];
  lastNews: NewsItem[];
  isAdvancing: boolean;
  /** Bumps on every successful advance — Dashboard listens for changes to trigger
   *  auto-live / celebration / tab switch reliably each advance, not just the first. */
  advanceTick: number;
  /** Single-team selection — kept for backward compatibility. Prefer `favoriteTeamIds`. */
  favoriteTeamId: string | null;
  /** Multi-favorite list (up to 3 teams). */
  favoriteTeamIds: string[];
  /** Transient set of fixtures the user starred for auto-live (cleared on advance). */
  starredFixtureIds: string[];
  newAchievements: Achievement[];

  dismissAchievement: () => void;

  newGame: (seed?: number, options?: { gameMode?: import('../types/game-mode').GameMode; customTeams?: import('../types/team').TeamBase[] }) => void;
  advanceWindow: () => void;
  batchAdvance: (count: number) => void;
  advanceUntil: (type: 'cup' | 'season_end') => void;
  /** Sets the legacy primary favorite. */
  setFavoriteTeam: (teamId: string | null) => void;
  /** Sets the entire favorites list (max 3 entries). */
  setFavoriteTeams: (ids: string[]) => void;
  /** Toggle a team's membership in the favorites list. */
  toggleFavoriteTeam: (teamId: string) => void;
  setPrediction: (champion: string, relegated: string) => void;
  useGodHand: (teamId: string, type: 'boost' | 'nerf') => void;
  fireCoach: (teamId: string) => void;
  toggleStarFixture: (fixtureId: string) => void;
  clearStarredFixtures: () => void;
  placeBet: (fixtureId: string, outcome: 'home' | 'draw' | 'away', amount: number, odds: number) => void;
  // ── Phase 2: transfer window actions ──
  acceptIncomingOffer: (offerId: string) => void;
  rejectIncomingOffer: (offerId: string) => void;
  counterIncomingOffer: (offerId: string) => void;
  bidForOutgoingTarget: (targetId: string, fee: number) => void;
  signFromFreeAgentPool: (uuid: string) => void;
  closeTransferWindow: (autoResolveRest: boolean) => void;
  resetGame: () => void;
  getCurrentWindow: () => CalendarWindow | null;
  getTeamsByLeague: (level: 1 | 2 | 3) => string[];
  isGameOver: () => boolean;
  trimStorage: () => void;
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
      isAdvancing: false,
      advanceTick: 0,
      favoriteTeamId: null,
      favoriteTeamIds: [],
      starredFixtureIds: [],
      newAchievements: [],

      dismissAchievement: () => {
        set(s => ({ newAchievements: s.newAchievements.slice(1) }));
      },

      newGame: (seed?: number, options?: { gameMode?: import('../types/game-mode').GameMode; customTeams?: import('../types/team').TeamBase[] }) => {
        const actualSeed = seed ?? Math.floor(Math.random() * 1000000);
        const world = initializeGameWorld(actualSeed, options);
        set({ world, initialized: true, lastResults: [], lastNews: [] });
      },

      advanceWindow: () => {
        const { world } = get();
        if (!world) return;
        set({ isAdvancing: true });
        try {
          const result = executeCurrentWindow(world, { favoriteTeamIds: get().favoriteTeamIds });
          // Settle bets
          let coins = result.world.coins ?? 1000;
          for (const bet of (result.world.bets ?? [])) {
            const matchResult = result.results.find(r => r.fixtureId === bet.fixtureId);
            if (!matchResult) continue;
            const totalHome = matchResult.homeGoals + (matchResult.etHomeGoals ?? 0);
            const totalAway = matchResult.awayGoals + (matchResult.etAwayGoals ?? 0);
            const actual = totalHome > totalAway ? 'home' : totalAway > totalHome ? 'away' : 'draw';
            if (actual === bet.outcome) {
              coins += Math.round(bet.amount * bet.odds);
            }
          }
          const updatedWorld = { ...result.world, coins, bets: [] as typeof result.world.bets };

          // Detect new achievements (compare against pre-advance state)
          const oldAchIds = new Set((world.achievements ?? []).map(a => a.id));
          const newAch = (updatedWorld.achievements ?? []).filter(a => !oldAchIds.has(a.id));

          set({ world: updatedWorld, lastResults: result.results, lastNews: result.news, isAdvancing: false, advanceTick: get().advanceTick + 1, newAchievements: [...get().newAchievements, ...newAch] });
          if (updatedWorld.seasonState.completed || updatedWorld.newsLog.length > 300) {
            get().trimStorage();
          }
        } catch (e) {
          console.error('Error advancing window:', e);
          set({ isAdvancing: false });
        }
      },

      batchAdvance: (count: number) => {
        let { world } = get();
        if (!world) return;
        set({ isAdvancing: true });
        try {
          let allResults: MatchResult[] = [];
          let allNews: NewsItem[] = [];
          for (let i = 0; i < count; i++) {
            const cw = getCurrentWindow(world);
            if (!cw) break;
            const result = executeCurrentWindow(world, { favoriteTeamIds: get().favoriteTeamIds });
            world = result.world;
            allResults = result.results; // keep only last window's results
            allNews = [...allNews, ...result.news];
          }
          // Trim news to last 30
          if (allNews.length > 30) allNews = allNews.slice(-30);
          world = enforceStorageLimits(world);
          set({ world, lastResults: allResults, lastNews: allNews, isAdvancing: false, advanceTick: get().advanceTick + 1 });
        } catch (e) {
          console.error('Error in batch advance:', e);
          set({ world, isAdvancing: false });
        }
      },

      advanceUntil: (type: 'cup' | 'season_end') => {
        let { world } = get();
        if (!world) return;
        set({ isAdvancing: true });
        try {
          let allNews: NewsItem[] = [];
          let lastResults: MatchResult[] = [];
          let safety = 0;
          while (safety < 60) {
            const cw = getCurrentWindow(world);
            if (!cw) break;
            // Stop conditions
            if (type === 'cup' && (cw.type === 'league_cup' || cw.type === 'super_cup' || cw.type === 'super_cup_group')) break;
            if (type === 'season_end' && cw.type === 'season_end') break;
            const result = executeCurrentWindow(world, { favoriteTeamIds: get().favoriteTeamIds });
            world = result.world;
            lastResults = result.results;
            allNews = [...allNews, ...result.news];
            safety++;
          }
          if (allNews.length > 30) allNews = allNews.slice(-30);
          world = enforceStorageLimits(world);
          set({ world, lastResults, lastNews: allNews, isAdvancing: false, advanceTick: get().advanceTick + 1 });
        } catch (e) {
          console.error('Error in advanceUntil:', e);
          set({ world, isAdvancing: false });
        }
      },

      setFavoriteTeam: (teamId: string | null) => {
        // Keep legacy single field in sync; also reflect in array.
        if (teamId === null) {
          set({ favoriteTeamId: null, favoriteTeamIds: [] });
        } else {
          const cur = get().favoriteTeamIds;
          const next = cur.includes(teamId) ? cur : [teamId, ...cur].slice(0, 3);
          set({ favoriteTeamId: teamId, favoriteTeamIds: next });
        }
      },

      setFavoriteTeams: (ids: string[]) => {
        const trimmed = ids.slice(0, 3);
        set({ favoriteTeamIds: trimmed, favoriteTeamId: trimmed[0] ?? null });
      },

      toggleFavoriteTeam: (teamId: string) => {
        const cur = get().favoriteTeamIds;
        let next: string[];
        if (cur.includes(teamId)) {
          next = cur.filter((id) => id !== teamId);
        } else {
          if (cur.length >= 3) {
            // Drop the oldest (last) to make room
            next = [teamId, ...cur.slice(0, 2)];
          } else {
            next = [teamId, ...cur];
          }
        }
        set({ favoriteTeamIds: next, favoriteTeamId: next[0] ?? null });
      },

      setPrediction: (champion: string, relegated: string) => {
        const { world } = get();
        if (!world || world.prediction) return;
        set({ world: { ...world, prediction: { champion, relegated } } });
      },

      useGodHand: (teamId: string, type: 'boost' | 'nerf') => {
        const { world } = get();
        if (!world || world.godHandUsed) return;
        const teamBases = { ...world.teamBases };
        const base = { ...teamBases[teamId] };
        if (type === 'boost') {
          base.attack = Math.min(99, base.attack + 5);
          base.midfield = Math.min(99, base.midfield + 3);
          base.stability = Math.min(99, base.stability + 4);
        } else {
          base.attack = Math.max(30, base.attack - 4);
          base.stability = Math.max(30, base.stability - 5);
          base.depth = Math.max(30, base.depth - 4);
        }
        teamBases[teamId] = base;
        const teamName = base.name ?? teamId;
        const sn = world.seasonState.seasonNumber;
        const wi = world.seasonState.currentWindowIndex;
        const newsItem: NewsItem = {
          id: `godhand-S${sn}-${teamId}`,
          seasonNumber: sn, windowIndex: wi,
          type: type === 'boost' ? 'trophy' : 'coach_fired',
          title: type === 'boost' ? `神秘力量降临 ${teamName}` : `${teamName} 遭遇厄运`,
          description: type === 'boost'
            ? `一股神秘力量笼罩了${teamName}，全队状态爆发，攻防大幅提升！`
            : `${teamName}遭遇不可抗力打击，士气和阵容深度严重受损。`,
        };
        set({ world: { ...world, teamBases, godHandUsed: true, newsLog: [...world.newsLog, newsItem] } });
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

      placeBet: (fixtureId: string, outcome: 'home' | 'draw' | 'away', amount: number, odds: number) => {
        const { world } = get();
        if (!world || (world.coins ?? 0) < amount) return;
        const bets = [...(world.bets ?? [])];
        const existing = bets.findIndex(b => b.fixtureId === fixtureId);
        if (existing >= 0) {
          world.coins = (world.coins ?? 1000) + bets[existing].amount;
          bets.splice(existing, 1);
        }
        bets.push({ fixtureId, outcome, amount, odds });
        set({ world: { ...world, coins: (world.coins ?? 1000) - amount, bets } });
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
        const updatedOffers = tw.incomingOffers.map(o => o.id === offerId
          ? { ...o, resolution: 'accepted' as const }
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
        const counterFee = Math.round(offer.fee * 1.3);
        // 60% chance the buyer accepts the counter
        const rng = transferActionRng(world, `counter:${offerId}:${offer.counterFee ?? offer.fee}`);
        const accepts = rng.next() < 0.6;
        if (accepts) {
          const newWorld = applyOfferTransfer(world, offer, counterFee);
          const updatedOffers = tw.incomingOffers.map(o => o.id === offerId
            ? { ...o, counterFee, resolution: 'countered_accepted' as const }
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
        // AI decision: accept if bid >= suggestedFee × 0.9
        // Otherwise 40% chance to accept anyway (greedy seller)
        const rng = transferActionRng(world, `bid:${targetId}:${fee}`);
        const meetsAsk = fee >= target.suggestedFee * 0.9;
        const accepted = meetsAsk || rng.next() < 0.4;
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

      signFromFreeAgentPool: (uuid: string) => {
        const { world, favoriteTeamIds } = get();
        if (!world?.transferWindow) return;
        const tw = world.transferWindow;
        if (tw.signedFromPool.includes(uuid)) return;
        if (favoriteTeamIds.length === 0) return;
        // Sign to first favorite team that has room
        const targetTeamId = favoriteTeamIds[0];
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
        set({ world: null, initialized: false, lastResults: [], lastNews: [], favoriteTeamId: null, favoriteTeamIds: [] });
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
        if (!world) return;
        // Trim newsLog to last 200
        const trimmedNews = world.newsLog.length > 200 ? world.newsLog.slice(-200) : world.newsLog;
        // Trim old calendar events (keep results but strip detailed events for old seasons)
        const cal = world.seasonState.calendar.map(w => {
          if (w.completed && w.results.length > 0) {
            return { ...w, results: w.results.map(r => ({ ...r, events: r.events.slice(0, 5) })) };
          }
          return w;
        });
        set({
          world: { ...world, newsLog: trimmedNews, seasonState: { ...world.seasonState, calendar: cal } },
        });
      },
    }),
    {
      name: SAVE_STORAGE_KEY,
      version: SAVE_SCHEMA_VERSION,
      // Validate the complete current envelope before Zustand can hydrate it.
      // Invalid payloads are quarantined and removed from the active key.
      storage: createJSONStorage(() => currentSaveStorage),
      partialize: (state) => ({
        world: state.world,
        initialized: state.initialized,
        lastResults: state.lastResults,
        lastNews: state.lastNews,
        favoriteTeamId: state.favoriteTeamId,
        favoriteTeamIds: state.favoriteTeamIds,
      }),
    }
  )
);


// Dev-only: expose store on window for audit/playwright scripts.
// Production builds tree-shake `import.meta.env.DEV` away.
if (import.meta.env?.DEV && typeof window !== "undefined") {
  (window as unknown as { __gameStore?: typeof useGameStore }).__gameStore = useGameStore;
}

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { GameWorld, NewsItem, initializeGameWorld, executeCurrentWindow, getCurrentWindow, isSeasonFullyComplete } from '../engine/season/season-manager';
import { processCoachFiring } from '../engine/coaches/coach-hiring';
import { SeededRNG } from '../engine/match/rng';
import { CalendarWindow } from '../types/season';
import { MatchResult } from '../types/match';
import type { Achievement } from '../engine/achievements';
import { pickPlayerName } from '../config/player-names';

interface GameStore {
  world: GameWorld | null;
  initialized: boolean;
  lastResults: MatchResult[];
  lastNews: NewsItem[];
  isAdvancing: boolean;
  favoriteTeamId: string | null;
  newAchievements: Achievement[];

  dismissAchievement: () => void;

  newGame: (seed?: number, options?: { gameMode?: import('../types/game-mode').GameMode; customTeams?: import('../types/team').TeamBase[] }) => void;
  advanceWindow: () => void;
  batchAdvance: (count: number) => void;
  advanceUntil: (type: 'cup' | 'season_end') => void;
  setFavoriteTeam: (teamId: string | null) => void;
  setPrediction: (champion: string, relegated: string) => void;
  useGodHand: (teamId: string, type: 'boost' | 'nerf') => void;
  fireCoach: (teamId: string) => void;
  placeBet: (fixtureId: string, outcome: 'home' | 'draw' | 'away', amount: number, odds: number) => void;
  resetGame: () => void;
  getCurrentWindow: () => CalendarWindow | null;
  getTeamsByLeague: (level: 1 | 2 | 3) => string[];
  isGameOver: () => boolean;
  trimStorage: () => void;
}

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => ({
      world: null,
      initialized: false,
      lastResults: [],
      lastNews: [],
      isAdvancing: false,
      favoriteTeamId: null,
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
          const result = executeCurrentWindow(world);
          // Settle bets
          let coins = result.world.coins ?? 1000;
          const settledBets = (result.world.bets ?? []).length > 0 ? [] : [];
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

          set({ world: updatedWorld, lastResults: result.results, lastNews: result.news, isAdvancing: false, newAchievements: [...get().newAchievements, ...newAch] });
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
            const result = executeCurrentWindow(world);
            world = result.world;
            allResults = result.results; // keep only last window's results
            allNews = [...allNews, ...result.news];
          }
          // Trim news to last 30
          if (allNews.length > 30) allNews = allNews.slice(-30);
          set({ world, lastResults: allResults, lastNews: allNews, isAdvancing: false });
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
            const result = executeCurrentWindow(world);
            world = result.world;
            lastResults = result.results;
            allNews = [...allNews, ...result.news];
            safety++;
          }
          if (allNews.length > 30) allNews = allNews.slice(-30);
          set({ world, lastResults, lastNews: allNews, isAdvancing: false });
        } catch (e) {
          console.error('Error in advanceUntil:', e);
          set({ world, isAdvancing: false });
        }
      },

      setFavoriteTeam: (teamId: string | null) => {
        set({ favoriteTeamId: teamId });
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
        const { world, favoriteTeamId } = get();
        if (!world || teamId !== favoriteTeamId) return;
        const state = world.teamStates[teamId];
        const coachId = state?.currentCoachId;
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

        const teamStates = { ...world.teamStates };
        teamStates[teamId] = { ...teamStates[teamId], currentCoachId: result.newCoachId, coachPressure: 10 };

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

      resetGame: () => {
        set({ world: null, initialized: false, lastResults: [], lastNews: [], favoriteTeamId: null });
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
      name: 'football-universe-save',
      version: 3,
      migrate: (persistedState: unknown, version: number): GameStore => {
        const state = persistedState as Partial<GameStore> & { world?: GameWorld | null };
        // v1 → v2: backfill player.name for existing saves
        if (version < 2 && state?.world?.squads && state.world.teamBases) {
          const teamBases = state.world.teamBases;
          for (const [teamId, squad] of Object.entries(state.world.squads)) {
            if (!Array.isArray(squad)) continue;
            const region = teamBases[teamId]?.region ?? '大陆+其他';
            const used = new Set<string>();
            for (const p of squad) {
              if (!p.name) {
                // Use Math.random for migration (one-time, acceptable to be non-deterministic)
                p.name = pickPlayerName(region, used, <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]);
              } else {
                used.add(p.name);
              }
            }
          }
        }
        // v2 → v3: ensure playerAwardsHistory & transferHistory exist
        if (version < 3 && state?.world) {
          if (!Array.isArray(state.world.playerAwardsHistory)) state.world.playerAwardsHistory = [];
          if (!Array.isArray(state.world.transferHistory)) state.world.transferHistory = [];
        }
        return state as GameStore;
      },
      partialize: (state) => ({
        world: state.world,
        initialized: state.initialized,
        lastResults: state.lastResults,
        lastNews: state.lastNews,
        favoriteTeamId: state.favoriteTeamId,
      }),
    }
  )
);

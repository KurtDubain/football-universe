import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { GameWorld, NewsItem, initializeGameWorld, executeCurrentWindow, getCurrentWindow, isSeasonFullyComplete } from '../engine/season/season-manager';
import { CalendarWindow } from '../types/season';
import { MatchResult } from '../types/match';

interface GameStore {
  // State
  world: GameWorld | null;
  initialized: boolean;
  lastResults: MatchResult[];
  lastNews: NewsItem[];
  isAdvancing: boolean;

  // Actions
  newGame: (seed?: number) => void;
  advanceWindow: () => void;
  resetGame: () => void;

  // Selectors (computed helpers)
  getCurrentWindow: () => CalendarWindow | null;
  getTeamsByLeague: (level: 1 | 2 | 3) => string[];
  isGameOver: () => boolean;
}

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => ({
      world: null,
      initialized: false,
      lastResults: [],
      lastNews: [],
      isAdvancing: false,

      newGame: (seed?: number) => {
        const actualSeed = seed ?? Math.floor(Math.random() * 1000000);
        const world = initializeGameWorld(actualSeed);
        set({ world, initialized: true, lastResults: [], lastNews: [] });
      },

      advanceWindow: () => {
        const { world } = get();
        if (!world) return;

        set({ isAdvancing: true });

        try {
          const result = executeCurrentWindow(world);
          set({
            world: result.world,
            lastResults: result.results,
            lastNews: result.news,
            isAdvancing: false,
          });
        } catch (e) {
          console.error('Error advancing window:', e);
          set({ isAdvancing: false });
        }
      },

      resetGame: () => {
        set({ world: null, initialized: false, lastResults: [], lastNews: [] });
      },

      getCurrentWindow: () => {
        const { world } = get();
        if (!world) return null;
        return getCurrentWindow(world);
      },

      getTeamsByLeague: (level: 1 | 2 | 3) => {
        const { world } = get();
        if (!world) return [];
        return Object.values(world.teamStates)
          .filter(s => s.leagueLevel === level)
          .map(s => s.id);
      },

      isGameOver: () => {
        const { world } = get();
        if (!world) return false;
        return isSeasonFullyComplete(world);
      },
    }),
    {
      name: 'football-universe-save',
      version: 1,
      // Don't persist isAdvancing state
      partialize: (state) => ({
        world: state.world,
        initialized: state.initialized,
        lastResults: state.lastResults,
        lastNews: state.lastNews,
      }),
    }
  )
);

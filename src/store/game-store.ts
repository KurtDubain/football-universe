import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { GameWorld, NewsItem, initializeGameWorld, executeCurrentWindow, getCurrentWindow, isSeasonFullyComplete } from '../engine/season/season-manager';
import { processCoachFiring } from '../engine/coaches/coach-hiring';
import { getTeamCoachId } from '../engine/coaches/coach-lookup';
import { SeededRNG } from '../engine/match/rng';
import { CalendarWindow } from '../types/season';
import { MatchResult } from '../types/match';
import type { Achievement } from '../engine/achievements';
import { pickPlayerName } from '../config/player-names';
import { computeInitialMarketValue } from '../engine/economy/market-value';

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
  resetGame: () => void;
  getCurrentWindow: () => CalendarWindow | null;
  getTeamsByLeague: (level: 1 | 2 | 3) => string[];
  isGameOver: () => boolean;
  trimStorage: () => void;
}

/**
 * v8 → v9 helper: walk `transferHistory` and `playerAwardsHistory`, replacing
 * any stale legacy `${teamId}-${number}` playerId with the player's current
 * `uuid`. Resolves by `(playerName, teamIdHint)` first (precise), then by
 * `playerName` alone (names are mostly unique in this game). Mutates `world`
 * in place; entries already shaped like a uuid (`p-…`) or with no match are
 * left untouched, so calling this on an already-migrated save is a no-op.
 *
 * Returns a tally `{ transfers, awards }` of how many entries were repaired —
 * the migration in zustand discards it; the unit test asserts on it. The
 * function is exported solely so the test can exercise the logic without
 * standing up a zustand store + localStorage shim.
 */
export function backfillStaleHistoryPlayerIds(world: {
  squads?: Record<string, Array<{ uuid?: string; name?: string }>>;
  transferHistory?: Array<{ playerId?: string; playerName?: string; toTeamId?: string }>;
  playerAwardsHistory?: Array<{ playerId?: string; playerName?: string; teamId?: string }>;
}): { transfers: number; awards: number } {
  const byName = new Map<string, string>();
  const byNameTeam = new Map<string, string>();  // key = "name|teamId"
  for (const [teamId, squad] of Object.entries(world.squads ?? {})) {
    if (!Array.isArray(squad)) continue;
    for (const p of squad) {
      if (typeof p?.uuid !== 'string' || typeof p?.name !== 'string') continue;
      // name → uuid: last write wins. Collisions are rare and the (name, team)
      // path is the precise lookup anyway — this is just a coarse fallback.
      byName.set(p.name, p.uuid);
      byNameTeam.set(`${p.name}|${teamId}`, p.uuid);
    }
  }

  /** Returns the original id on miss so the UI's missing-player fallback still
   *  applies — a partial repair is strictly better than corruption. */
  const repair = (legacyId: string, name: string | undefined, teamIdHint?: string): string => {
    if (typeof legacyId !== 'string') return legacyId;
    if (legacyId.startsWith('p-')) return legacyId; // already a uuid — idempotent
    if (typeof name !== 'string' || name.length === 0) return legacyId;
    if (teamIdHint) {
      const u = byNameTeam.get(`${name}|${teamIdHint}`);
      if (u) return u;
    }
    const u = byName.get(name);
    if (u) return u;
    return legacyId;
  };

  let transfers = 0;
  let awards = 0;
  if (Array.isArray(world.transferHistory)) {
    for (const t of world.transferHistory) {
      if (typeof t?.playerId !== 'string') continue;
      // toTeamId is the destination — that's where the player ended up after
      // the move, so it's the most likely team to find them on today.
      const next = repair(t.playerId, t.playerName, t.toTeamId);
      if (next !== t.playerId) {
        t.playerId = next;
        transfers++;
      }
    }
  }
  if (Array.isArray(world.playerAwardsHistory)) {
    for (const a of world.playerAwardsHistory) {
      if (typeof a?.playerId !== 'string') continue;
      const next = repair(a.playerId, a.playerName, a.teamId);
      if (next !== a.playerId) {
        a.playerId = next;
        awards++;
      }
    }
  }
  return { transfers, awards };
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
            const result = executeCurrentWindow(world);
            world = result.world;
            allResults = result.results; // keep only last window's results
            allNews = [...allNews, ...result.news];
          }
          // Trim news to last 30
          if (allNews.length > 30) allNews = allNews.slice(-30);
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
            const result = executeCurrentWindow(world);
            world = result.world;
            lastResults = result.results;
            allNews = [...allNews, ...result.news];
            safety++;
          }
          if (allNews.length > 30) allNews = allNews.slice(-30);
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

      resetGame: () => {
        set({ world: null, initialized: false, lastResults: [], lastNews: [], favoriteTeamId: null, favoriteTeamIds: [] });
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
      version: 9,
      /**
       * Migrates a persisted save from any older version up to the current
       * schema (v9). Each `if (version < N)` block applies one forward step.
       *
       * SAFETY CONTRACT:
       * - Input shape is `unknown`. We narrow once to a `Partial<GameStore>`
       *   shape with the relevant `world` / favorite fields exposed. This is
       *   the load-bearing cast — without runtime validation (zod/valibot is
       *   out of scope), an arbitrarily-malformed input could in principle
       *   slip through. In practice persisted state is produced by zustand's
       *   own `partialize` so the top-level keys are stable.
       * - Each migration step backfills missing fields and is idempotent:
       *   running the chain on already-migrated state is a no-op.
       * - The final `as GameStore` is satisfied by the migration steps having
       *   produced every required `world.*` field (or carried the old one
       *   forward); zustand will then merge with current store defaults for
       *   any non-persisted fields.
       *
       * If you bump `version`, append a new `if (version < N)` block that
       * fills in any newly-required fields with sensible defaults.
       */
      migrate: (persistedState: unknown, version: number): GameStore => {
        // SAFETY: zustand persists via `partialize`, so the runtime shape
        // matches `Partial<GameStore>` modulo the historical world fields
        // each migration step touches.
        const state = persistedState as Partial<GameStore> & { world?: GameWorld | null; favoriteTeamId?: string | null; favoriteTeamIds?: string[] };
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
        // v3 → v4: migrate favoriteTeamId → favoriteTeamIds
        if (version < 4) {
          if (!Array.isArray(state.favoriteTeamIds)) {
            state.favoriteTeamIds = state.favoriteTeamId ? [state.favoriteTeamId] : [];
          }
        }
        // v4 → v5: ensure memorableMatches exists
        if (version < 5 && state?.world) {
          if (!Array.isArray(state.world.memorableMatches)) state.world.memorableMatches = [];
        }
        // v5 → v6: backfill marketValue + age for existing players
        if (version < 6 && state?.world?.squads) {
          for (const squad of Object.values(state.world.squads)) {
            if (!Array.isArray(squad)) continue;
            for (const p of squad) {
              if (typeof p.age !== 'number') {
                // Random age 19-32, biased toward 24-28
                p.age = 19 + Math.floor(Math.random() * 14);
              }
              if (typeof p.marketValue !== 'number') {
                p.marketValue = computeInitialMarketValue(p);
              }
            }
          }
        }
        // v6 → v7: drop teamStates[*].currentCoachId — coachStates[*].currentTeamId
        // is now the single source of truth for coach assignments. Old saves
        // already maintain coachStates.currentTeamId in lockstep with the
        // removed teamState field, so we just need to delete the redundant
        // copy. Use bracket-delete with a typed-any to avoid leaking the
        // dead field into the current TeamState surface.
        if (version < 7 && state?.world?.teamStates) {
          for (const ts of Object.values(state.world.teamStates)) {
            if (ts && typeof ts === 'object' && 'currentCoachId' in ts) {
              delete (ts as { currentCoachId?: string | null }).currentCoachId;
            }
          }
        }
        // v7 → v8: assign each player a stable `uuid` and rewrite every
        // foreign-key reference (playerStats keys, awards.playerId,
        // transferHistory.playerId, MatchEvent.playerId in stored
        // calendar/memorable results) so they hold the new uuid value.
        // Without this step, a v7 save loaded by v8 code would key
        // playerStats by the old "${teamId}-${number}" string while new
        // engine reads expect a uuid → all stats would silently drop.
        //
        // Strategy: build an oldId → uuid map from squads, mutate Player
        // objects in place to add `uuid` and drop the legacy `id` field,
        // then walk every foreign-key holder and substitute. The pass is
        // O(players + stats + awards + transfers + storedEvents) which is
        // roughly hundreds of items per save — fine for a one-shot
        // migration. The calendar/memorable walks feel heavy because
        // events are nested 3 levels deep, but they're necessary: any
        // playerId left as a legacy string would render as a dead link
        // in PlayerDetail (the player can't be located by uuid).
        if (version < 8 && state?.world?.squads) {
          // ── Type narrowing for the legacy persisted shape ──
          // Pre-v8 Player had `id` (no `uuid`). We treat it as an opaque
          // record with both possibly-present so we can read `id` and
          // write `uuid` without a hard cast. Casts go via `unknown` since
          // the current Player type and the legacy one don't overlap by
          // structural typing alone.
          type LegacyPlayer = {
            id?: string;
            uuid?: string;
            teamId?: string;
            number?: number;
          };
          const idMap = new Map<string, string>();
          let counter = 0;
          for (const squad of Object.values(state.world.squads)) {
            if (!Array.isArray(squad)) continue;
            for (const raw of squad) {
              const p = raw as unknown as LegacyPlayer;
              const oldId = typeof p.id === 'string'
                ? p.id
                : (typeof p.teamId === 'string' && typeof p.number === 'number'
                  ? `${p.teamId}-${p.number}`
                  : null);
              const uuid = `p-${counter++}`;
              p.uuid = uuid;
              if (oldId !== null) idMap.set(oldId, uuid);
              // Drop the legacy id field — new engine code never reads it.
              if ('id' in p) delete p.id;
            }
          }
          (state.world as { nextPlayerUuidCounter?: number }).nextPlayerUuidCounter = counter;

          // Rewrite playerStats: keys AND playerId values. We rebuild the
          // record from scratch instead of mutating in place so any newly-
          // unreachable key (player not in squads anymore) is dropped.
          if (state.world.playerStats && typeof state.world.playerStats === 'object') {
            type LegacyStat = { playerId?: string; teamId?: string; goals?: number; assists?: number; yellowCards?: number; redCards?: number; appearances?: number };
            const oldStats = state.world.playerStats as unknown as Record<string, LegacyStat>;
            const newStats: Record<string, LegacyStat> = {};
            for (const [oldKey, stat] of Object.entries(oldStats)) {
              const uuid = idMap.get(oldKey) ?? (typeof stat?.playerId === 'string' ? idMap.get(stat.playerId) : undefined);
              if (!uuid) continue; // orphaned stat — drop it
              newStats[uuid] = { ...stat, playerId: uuid };
            }
            (state.world as unknown as { playerStats: Record<string, LegacyStat> }).playerStats = newStats;
          }

          // Rewrite awards
          if (Array.isArray(state.world.playerAwardsHistory)) {
            for (const a of state.world.playerAwardsHistory as { playerId?: string }[]) {
              if (typeof a?.playerId === 'string') {
                const uuid = idMap.get(a.playerId);
                if (uuid) a.playerId = uuid;
              }
            }
          }

          // Rewrite transferHistory
          if (Array.isArray(state.world.transferHistory)) {
            for (const t of state.world.transferHistory as { playerId?: string }[]) {
              if (typeof t?.playerId === 'string') {
                const uuid = idMap.get(t.playerId);
                if (uuid) t.playerId = uuid;
              }
            }
          }

          // Rewrite MatchEvent.playerId in calendar.completed.results — these
          // are the only stored events outside of memorableMatches.
          const cal = state.world.seasonState?.calendar;
          if (Array.isArray(cal)) {
            for (const w of cal) {
              if (!w?.results || !Array.isArray(w.results)) continue;
              for (const r of w.results) {
                if (!Array.isArray(r?.events)) continue;
                for (const e of r.events as { playerId?: string }[]) {
                  if (typeof e?.playerId === 'string') {
                    const uuid = idMap.get(e.playerId);
                    if (uuid) e.playerId = uuid;
                  }
                }
              }
            }
          }

          // memorableMatches[*].result.events
          if (Array.isArray(state.world.memorableMatches)) {
            for (const m of state.world.memorableMatches as { result?: { events?: { playerId?: string }[] } }[]) {
              const events = m?.result?.events;
              if (!Array.isArray(events)) continue;
              for (const e of events) {
                if (typeof e?.playerId === 'string') {
                  const uuid = idMap.get(e.playerId);
                  if (uuid) e.playerId = uuid;
                }
              }
            }
          }
        }
        // v8 → v9: backfill stale playerId references in transferHistory and
        // playerAwardsHistory. The v8 migration only rewrote ids that matched
        // the player's CURRENT `${teamId}-${number}` shape — historical entries
        // produced before a transfer kept the player's *former* legacy id
        // (e.g. a 3-season-old "jeonbuk-75" that now points nowhere because
        // the player moved to bj_guoan). Those references currently render as
        // dead links ("未找到球员: jeonbuk-75") in /transfers and SeasonReview.
        //
        // Logic lives in a top-level helper so the unit test in
        // `game-store-migration.test.ts` can exercise it without standing up
        // zustand + localStorage. Extraction is otherwise a no-op.
        if (version < 9 && state?.world) {
          backfillStaleHistoryPlayerIds(state.world);
        }
        // SAFETY: by this point all migration steps above have backfilled the
        // fields required by current GameStore; non-persisted fields (action
        // closures) are merged in by zustand at runtime.
        return state as GameStore;
      },
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

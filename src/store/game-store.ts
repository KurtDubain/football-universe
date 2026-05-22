import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { compressedStorage } from './compressed-storage';
import { GameWorld, NewsItem, initializeGameWorld, executeCurrentWindow, getCurrentWindow, isSeasonFullyComplete, initializeNewSeason } from '../engine/season/season-manager';
import { applyOfferTransfer, applyOutgoingBid, signFreeAgent, autoResolveRemaining } from './transfer-window-actions';
import { processCoachFiring } from '../engine/coaches/coach-hiring';
import { getTeamCoachId } from '../engine/coaches/coach-lookup';
import { SeededRNG } from '../engine/match/rng';
import { CalendarWindow } from '../types/season';
import { MatchResult } from '../types/match';
import { rollTagForUuid } from '../engine/players/tags';
import type { Achievement } from '../engine/achievements';
import { pickPlayerName } from '../config/player-names';
import { computeInitialMarketValue } from '../engine/economy/market-value';
import { initTeamFinances } from '../engine/economy/finance';
import { computeCurrentRating } from '../engine/players/development';

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

/**
 * v9 → v10 migration: introduce `peakRating` + `peakAge` and recompute
 * `rating` from the development curve. Half-compresses ages over 33 so
 * legacy saves with bloated ages (some players hit 49 in v9) settle into
 * a plausible band — old age 41 → new age 37; old 49 → new 41.
 *
 * Idempotent: running it twice on the same world is a no-op (the second
 * pass sees `peakRating` already set and skips). Exported so the migration
 * test file can exercise it without standing up zustand + localStorage,
 * and so the same logic can be invoked from any future re-migration script.
 *
 * Mutates `world.squads` in place; returns counts of touched / skipped
 * players for diagnostics.
 */
export function applyV9ToV10PlayerCurve(world: {
  squads?: Record<string, Array<{
    uuid?: string;
    age?: number;
    rating?: number;
    peakRating?: number;
    peakAge?: number;
    marketValue?: number;
    teamId?: string;
    name?: string;
    number?: number;
    position?: import('../types/player').PlayerPosition;
    goalScoring?: number;
  }>>;
}): { touched: number; skipped: number } {
  let touched = 0;
  let skipped = 0;
  for (const squad of Object.values(world.squads ?? {})) {
    if (!Array.isArray(squad)) continue;
    for (const p of squad) {
      // Idempotency guard: previous pass already set BOTH peakRating + peakAge.
      // (Stricter than just peakRating — a half-migrated save where peakRating
      //  exists but peakAge doesn't would skip in the old version and stay
      //  broken; this version fixes it through.)
      if (typeof p.peakRating === 'number' && typeof p.peakAge === 'number') {
        skipped++;
        continue;
      }
      // Half-compress ages over 33 — old saves drifted ages up unbounded
      // (no retirement system existed pre-v10). 41 → 37, 49 → 41.
      const oldAge = typeof p.age === 'number' ? p.age : 28;
      const newAge = oldAge > 33 ? 33 + Math.floor((oldAge - 33) * 0.5) : oldAge;
      p.age = newAge;
      // peakRating = current rating (their destined ceiling, frozen now).
      // For a 35-year-old that's actually their *post-decline* rating — but
      // the alternative (estimating peak from a forgotten age curve) is
      // strictly worse. The migration treats `rating-at-time-of-v10` as
      // the canonical peak, and the curve flows forward from here.
      const currentRating = typeof p.rating === 'number' ? p.rating : 60;
      p.peakRating = currentRating;
      // peakAge — derived deterministically from uuid so the same save loaded
      // twice (or shared between two browsers) produces identical peak ages.
      // Range is [24, 29] to match generator output; we hash with the same
      // 31-multiplier + abs trick used elsewhere in the migration code.
      let hash = 0;
      const uuid = typeof p.uuid === 'string' ? p.uuid : '';
      for (const ch of uuid) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
      p.peakAge = 24 + Math.abs(hash) % 6;
      // Recompute current rating with the new curve. Reuses the canonical
      // implementation in development.ts so the migration and runtime stay
      // in lockstep — no chance of curve drift between the two paths.
      p.rating = computeCurrentRating(p.peakRating, newAge, p.peakAge);
      // Recompute marketValue from scratch — the old value was derived from
      // (peakRating, oldAge, oldAgeMul). After age compression, the new
      // (peakRating, newAge, newAgeMul) gives a different bracket multiplier,
      // and applyAnnualRevaluation only relatively adjusts (mul * newAgeMul/oldAgeMul)
      // so the staleness never self-corrects. Reset from canonical formula.
      p.marketValue = computeInitialMarketValue(p as import('../types/player').Player);
      touched++;
    }
  }
  return { touched, skipped };
}

/**
 * v10 → v11 helper: backfill the retirement / coach-candidate-pool fields
 * introduced in Phase A2. Older saves had no retirement system, so these
 * arrays simply start empty — there's no "salvage" path needed; the next
 * season-end will populate them organically.
 *
 * Idempotent: if either field is already present and an array, it's left
 * alone. Mutates `world` in place; returns the count of fields touched
 * (so the unit test can assert the migration ran).
 */
export function applyV10ToV11RetirementInit(world: {
  retirementHistory?: unknown;
  coachCandidatePool?: unknown;
}): { touched: number } {
  let touched = 0;
  if (!Array.isArray(world.retirementHistory)) {
    world.retirementHistory = [];
    touched++;
  }
  if (!Array.isArray(world.coachCandidatePool)) {
    world.coachCandidatePool = [];
    touched++;
  }
  return { touched };
}

/**
 * v11 → v12 helper: backfill `age` on every CoachBase, plus the new
 * `coachRetirementHistory` + `nextCoachIdCounter` fields introduced in
 * Phase B (coach lifecycle).
 *
 * Age is derived deterministically from `coach.id` via the same
 * 31-multiplier hash used in `applyV9ToV10PlayerCurve` so the same save
 * loaded twice produces identical ages. Range is [35, 65] — younger
 * candidates (35-40) join the future-prospect band; older ones (60+)
 * become near-term retirement candidates. The hard age cap is 72.
 *
 * Idempotent: if `age` is already a number on a coach, it's left alone.
 * Mutates `world` in place; returns counts of touched fields and coaches.
 */
export function applyV11ToV12CoachAge(world: {
  coachBases?: Record<string, { id?: string; age?: number }> | unknown;
  coachRetirementHistory?: unknown;
  nextCoachIdCounter?: unknown;
}): { coachesTouched: number; fieldsTouched: number } {
  let coachesTouched = 0;
  let fieldsTouched = 0;

  if (world.coachBases && typeof world.coachBases === 'object') {
    const cb = world.coachBases as Record<string, { id?: string; age?: number }>;
    for (const coach of Object.values(cb)) {
      if (!coach || typeof coach !== 'object') continue;
      if (typeof coach.age === 'number') continue;
      // Hash the id (or fall back to a stable string for malformed entries
      // — they get a single deterministic age, but they were broken anyway).
      const idStr = typeof coach.id === 'string' ? coach.id : 'coach-?';
      let h = 0;
      for (const ch of idStr) h = (h * 31 + ch.charCodeAt(0)) | 0;
      coach.age = 35 + Math.abs(h) % 31; // [35, 65]
      coachesTouched++;
    }
  }
  if (!Array.isArray(world.coachRetirementHistory)) {
    world.coachRetirementHistory = [];
    fieldsTouched++;
  }
  if (typeof world.nextCoachIdCounter !== 'number') {
    world.nextCoachIdCounter = 0;
    fieldsTouched++;
  }
  return { coachesTouched, fieldsTouched };
}

/**
 * v12 → v13 helper: backfill `continentalCups` (Phase C). Older saves had no
 * concept of continental cups; we default the slot to all-null on load.
 *
 * Idempotent: if `continentalCups` is already an object with the three
 * region keys present, leaves it alone. Otherwise installs the empty default.
 *
 * Mutates `world` in place; returns whether the field was touched (so the
 * unit test or a manual audit can confirm the migration ran).
 */
export function applyV12ToV13ContinentalCupsInit(world: {
  continentalCups?: unknown;
}): { touched: boolean } {
  const cc = world.continentalCups;
  if (
    cc && typeof cc === 'object' && !Array.isArray(cc)
    && 'mainland_cup' in cc && 'southern_cup' in cc && 'eastern_cup' in cc
  ) {
    return { touched: false };
  }
  world.continentalCups = { mainland_cup: null, southern_cup: null, eastern_cup: null };
  return { touched: true };
}

/**
 * v13 → v14 helper: backfill `world.totalElapsedWindows` (Phase G — injuries
 * + suspensions). The counter is monotonic across seasons and is used to
 * express injury/suspension durations as absolute window indices. For a
 * legacy save we approximate by summing the lengths of all completed
 * calendars — a perfect estimate is impossible (we don't snapshot historical
 * calendar lengths), so we use the current season's index as a lower bound.
 *
 * Idempotent: skipped when the field is already a number.
 *
 * Returns whether the field was touched.
 */
export function applyV13ToV14InjuriesInit(world: {
  totalElapsedWindows?: unknown;
  seasonState?: { currentWindowIndex?: number; calendar?: unknown[] };
}): { touched: boolean } {
  if (typeof world.totalElapsedWindows === 'number') {
    return { touched: false };
  }
  const cur = world.seasonState?.currentWindowIndex;
  world.totalElapsedWindows = typeof cur === 'number' ? cur : 0;
  return { touched: true };
}

/**
 * v14 → v15 helper: backfill `world.teamFinances` (Phase H — economy).
 * Older saves had no concept of finances; we seed each team with starting
 * cash from its reputation tier (€20M-€150M) and an empty history.
 *
 * Idempotent: if `teamFinances` is already a non-empty record, leave it
 * alone. Mutates `world` in place; returns whether the field was touched.
 *
 * Note: the import on `initTeamFinances` lives at the top of this file
 * (not inline) because zustand's persist middleware loads modules eagerly.
 */
export function applyV14ToV15FinanceInit(world: {
  teamFinances?: unknown;
  teamBases?: Record<string, { id?: string; reputation?: number }>;
}): { touched: boolean; teamsInitialized: number } {
  if (
    world.teamFinances && typeof world.teamFinances === 'object'
    && !Array.isArray(world.teamFinances)
    && Object.keys(world.teamFinances as Record<string, unknown>).length > 0
  ) {
    return { touched: false, teamsInitialized: 0 };
  }
  const bases = (world.teamBases ?? {}) as Record<string, import('../types/team').TeamBase>;
  const finances = initTeamFinances(bases);
  world.teamFinances = finances;
  return { touched: true, teamsInitialized: Object.keys(finances).length };
}

/**
 * v15 → v16: Heal legacy economy debt.
 *
 * The v15 economy used a flat 33% salary rate against ALL of squadValue,
 * which silently bled big-rep clubs (€500M+ squad → €165M wages on €100M
 * income). v16 (this version's runtime) adds league-level wage caps that
 * make fresh-game economies stable.
 *
 * But existing v15 saves accumulated heavy debt under the buggy
 * calculation. On first load they would mass-trigger fire sales — the
 * exact behavior we just fixed for fresh games. Heal pass:
 *
 *   For each team with cash < 0:
 *     - reset cash to startingCashForRep tier (€20M-€150M)
 *     - DO NOT touch finance history (preserve audit trail)
 *
 * Idempotent: a v16-clean save (cash always ≥ 0) is unchanged. Replays of
 * the same migration on the same save also no-op.
 */
export function applyV15ToV16HealLegacyDebt(world: {
  teamFinances?: Record<string, { cash: number }>;
  teamBases?: Record<string, { id?: string; reputation?: number }>;
}): { touched: boolean; teamsHealed: number } {
  const fins = world.teamFinances;
  const bases = world.teamBases;
  if (!fins || !bases) return { touched: false, teamsHealed: 0 };
  let healed = 0;
  for (const [tid, fin] of Object.entries(fins)) {
    if (fin.cash < 0) {
      const rep = bases[tid]?.reputation ?? 60;
      const tier = rep >= 85 ? 150 : rep >= 75 ? 80 : rep >= 65 ? 40 : 20;
      fin.cash = tier;
      healed++;
    }
  }
  return { touched: healed > 0, teamsHealed: healed };
}

/**
 * v16 → v17: Player tag assignment + free agent pool init.
 *
 * Assigns a personality tag (loyal / ambitious / iron / glass / none) to
 * every existing player based on a deterministic uuid hash. Same uuid →
 * same tag across reloads. Also initializes `world.freeAgentPool = []`
 * so the persistent pool engine has a place to start.
 *
 * Idempotent — running twice on a v17+ save no-ops because the function
 * only sets `tag` on players that don't have one yet, and only sets
 * `freeAgentPool` if missing.
 */
export function applyV16ToV17TagsAndPool(world: {
  squads?: Record<string, Array<{ uuid?: string; tag?: string }>>;
  freeAgentPool?: unknown;
}): { touched: boolean; playersTagged: number; poolInitialized: boolean } {
  let tagged = 0;
  if (world.squads) {
    for (const sq of Object.values(world.squads)) {
      for (const p of sq) {
        if (p.tag !== undefined) continue;
        if (!p.uuid) continue;
        const t = rollTagForUuid(p.uuid);
        if (t) {
          p.tag = t;
          tagged++;
        }
      }
    }
  }
  let poolInitialized = false;
  if (!Array.isArray(world.freeAgentPool)) {
    world.freeAgentPool = [];
    poolInitialized = true;
  }
  return { touched: tagged > 0 || poolInitialized, playersTagged: tagged, poolInitialized };
}

/**
 * v17 → v18: Init `world.transferRumors = []`. Pure backfill.
 * Idempotent — skips if already set.
 */
export function applyV17ToV18RumorsInit(world: {
  transferRumors?: unknown;
}): { touched: boolean } {
  if (Array.isArray(world.transferRumors)) return { touched: false };
  world.transferRumors = [];
  return { touched: true };
}

/**
 * v18 → v19: Init `world.playerStatsHistory = {}`. Pure backfill.
 * No prior data to reconstruct — history starts populating from the
 * next season-end forward.
 */
export function applyV18ToV19StatsHistoryInit(world: {
  playerStatsHistory?: unknown;
}): { touched: boolean } {
  if (world.playerStatsHistory && typeof world.playerStatsHistory === 'object' && !Array.isArray(world.playerStatsHistory)) {
    return { touched: false };
  }
  world.playerStatsHistory = {};
  return { touched: true };
}

/**
 * v19 → v20: Init `world.transferWindow = null`. Pure backfill.
 */
export function applyV19ToV20WindowInit(world: {
  transferWindow?: unknown;
}): { touched: boolean } {
  if (world.transferWindow === null || world.transferWindow === undefined) {
    world.transferWindow = null;
    return { touched: true };
  }
  return { touched: false };
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
            const result = executeCurrentWindow(world, { favoriteTeamIds: get().favoriteTeamIds });
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
            const result = executeCurrentWindow(world, { favoriteTeamIds: get().favoriteTeamIds });
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
        const rng = new SeededRNG(world.rngState ^ Date.now());
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
        const rng = new SeededRNG(world.rngState ^ Date.now());
        const meetsAsk = fee >= target.suggestedFee * 0.9;
        const accepted = meetsAsk || rng.next() < 0.4;
        if (accepted) {
          const newWorld = applyOutgoingBid(world, target, fee);
          const updatedTargets = tw.outgoingTargets.map(t => t.id === targetId
            ? { ...t, bidFee: fee, resolution: 'bid_accepted' as const }
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
        // Clear window + advance to next season
        const cleared = { ...world, transferWindow: null };
        const initialized = initializeNewSeason(cleared);
        set({ world: initialized, advanceTick: get().advanceTick + 1 });
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
      version: 20,
      // [D] — wrap localStorage with LZ-string compression. ~4-6× size
      // reduction (1MB raw → ~200KB on disk), giving comfortable
      // headroom under the 5MB quota for 50-100 seasons. Auto-detects
      // legacy uncompressed saves (no migration step).
      storage: createJSONStorage(() => compressedStorage),
      /**
       * Migrates a persisted save from any older version up to the current
       * schema (v10). Each `if (version < N)` block applies one forward step.
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
        // v9 → v10: introduce peakRating + peakAge per player and recompute
        // each player's `rating` from the development curve in
        // engine/players/development.ts. Also half-compresses ages over 33
        // because pre-v10 saves had no retirement system and let some
        // players drift up to ~49 — we want them slotted into a plausible
        // band so the new curve produces sane numbers.
        //
        // Helper extracted to `applyV9ToV10PlayerCurve` (top of this file)
        // so the migration test can exercise it directly.
        if (version < 10 && state?.world) {
          applyV9ToV10PlayerCurve(state.world);
        }
        // v10 → v11: backfill retirementHistory + coachCandidatePool. Older
        // saves had no retirement system, so these arrays start empty and
        // fill organically from the next season-end. Helper extracted so
        // the migration test can exercise it directly.
        if (version < 11 && state?.world) {
          applyV10ToV11RetirementInit(state.world as { retirementHistory?: unknown; coachCandidatePool?: unknown });
        }
        // v11 → v12: backfill `age` on every CoachBase, plus the new
        // coachRetirementHistory + nextCoachIdCounter fields. Coach age is
        // derived from id-hash (deterministic) — no other reasonable
        // backfill exists since pre-v12 saves never tracked it. Helper
        // extracted so the migration test can exercise it directly.
        if (version < 12 && state?.world) {
          applyV11ToV12CoachAge(state.world as { coachBases?: unknown; coachRetirementHistory?: unknown; nextCoachIdCounter?: unknown });
        }
        // v12 → v13: backfill `continentalCups` (Phase C). Older saves had
        // no concept of continental cups; we install the empty default on
        // load. Helper extracted so the migration test can exercise it
        // directly.
        if (version < 13 && state?.world) {
          applyV12ToV13ContinentalCupsInit(state.world as { continentalCups?: unknown });
        }
        // v13 → v14: backfill `totalElapsedWindows` (Phase G). Older saves
        // never tracked a global window counter — we seed it from the
        // season's current window so future post-match injury rolls have a
        // monotonic clock to write `untilWindow` against.
        if (version < 14 && state?.world) {
          applyV13ToV14InjuriesInit(
            state.world as { totalElapsedWindows?: unknown; seasonState?: { currentWindowIndex?: number; calendar?: unknown[] } },
          );
        }
        // v14 → v15: backfill `teamFinances` (Phase H — economy). Older saves
        // had no concept of cash / salaries / prize money. Each team is
        // seeded based on its reputation tier (€20M-€150M starting cash);
        // history is empty until the next season-end populates it.
        if (version < 15 && state?.world) {
          applyV14ToV15FinanceInit(
            state.world as { teamFinances?: unknown; teamBases?: Record<string, import('../types/team').TeamBase> },
          );
        }
        // v15 → v16: Heal accumulated debt from the buggy v15 economy
        // (flat 33% salary, no league wage cap). Teams with cash < 0 are
        // reset to their tier's starting balance so they don't mass-trigger
        // fire sales on first load with v16 code.
        if (version < 16 && state?.world) {
          applyV15ToV16HealLegacyDebt(
            state.world as {
              teamFinances?: Record<string, { cash: number }>;
              teamBases?: Record<string, { id?: string; reputation?: number }>;
            },
          );
        }
        // v16 → v17: assign personality tags to existing players +
        // initialize the persistent free agent pool. Tags are
        // deterministic (uuid hash), so applying this twice is a no-op.
        if (version < 17 && state?.world) {
          applyV16ToV17TagsAndPool(
            state.world as {
              squads?: Record<string, Array<{ uuid?: string; tag?: string }>>;
              freeAgentPool?: unknown;
            },
          );
        }
        // v17 → v18: init the (transient) transferRumors array.
        if (version < 18 && state?.world) {
          applyV17ToV18RumorsInit(state.world as { transferRumors?: unknown });
        }
        // v18 → v19: init playerStatsHistory (per-player per-season
        // snapshots). Empty backfill — historical data isn't available
        // for migration; new history accumulates from next season end.
        if (version < 19 && state?.world) {
          applyV18ToV19StatsHistoryInit(state.world as { playerStatsHistory?: unknown });
        }
        // v19 → v20: init `transferWindow = null`. Window only spins up
        // at season-end for favorite teams; default-closed.
        if (version < 20 && state?.world) {
          applyV19ToV20WindowInit(state.world as { transferWindow?: unknown });
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


// Dev-only: expose store on window for audit/playwright scripts.
// Production builds tree-shake `import.meta.env.DEV` away.
if (import.meta.env?.DEV && typeof window !== "undefined") {
  (window as unknown as { __gameStore?: typeof useGameStore }).__gameStore = useGameStore;
}

import { SeasonState, CalendarWindow } from '../../types/season';
import { TeamBase, TeamState, Trophy, SeasonRecord } from '../../types/team';
import { CoachBase, CoachState, CareerEntry } from '../../types/coach';
import { StandingEntry } from '../../types/league';
import { CupState, SuperCupState, WorldCupState, ContinentalCupState, CupRegion } from '../../types/cup';
import { MatchResult, MatchFixture } from '../../types/match';
import { HonorRecord } from '../../types/honor';
import { Player, PlayerSeasonStats, PlayerRetirement } from '../../types/player';
import { CoachCandidate, CoachRetirement } from '../../types/coach';
import { Achievement } from '../achievements';
import { SeededRNG } from '../match/rng';
import { generateLeagueFixtures } from '../standings/fixtures';
import { createInitialStandings } from '../standings/standings';
import { determinePromotionRelegation } from '../standings/promotion-relegation';
import { initLeagueCup, getLeagueCupCurrentFixtures } from '../cups/league-cup';
import { initSuperCup, getSuperCupGroupFixtures } from '../cups/super-cup';
import { initContinentalCup } from '../cups/continental-cup';
import { generateAllSquads } from '../players/generator';
import { createInitialPlayerStats, updatePlayerStatsFromResults } from '../players/stats';
import { buildSeasonCalendar, CalendarBuildInput } from './calendar-builder';
import { getTeamIdsByLeague, getAllTeamIds } from './helpers';
import { defaultTeams, createInitialTeamStates } from '../../config/teams';
import { defaultCoaches, defaultCoachAssignments, createInitialCoachStates } from '../../config/coaches';
import { leagueConfigs, superCupConfig } from '../../config/competitions';
import { BALANCE } from '../../config/balance';
import { getGameModeConfig, type GameMode } from '../../types/game-mode';
import { dispatchWindow } from './window-handlers';
import { runPostMatchProcessing } from './post-match';
import { handleSeasonEnd, finalizeWorldCup } from './season-end';
import { enforceStorageLimits } from './storage-limits';
import { buildTeamCoachMap } from '../coaches/coach-lookup';
import { processInjuriesAndSuspensions, resetDisciplineForNewSeason } from '../players/injuries';
import { initTeamFinances } from '../economy/finance';

// ── Public interfaces ────────────────────────────────────────────

export interface NewsItem {
  id: string;
  seasonNumber: number;
  windowIndex: number;
  type: 'match_result' | 'coach_fired' | 'coach_hired' | 'promotion' | 'relegation' | 'trophy' | 'upset' | 'streak' | 'retirement' | 'injury' | 'prize_money' | 'fire_sale';
  title: string;
  description: string;
}

/**
 * GameWorld is treated as IMMUTABLE throughout engine functions.
 * Engine functions take a world, return a new world. They never mutate
 * the input. This is required for React/zustand reactivity and for
 * predictable testing. If you need to update a field, build a patch
 * and return `{ ...world, ...patch }`.
 *
 * For nested records (e.g. `coachCareers[coachId] = entries`), build a
 * fresh record once at the top of the function — `const coachCareers =
 * { ...world.coachCareers }` — then write to that local. Never write
 * to `world.coachCareers[id]` directly: that mutates the input.
 *
 * Some siblings (`post-match.ts`, `window-handlers.ts`) accept fresh
 * copies of world fields as PARAMETERS and mutate those locally — that
 * is acceptable because the caller is expected to pass copies (and to
 * propagate the returned references back into the new world).
 */
export interface GameWorld {
  seasonState: SeasonState;
  teamBases: Record<string, TeamBase>;
  teamStates: Record<string, TeamState>;
  coachBases: Record<string, CoachBase>;
  coachStates: Record<string, CoachState>;
  coachCareers: Record<string, CareerEntry[]>;
  league1Standings: StandingEntry[];
  league2Standings: StandingEntry[];
  league3Standings: StandingEntry[];
  leagueCup: CupState;
  superCup: SuperCupState;
  worldCup: WorldCupState | null;
  /**
   * Continental cups (Phase C). Populated only in odd seasons (S % 2 === 1)
   * after `initializeNewSeason`; null in even seasons. Each region's cup is
   * independent — disjoint team rosters mean all three can play on the same
   * continental_cup window without conflict.
   *
   * Initialised by `initializeNewSeason` to `{ mainland_cup: null,
   * southern_cup: null, eastern_cup: null }` in even seasons; in odd seasons
   * each entry is replaced with a `ContinentalCupState`.
   *
   * Trophies are attributed via the `mainland_cup` / `southern_cup` /
   * `eastern_cup` Trophy types — see `season-end.ts` for the attribution pass.
   */
  continentalCups: {
    mainland_cup: ContinentalCupState | null;
    southern_cup: ContinentalCupState | null;
    eastern_cup: ContinentalCupState | null;
  };
  honorHistory: HonorRecord[];
  teamTrophies: Record<string, Trophy[]>;
  coachTrophies: Record<string, Trophy[]>;
  teamSeasonRecords: Record<string, SeasonRecord[]>;
  coachChangesThisSeason: { teamId: string; oldCoachId: string; newCoachId: string; reason: string }[];
  squads: Record<string, Player[]>;
  playerStats: Record<string, PlayerSeasonStats>;
  /**
   * Monotonic counter for assigning new Player.uuid values. Persisted on the
   * world so future generator calls (e.g. youth promotions) can keep handing
   * out unique uuids without colliding with existing ones. Bumped by the
   * v8 migration so legacy saves get a sane starting point too.
   */
  nextPlayerUuidCounter: number;
  /**
   * Append-only history of retirements. Capped at the last 300 entries by
   * the season-end pipeline (see `engine/players/retirement.ts`). Introduced
   * in v11; the v10 → v11 migration backfills it as `[]` on legacy saves.
   */
  retirementHistory: PlayerRetirement[];
  /**
   * v17 — persistent free agent pool. Released players (downstream of a
   * poach) live here until some non-elite team signs them in a future
   * season's transfer window. Capped at 40 — overflow retires the oldest
   * (kept sorted oldest-first by age, the same direction the FIFO read).
   */
  freeAgentPool: Player[];
  /**
   * FIFO pool of recently-retired stars eligible to become future coaches.
   * Capped at 12 entries (oldest evicted on overflow). A3 will consume from
   * here when assembling new coaches; A2 only seeds the pool. Introduced in
   * v11; the v10 → v11 migration backfills it as `[]` on legacy saves.
   */
  coachCandidatePool: CoachCandidate[];
  /**
   * Append-only history of coach retirements. Capped at the last 200 entries
   * by the season-end pipeline (see `engine/coaches/coach-retirement.ts`).
   * Introduced in v12; the v11 → v12 migration backfills it as `[]` on
   * legacy saves.
   */
  coachRetirementHistory: CoachRetirement[];
  /**
   * Monotonic counter for assigning new fresh-coach ids (`c-fresh-{N}`).
   * Bumped each time the replacement engine generates a non-pool coach so
   * ids never collide with existing entries in `world.coachBases`.
   * Introduced in v12.
   */
  nextCoachIdCounter: number;
  activeEvents: import('../events').SeasonEvent[];
  achievements: Achievement[];
  newsLog: NewsItem[];
  seed: number;
  rngState: number;
  seasonStartLevels: Record<string, 1 | 2 | 3>;
  seasonBuffs: SeasonBuff[];
  prediction?: { champion: string; relegated: string; settled?: boolean; correctCount?: number };
  godHandUsed: boolean;
  coins: number;
  bets: { fixtureId: string; outcome: 'home' | 'draw' | 'away'; amount: number; odds: number }[];
  matchHistory: MatchHistoryEntry[];
  seasonBuffsHistory: { season: number; buffs: SeasonBuff[] }[];
  playerAwardsHistory: import('../../types/award').PlayerAward[];
  transferHistory: import('../../types/transfer').TransferRecord[];
  memorableMatches: import('../../types/memorable').MemorableMatchEntry[];
  gameMode?: import('../../types/game-mode').GameMode;
  /**
   * Phase G — monotonic counter of how many *match-bearing* calendar windows
   * have been simulated since the world was created. Bumped exactly once per
   * `executeCurrentWindow` call that produces results, BEFORE post-match
   * processing runs (so injury / suspension `untilWindow` values can use it
   * directly). Survives season transitions — that is the whole point: an
   * injury sustained at the end of S17 needs to express its remaining
   * duration in S18 windows. The per-season counter `seasonState.currentWindowIndex`
   * resets on `initializeNewSeason`, so it can't be used for this.
   *
   * Backfilled to 0 by the v13 → v14 migration on legacy saves.
   */
  totalElapsedWindows: number;
  /**
   * Phase H — per-team finances. Initialised by `initializeGameWorld` based on
   * each team's reputation tier (€20M-€150M starting cash). Each entry tracks
   * cash, season-cumulative income / expense, and a FIFO history of the last
   * 10 seasons. Cash CAN go negative — there is no bankruptcy.
   *
   * Backfilled by the v14 → v15 migration on legacy saves.
   */
  teamFinances: Record<string, import('../../types/team').FinanceState>;
}

export interface MatchHistoryEntry {
  season: number;
  homeId: string;
  awayId: string;
  homeGoals: number;
  awayGoals: number;
  comp: string;
  et?: boolean;
  pen?: string;
  /** Snapshot of who was coaching at end of season (best-effort). */
  homeCoachId?: string;
  awayCoachId?: string;
}

export interface SeasonBuff {
  teamId: string;
  type: string;
  label: string;
  description: string;
  effects: { field: import('../events').TeamNumericField; delta: number }[];
}

const MEMORABLE_CAP = 30;
function appendMemorableMatches(
  prev: import('../../types/memorable').MemorableMatchEntry[] | undefined,
  newOnes: import('../../types/memorable').MemorableMatchEntry[],
): import('../../types/memorable').MemorableMatchEntry[] {
  if (!newOnes || newOnes.length === 0) return prev ?? [];
  const combined = [...(prev ?? []), ...newOnes];
  // Keep most recent CAP entries (drop oldest)
  return combined.length > MEMORABLE_CAP ? combined.slice(-MEMORABLE_CAP) : combined;
}
// ── Main public functions ────────────────────────────────────────

/**
 * Initialize a fresh game world from a seed.
 */
export function initializeGameWorld(seed: number, options?: { gameMode?: GameMode; customTeams?: TeamBase[] }): GameWorld {
  // 1. Team bases — apply custom teams or game mode overrides
  const baseTeams = options?.customTeams && options.customTeams.length === 32
    ? options.customTeams
    : defaultTeams;
  const modeConfig = options?.gameMode ? getGameModeConfig(options.gameMode) : null;
  const finalTeams = modeConfig?.applyTeamOverrides ? modeConfig.applyTeamOverrides(baseTeams) : baseTeams;
  const teamBases: Record<string, TeamBase> = {};
  for (const team of finalTeams) {
    teamBases[team.id] = team;
  }

  // 2. Team states
  const teamStates = createInitialTeamStates(finalTeams);

  // 3. Coach bases
  const coachBases: Record<string, CoachBase> = {};
  for (const coach of defaultCoaches) {
    coachBases[coach.id] = coach;
  }

  // 4. Coach states
  const coachStates = createInitialCoachStates(defaultCoaches, defaultCoachAssignments);

  // 5. Apply coach assignments — coachStates is the single source of truth
  //    for who coaches whom, so we only write to that side. Team → coach is
  //    derived via `getTeamCoachId` (see src/engine/coaches/coach-lookup.ts).
  for (const [teamId, coachId] of Object.entries(defaultCoachAssignments)) {
    if (coachStates[coachId]) {
      coachStates[coachId] = { ...coachStates[coachId], currentTeamId: teamId, isUnemployed: false };
    }
  }

  // 6. Initialize coach careers
  const coachCareers: Record<string, CareerEntry[]> = {};
  for (const coach of defaultCoaches) {
    const teamId = coachStates[coach.id].currentTeamId;
    if (teamId) {
      const teamName = teamBases[teamId]?.name ?? teamId;
      coachCareers[coach.id] = [{
        teamId,
        teamName,
        fromSeason: 1,
        toSeason: null,
        fired: false,
        trophies: [],
      }];
    } else {
      coachCareers[coach.id] = [];
    }
  }

  // 7. Create RNG
  const rng = new SeededRNG(seed);

  // 8. Generate squads (permanent, once)
  const { squads, nextPlayerUuidCounter } = generateAllSquads(defaultTeams, seed + 7777);
  const playerStats = createInitialPlayerStats(squads);

  // Build an initial world (partial) so initializeNewSeason can fill it out
  const world: GameWorld = {
    seasonState: undefined!,
    teamBases,
    teamStates,
    coachBases,
    coachStates,
    coachCareers,
    league1Standings: [],
    league2Standings: [],
    league3Standings: [],
    leagueCup: undefined!,
    superCup: undefined!,
    worldCup: null,
    continentalCups: { mainland_cup: null, southern_cup: null, eastern_cup: null },
    honorHistory: [],
    teamTrophies: {},
    coachTrophies: {},
    teamSeasonRecords: {},
    coachChangesThisSeason: [],
    squads,
    playerStats,
    nextPlayerUuidCounter,
    retirementHistory: [],
    freeAgentPool: [],
    coachCandidatePool: [],
    coachRetirementHistory: [],
    nextCoachIdCounter: 0,
    activeEvents: [],
    achievements: [],
    newsLog: [],
    seed,
    rngState: rng.getState(),
    seasonStartLevels: {},
    seasonBuffs: [],
    godHandUsed: false,
    coins: 1000,
    bets: [],
    matchHistory: [],
    seasonBuffsHistory: [],
    playerAwardsHistory: [],
    transferHistory: [],
    memorableMatches: [],
    gameMode: options?.gameMode ?? 'free',
    totalElapsedWindows: 0,
    teamFinances: {},
  };

  // Initialize empty trophies / records for every team
  for (const teamId of Object.keys(teamBases)) {
    world.teamTrophies[teamId] = [];
    world.teamSeasonRecords[teamId] = [];
  }
  for (const coachId of Object.keys(coachBases)) {
    world.coachTrophies[coachId] = [];
  }

  // Phase H — seed starting cash by reputation tier. See finance.ts for
  // tier thresholds and starting amounts.
  world.teamFinances = initTeamFinances(teamBases);

  // 8. Set up season 1
  return initializeNewSeason(world);
}

/**
 * Initialize a new season: generate fixtures, cups, calendar, and standings.
 */
export function initializeNewSeason(world: GameWorld): GameWorld {
  const seasonNumber = world.seasonState?.seasonNumber
    ? world.seasonState.seasonNumber + 1
    : 1;

  const rng = new SeededRNG(world.rngState);

  // Snapshot league levels at season start (used for promotion/relegation detection)
  const seasonStartLevels: Record<string, 1 | 2 | 3> = {};
  for (const teamId of getAllTeamIds(world.teamStates)) {
    seasonStartLevels[teamId] = world.teamStates[teamId].leagueLevel;
  }

  // Team IDs by league level
  const l1Teams = getTeamIdsByLeague(world.teamStates, 1);
  const l2Teams = getTeamIdsByLeague(world.teamStates, 2);
  const l3Teams = getTeamIdsByLeague(world.teamStates, 3);
  const allTeamIds = getAllTeamIds(world.teamStates);

  // Generate league fixtures
  const league1Fixtures = generateLeagueFixtures(l1Teams, 1, seasonNumber, rng.nextInt(0, 999999));
  const league2Fixtures = generateLeagueFixtures(l2Teams, 2, seasonNumber, rng.nextInt(0, 999999));
  const league3Fixtures = generateLeagueFixtures(l3Teams, 3, seasonNumber, rng.nextInt(0, 999999));

  // Initialize league cup with all 32 teams
  const leagueCup = initLeagueCup(allTeamIds, seasonNumber, rng);

  // Determine super cup qualifiers (16 teams)
  let superCupTeams: string[];
  if (seasonNumber === 1) {
    // Season 1: top 10 from L1 by overall, top 4 from L2, top 2 from L3
    const l1Sorted = [...l1Teams].sort(
      (a, b) => (world.teamBases[b]?.overall ?? 0) - (world.teamBases[a]?.overall ?? 0),
    );
    const l2Sorted = [...l2Teams].sort(
      (a, b) => (world.teamBases[b]?.overall ?? 0) - (world.teamBases[a]?.overall ?? 0),
    );
    const l3Sorted = [...l3Teams].sort(
      (a, b) => (world.teamBases[b]?.overall ?? 0) - (world.teamBases[a]?.overall ?? 0),
    );
    superCupTeams = [
      ...l1Sorted.slice(0, superCupConfig.league1Spots),
      ...l2Sorted.slice(0, superCupConfig.league2Spots),
      ...l3Sorted.slice(0, superCupConfig.league3Spots),
    ];
  } else {
    // Later seasons: use last season's final standings
    const l1Top = world.league1Standings.slice(0, superCupConfig.league1Spots).map((s) => s.teamId);
    const l2Top = world.league2Standings.slice(0, superCupConfig.league2Spots).map((s) => s.teamId);
    const l3Top = world.league3Standings.slice(0, superCupConfig.league3Spots).map((s) => s.teamId);
    superCupTeams = [...l1Top, ...l2Top, ...l3Top];
  }

  const superCup = initSuperCup(superCupTeams, seasonNumber, rng, superCupConfig.awayGoalRule);

  // ── Continental cups (Phase C) ──
  // Fire in odd seasons (S1, S3, ..., S17, S19) — never collides with WC
  // (every-4 schedule on even seasons). Each region's eligible roster is
  // filtered by region prefix; the region size determines whether the cup
  // initialises (16 for 大陆, 8 for 南洲 / 东洲). If a region is short of teams
  // (e.g. due to migration edge cases), the cup is skipped silently for that
  // region. We never throw here — schedule integrity > strict count.
  const continentalCups: GameWorld['continentalCups'] = {
    mainland_cup: null,
    southern_cup: null,
    eastern_cup: null,
  };
  const isContinentalCupSeason = seasonNumber % 2 === 1;
  if (isContinentalCupSeason) {
    const teamsByRegion: Record<CupRegion, string[]> = { '大陆': [], '南洲': [], '东洲': [] };
    for (const teamId of allTeamIds) {
      const tb = world.teamBases[teamId];
      const cont = tb?.region?.split('+')[0] as CupRegion | undefined;
      if (cont && cont in teamsByRegion) {
        teamsByRegion[cont].push(teamId);
      }
    }
    // 大陆杯: pick the top 16 by overall (since the continent has > 16 teams).
    if (teamsByRegion['大陆'].length >= 16) {
      const top16 = [...teamsByRegion['大陆']]
        .sort((a, b) => (world.teamBases[b]?.overall ?? 0) - (world.teamBases[a]?.overall ?? 0))
        .slice(0, 16);
      continentalCups.mainland_cup = initContinentalCup('大陆', top16, seasonNumber, rng);
    }
    if (teamsByRegion['南洲'].length >= 8) {
      const top8 = [...teamsByRegion['南洲']]
        .sort((a, b) => (world.teamBases[b]?.overall ?? 0) - (world.teamBases[a]?.overall ?? 0))
        .slice(0, 8);
      continentalCups.southern_cup = initContinentalCup('南洲', top8, seasonNumber, rng);
    }
    if (teamsByRegion['东洲'].length >= 8) {
      const top8 = [...teamsByRegion['东洲']]
        .sort((a, b) => (world.teamBases[b]?.overall ?? 0) - (world.teamBases[a]?.overall ?? 0))
        .slice(0, 8);
      continentalCups.eastern_cup = initContinentalCup('东洲', top8, seasonNumber, rng);
    }
  }

  // Get super cup group fixtures for all 6 rounds
  const superCupGroupRoundFixtures: import('../../types/cup').CupFixture[][] = [];
  for (let r = 1; r <= 6; r++) {
    superCupGroupRoundFixtures.push(getSuperCupGroupFixtures(superCup, r));
  }

  // Get league cup R1 fixtures
  const leagueCupR1Fixtures = getLeagueCupCurrentFixtures(leagueCup);

  // Build season calendar
  const calendarInput: CalendarBuildInput = {
    seasonNumber,
    league1Fixtures,
    league2Fixtures,
    league3Fixtures,
    leagueCupR1Fixtures,
    superCupGroupRoundFixtures,
    includeContinentalCup: isContinentalCupSeason,
  };
  const calendar = buildSeasonCalendar(calendarInput);

  // Create initial standings
  const league1Standings = createInitialStandings(l1Teams);
  const league2Standings = createInitialStandings(l2Teams);
  const league3Standings = createInitialStandings(l3Teams);

  // Check world cup year
  const isWorldCupYear = seasonNumber % BALANCE.WORLD_CUP_INTERVAL === 0;

  const seasonState: SeasonState = {
    seasonNumber,
    currentWindowIndex: 0,
    calendar,
    completed: false,
    isWorldCupYear,
    worldCupPhase: false,
  };

  const rngState = rng.getState();

  // ── Generate draw announcement news ──
  const drawNews: NewsItem[] = [];

  // League cup draw
  drawNews.push({
    id: `draw-lc-S${seasonNumber}`,
    seasonNumber, windowIndex: 0, type: 'match_result',
    title: `联赛杯抽签完成 — 32队单场淘汰`,
    description: `第${seasonNumber}赛季联赛杯抽签揭晓，32支球队将角逐联赛杯冠军。`,
  });

  // Super cup draw — show league composition
  const scL1Count = superCupTeams.filter(id => world.teamStates[id]?.leagueLevel === 1).length;
  const scL2Count = superCupTeams.filter(id => world.teamStates[id]?.leagueLevel === 2).length;
  const scL3Count = superCupTeams.filter(id => world.teamStates[id]?.leagueLevel === 3).length;
  const scGroupInfo = superCup.groups.map(g => `${g.groupName}组: ${g.teamIds.map(id => world.teamBases[id]?.name?.slice(0, 3) ?? id).join('/')}`).join(' | ');
  drawNews.push({
    id: `draw-sc-S${seasonNumber}`,
    seasonNumber, windowIndex: 0, type: 'match_result',
    title: `超级杯分组抽签揭晓 — ${scL1Count}顶${scL2Count}甲${scL3Count}乙`,
    description: scGroupInfo,
  });

  // Continental cups draw (odd seasons only)
  if (isContinentalCupSeason) {
    for (const cup of [continentalCups.mainland_cup, continentalCups.southern_cup, continentalCups.eastern_cup]) {
      if (!cup) continue;
      const fixturePreview = cup.rounds[0].fixtures
        .map(f => `${world.teamBases[f.homeTeamId]?.shortName ?? f.homeTeamId} vs ${world.teamBases[f.awayTeamId]?.shortName ?? f.awayTeamId}`)
        .join('、');
      drawNews.push({
        id: `draw-cc-${cup.type}-S${seasonNumber}`,
        seasonNumber, windowIndex: 0, type: 'match_result',
        title: `${cup.name}抽签揭晓 — ${cup.region}地区${cup.rounds[0].fixtures.length * 2}队角逐`,
        description: `第${seasonNumber}赛季${cup.name}首轮对阵: ${fixturePreview}`,
      });
    }
  }

  // ── Season buffs: reverse old buffs, then apply new ones ──
  let buffedTeamBases = { ...world.teamBases };

  // Reverse previous season's buffs
  for (const oldBuff of (world.seasonBuffs ?? [])) {
    const base = { ...buffedTeamBases[oldBuff.teamId] };
    if (!base) continue;
    for (const eff of oldBuff.effects) {
      base[eff.field] = Math.max(30, Math.min(99, (base[eff.field] ?? 50) - eff.delta));
    }
    buffedTeamBases[oldBuff.teamId] = base;
  }

  // Generate and apply new buffs
  const seasonBuffs = generateSeasonBuffs(allTeamIds, buffedTeamBases, rng);
  const buffNews: NewsItem[] = seasonBuffs.map(buff => ({
    id: `buff-S${seasonNumber}-${buff.type}`,
    seasonNumber, windowIndex: 0, type: 'streak' as const,
    title: `${buffedTeamBases[buff.teamId]?.name} — ${buff.label}`,
    description: buff.description,
  }));

  // Apply new buff effects to team bases
  for (const buff of seasonBuffs) {
    const base = { ...buffedTeamBases[buff.teamId] };
    for (const eff of buff.effects) {
      base[eff.field] = Math.max(30, Math.min(99, (base[eff.field] ?? 50) + eff.delta));
    }
    buffedTeamBases[buff.teamId] = base;
  }

  // Archive current season's match results into matchHistory
  const prevSeason = world.seasonState?.seasonNumber ?? 0;
  const newMatchHistory = [...(world.matchHistory ?? [])];
  if (world.seasonState?.calendar) {
    // Build a teamId → coachId map once for this season's archive pass
    // (cheaper than walking coachStates per result).
    const teamCoachMap = buildTeamCoachMap(world.coachStates);
    for (const w of world.seasonState.calendar) {
      if (!w.completed || !w.results) continue;
      for (const r of w.results) {
        newMatchHistory.push({
          season: prevSeason,
          homeId: r.homeTeamId,
          awayId: r.awayTeamId,
          homeGoals: r.homeGoals + (r.etHomeGoals ?? 0),
          awayGoals: r.awayGoals + (r.etAwayGoals ?? 0),
          comp: r.competitionName,
          et: r.extraTime || undefined,
          pen: r.penalties ? `${r.penaltyHome}-${r.penaltyAway}` : undefined,
          homeCoachId: teamCoachMap.get(r.homeTeamId),
          awayCoachId: teamCoachMap.get(r.awayTeamId),
        });
      }
    }
  }

  // Archive previous season's buffs
  const newBuffsHistory = [...(world.seasonBuffsHistory ?? [])];
  if (prevSeason > 0 && (world.seasonBuffs ?? []).length > 0) {
    newBuffsHistory.push({ season: prevSeason, buffs: world.seasonBuffs ?? [] });
  }

  // Phase G — off-season cleanup. Wipes all suspensions; resets non-long-term
  // injuries. Mutates squads in place (the Player objects are shared across
  // the world snapshot — see note in `processInjuriesAndSuspensions`).
  resetDisciplineForNewSeason(world.squads, world.totalElapsedWindows ?? 0);

  return enforceStorageLimits({
    ...world,
    teamBases: buffedTeamBases,
    seasonState,
    league1Standings,
    league2Standings,
    league3Standings,
    leagueCup,
    superCup,
    worldCup: null,
    continentalCups,
    coachChangesThisSeason: [],
    playerStats: createInitialPlayerStats(world.squads),
    newsLog: [...(world.newsLog ?? []), ...drawNews, ...buffNews],
    rngState,
    seasonStartLevels,
    seasonBuffs,
    prediction: undefined,
    godHandUsed: false,
    matchHistory: newMatchHistory,
    seasonBuffsHistory: newBuffsHistory,
  });
}

const SEASON_BUFF_TEMPLATES: {
  type: string;
  label: string;
  desc: (team: string) => string;
  effects: { field: import('../events').TeamNumericField; delta: number }[];
  positive: boolean;
}[] = [
  {
    type: 'hot_streak', label: '状态火热',
    desc: (t) => `${t}赛季前集训效果显著，全队状态爆棚，攻防两端均有提升。`,
    effects: [{ field: 'attack', delta: 4 }, { field: 'midfield', delta: 3 }, { field: 'stability', delta: 5 }],
    positive: true,
  },
  {
    type: 'cold_spell', label: '状态低迷',
    desc: (t) => `${t}休赛期人心涣散，多名主力表达不满，赛季前景堪忧。`,
    effects: [{ field: 'attack', delta: -3 }, { field: 'stability', delta: -5 }, { field: 'depth', delta: -3 }],
    positive: false,
  },
  {
    type: 'wonderkid', label: '球星诞生',
    desc: (t) => `${t}青训营走出一位天才少年，被誉为未来之星，攻击力大增。`,
    effects: [{ field: 'attack', delta: 6 }, { field: 'reputation', delta: 3 }],
    positive: true,
  },
  {
    type: 'iron_wall', label: '铁血防线',
    desc: (t) => `${t}苦练防守体系，后防线固若金汤，被称为本赛季最难攻破的堡垒。`,
    effects: [{ field: 'defense', delta: 6 }, { field: 'stability', delta: 4 }],
    positive: true,
  },
  {
    type: 'financial_crisis', label: '财务危机',
    desc: (t) => `${t}遭遇资金链断裂，被迫甩卖球员，阵容厚度严重缩水。`,
    effects: [{ field: 'depth', delta: -6 }, { field: 'overall', delta: -2 }],
    positive: false,
  },
  {
    type: 'tactical_revolution', label: '战术革新',
    desc: (t) => `${t}引入全新战术体系，中场控制力和进攻组织焕然一新。`,
    effects: [{ field: 'midfield', delta: 5 }, { field: 'attack', delta: 3 }],
    positive: true,
  },
];

function generateSeasonBuffs(
  teamIds: string[],
  teamBases: Record<string, TeamBase>,
  rng: SeededRNG,
): SeasonBuff[] {
  const shuffled = rng.shuffle([...teamIds]);
  const positiveTemplates = SEASON_BUFF_TEMPLATES.filter(t => t.positive);
  const negativeTemplates = SEASON_BUFF_TEMPLATES.filter(t => !t.positive);

  const buffs: SeasonBuff[] = [];
  const used = new Set<string>();

  // 2 positive + 1 negative
  for (let i = 0; i < 2; i++) {
    const teamId = shuffled.find(id => !used.has(id));
    if (!teamId) break;
    used.add(teamId);
    const template = rng.pick(positiveTemplates);
    buffs.push({
      teamId,
      type: template.type,
      label: template.label,
      description: template.desc(teamBases[teamId]?.name ?? teamId),
      effects: template.effects,
    });
  }
  const negTeamId = shuffled.find(id => !used.has(id));
  if (negTeamId) {
    used.add(negTeamId);
    const template = rng.pick(negativeTemplates);
    buffs.push({
      teamId: negTeamId,
      type: template.type,
      label: template.label,
      description: template.desc(teamBases[negTeamId]?.name ?? negTeamId),
      effects: template.effects,
    });
  }

  return buffs;
}

/**
 * Get the current calendar window, or null if season is complete.
 */
export function getCurrentWindow(world: GameWorld): CalendarWindow | null {
  const { seasonState } = world;
  if (seasonState.completed) return null;
  const { calendar, currentWindowIndex } = seasonState;
  if (currentWindowIndex >= calendar.length) return null;
  return calendar[currentWindowIndex];
}

/**
 * Execute the current calendar window: simulate all matches and update state.
 */
export function executeCurrentWindow(world: GameWorld): {
  world: GameWorld;
  results: MatchResult[];
  news: NewsItem[];
} {
  const window = getCurrentWindow(world);
  if (!window) {
    return { world, results: [], news: [] };
  }

  const rng = new SeededRNG(world.rngState);
  const seasonNumber = world.seasonState.seasonNumber;
  const windowIndex = world.seasonState.currentWindowIndex;

  // Season end is a special case — delegates to season-end module
  if (window.type === 'season_end') {
    let updatedWorld = handleSeasonEnd({
      ...world,
      seasonState: { ...world.seasonState },
      rngState: rng.getState(),
    });

    const currentCal = [...updatedWorld.seasonState.calendar];
    if (windowIndex < currentCal.length) {
      currentCal[windowIndex] = { ...currentCal[windowIndex], completed: true, results: [] };
    }
    updatedWorld = {
      ...updatedWorld,
      seasonState: { ...updatedWorld.seasonState, calendar: currentCal },
      rngState: rng.getState(),
    };

    // If not a WC year (no worldCupPhase), start next season now
    if (!updatedWorld.seasonState.worldCupPhase) {
      updatedWorld = initializeNewSeason(updatedWorld);
    }

    return {
      world: updatedWorld,
      results: [],
      news: [],
    };
  }

  // Dispatch to window-type handler
  const windowResult = dispatchWindow(
    world,
    window,
    { ...world.teamStates },
    world.seasonState,
    rng,
    world.league1Standings,
    world.league2Standings,
    world.league3Standings,
    world.leagueCup,
    world.superCup,
    world.worldCup,
    world.continentalCups,
  );

  // Phase G — bump the global window counter the moment we know this window
  // produced match results. Both the injury/suspension processor and the
  // stats updater below need to read the POST-bump value so the writes they
  // produce (injuredUntilWindow, suspendedUntilWindow) are expressed in a
  // consistent absolute scale.
  const totalElapsedWindowsAfter = (world.totalElapsedWindows ?? 0)
    + (windowResult.results.length > 0 ? 1 : 0);

  // Post-match processing (rest, pressure, news, events)
  const postMatch = runPostMatchProcessing(
    world,
    windowResult.results,
    windowResult.teamsPlayed,
    windowResult.teamStates,
    { ...world.coachStates },
    { ...world.coachCareers },
    [...world.coachChangesThisSeason],
    window.type,
    seasonNumber,
    windowIndex,
    rng,
    windowResult.league1Standings ?? world.league1Standings,
    windowResult.league2Standings ?? world.league2Standings,
    windowResult.league3Standings ?? world.league3Standings,
    world.seasonState,
  );

  // Update player stats — passes the post-bump global window so injured /
  // suspended players don't get credited an appearance.
  const updatedPlayerStats = windowResult.results.length > 0
    ? updatePlayerStatsFromResults(world.playerStats, windowResult.results, world.squads, totalElapsedWindowsAfter)
    : world.playerStats;

  // Phase G — injury rolls + suspension folding. Mutates `world.squads`
  // (in place — we are crossing the immutability fence intentionally here:
  // the players themselves are objects shared across the world snapshot,
  // and the existing economy / retirement passes already mutate them. The
  // squads ARRAY identity stays the same; only player FIELDS update.). The
  // returned news is wired into the news log alongside the other post-match
  // notifications. We pass a MUTABLE shallow-copied playerStats so the
  // counter resets land on the same object the caller will commit. (We
  // already cloned this above for the appearance-credit pass.)
  const injuryResult = windowResult.results.length > 0
    ? processInjuriesAndSuspensions({
        results: windowResult.results,
        squads: world.squads,
        playerStats: updatedPlayerStats,
        teamBases: postMatch.teamBases,
        seasonNumber,
        globalWindowIdx: totalElapsedWindowsAfter,
        windowIndex,
        rng,
      })
    : { injuriesApplied: [], suspensionsApplied: [], news: [] };

  // Mark window completed, advance index
  const seasonState = { ...world.seasonState };
  const updatedCalendar = [...seasonState.calendar];
  updatedCalendar[windowIndex] = {
    ...updatedCalendar[windowIndex],
    completed: true,
    results: windowResult.results,
  };

  const nextWindowIndex = windowIndex + 1;
  const isSeasonDone = nextWindowIndex >= updatedCalendar.length;

  const updatedSeasonState: SeasonState = {
    ...seasonState,
    calendar: updatedCalendar,
    currentWindowIndex: nextWindowIndex,
    completed: isSeasonDone,
  };

  let updatedWorld: GameWorld = {
    ...world,
    seasonState: updatedSeasonState,
    teamBases: postMatch.teamBases,
    teamStates: postMatch.teamStates,
    league1Standings: windowResult.league1Standings ?? world.league1Standings,
    league2Standings: windowResult.league2Standings ?? world.league2Standings,
    league3Standings: windowResult.league3Standings ?? world.league3Standings,
    leagueCup: windowResult.leagueCup ?? world.leagueCup,
    superCup: windowResult.superCup ?? world.superCup,
    worldCup: windowResult.worldCup !== undefined ? windowResult.worldCup : world.worldCup,
    continentalCups: windowResult.continentalCups ?? world.continentalCups,
    coachStates: postMatch.coachStates,
    coachCareers: postMatch.coachCareers,
    coachChangesThisSeason: postMatch.coachChanges,
    playerStats: updatedPlayerStats,
    activeEvents: postMatch.activeEvents,
    newsLog: [...world.newsLog, ...windowResult.news, ...postMatch.news, ...injuryResult.news],
    memorableMatches: appendMemorableMatches(world.memorableMatches, postMatch.memorableMatches),
    rngState: rng.getState(),
    totalElapsedWindows: totalElapsedWindowsAfter,
  };

  // WC phase just ended — finalize WC results and start next season
  if (isSeasonDone && updatedSeasonState.worldCupPhase) {
    updatedWorld = finalizeWorldCup(updatedWorld);
    updatedWorld = initializeNewSeason(updatedWorld);
  }

  // Pre-populate NEXT window if it needs dynamic fixtures
  if (!isSeasonDone) {
    const cal = updatedWorld.seasonState.calendar;
    const nwi = updatedWorld.seasonState.currentWindowIndex;
    if (nwi < cal.length) {
      const nextWin = cal[nwi];
      if (nextWin.type === 'relegation_playoff' && nextWin.fixtures.length === 0) {
        const pr = determinePromotionRelegation(
          updatedWorld.league1Standings,
          updatedWorld.league2Standings,
          updatedWorld.league3Standings,
          seasonNumber,
        );
        nextWin.fixtures = pr.playoffFixtures;
      }
    }
  }

  return {
    world: updatedWorld,
    results: windowResult.results,
    news: [...windowResult.news, ...postMatch.news, ...injuryResult.news],
  };
}

export { handleSeasonEnd } from './season-end';

export function isSeasonFullyComplete(world: GameWorld): boolean {
  return world.seasonState.completed;
}

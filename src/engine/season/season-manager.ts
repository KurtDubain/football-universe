import { SeasonState, CalendarWindow } from '../../types/season';
import { TeamBase, TeamState, Trophy, SeasonRecord } from '../../types/team';
import { CoachBase, CoachState, CareerEntry } from '../../types/coach';
import { StandingEntry } from '../../types/league';
import { CupState, SuperCupState, WorldCupState } from '../../types/cup';
import { MatchResult, MatchFixture } from '../../types/match';
import { HonorRecord } from '../../types/honor';
import { Player, PlayerSeasonStats } from '../../types/player';
import { SeededRNG } from '../match/rng';
import { simulateMatch, SimulationContext } from '../match/simulator';
import { generateLeagueFixtures } from '../standings/fixtures';
import { createInitialStandings, updateStandings } from '../standings/standings';
import { determinePromotionRelegation, applyPlayoffResults } from '../standings/promotion-relegation';
import { initLeagueCup, advanceLeagueCup, getLeagueCupCurrentFixtures } from '../cups/league-cup';
import { initSuperCup, getSuperCupGroupFixtures, updateSuperCupGroupStandings, completeSuperCupGroupStage, advanceSuperCupKnockout } from '../cups/super-cup';
import { selectWorldCupParticipants, initWorldCup, updateWorldCupGroupStandings, completeWorldCupGroupStage, advanceWorldCupKnockout } from '../cups/world-cup';
import { updateCoachPressure } from '../coaches/coach-pressure';
import { processCoachFiring } from '../coaches/coach-hiring';
import { applyMatchStateChanges, applyRestRecovery, applySeasonEndReset } from '../state-updater';
import { createHonorRecord, generateTeamTrophies } from '../honors/honors';
import { generateAllSquads } from '../players/generator';
import { createInitialPlayerStats, updatePlayerStatsFromResults } from '../players/stats';
import { buildSeasonCalendar, appendWorldCupWindows, CalendarBuildInput } from './calendar-builder';
import { defaultTeams, createInitialTeamStates } from '../../config/teams';
import { defaultCoaches, defaultCoachAssignments, createInitialCoachStates } from '../../config/coaches';
import { leagueConfigs, superCupConfig } from '../../config/competitions';
import { BALANCE } from '../../config/balance';

// ── Public interfaces ────────────────────────────────────────────

export interface NewsItem {
  id: string;
  seasonNumber: number;
  windowIndex: number;
  type: 'match_result' | 'coach_fired' | 'coach_hired' | 'promotion' | 'relegation' | 'trophy' | 'upset' | 'streak';
  title: string;
  description: string;
}

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
  honorHistory: HonorRecord[];
  teamTrophies: Record<string, Trophy[]>;
  coachTrophies: Record<string, Trophy[]>;
  teamSeasonRecords: Record<string, SeasonRecord[]>;
  coachChangesThisSeason: { teamId: string; oldCoachId: string; newCoachId: string; reason: string }[];
  squads: Record<string, Player[]>;
  playerStats: Record<string, PlayerSeasonStats>;
  newsLog: NewsItem[];
  seed: number;
  rngState: number;
}

// ── Helpers ──────────────────────────────────────────────────────

function getTeamIdsByLeague(teamStates: Record<string, TeamState>, level: 1 | 2 | 3): string[] {
  return Object.values(teamStates)
    .filter((ts) => ts.leagueLevel === level)
    .map((ts) => ts.id);
}

function getAllTeamIds(teamStates: Record<string, TeamState>): string[] {
  return Object.keys(teamStates);
}

function buildSimulationContext(
  fixture: MatchFixture,
  world: GameWorld,
  rng: SeededRNG,
): SimulationContext {
  const homeTeam = world.teamBases[fixture.homeTeamId];
  const awayTeam = world.teamBases[fixture.awayTeamId];
  const homeState = world.teamStates[fixture.homeTeamId];
  const awayState = world.teamStates[fixture.awayTeamId];
  const homeCoachId = homeState.currentCoachId;
  const awayCoachId = awayState.currentCoachId;
  const homeCoach = homeCoachId ? world.coachBases[homeCoachId] ?? null : null;
  const awayCoach = awayCoachId ? world.coachBases[awayCoachId] ?? null : null;

  const isKnockout = fixture.competitionType === 'league_cup'
    || fixture.competitionType === 'relegation_playoff'
    || fixture.competitionType === 'world_cup'
    || (fixture.competitionType === 'super_cup');

  return {
    homeTeam,
    awayTeam,
    homeState,
    awayState,
    homeCoach,
    awayCoach,
    competitionType: fixture.competitionType,
    isKnockout,
    rng,
    homeSquad: world.squads[fixture.homeTeamId],
    awaySquad: world.squads[fixture.awayTeamId],
  };
}

function createNewsId(seasonNumber: number, windowIndex: number, suffix: string): string {
  return `S${seasonNumber}-W${windowIndex}-${suffix}`;
}

function isUpset(homeTeam: TeamBase, awayTeam: TeamBase, result: MatchResult): boolean {
  const homeGoalsTotal = result.homeGoals + (result.etHomeGoals ?? 0);
  const awayGoalsTotal = result.awayGoals + (result.etAwayGoals ?? 0);
  const overallDiff = Math.abs(homeTeam.overall - awayTeam.overall);
  if (overallDiff < 10) return false;
  const strongerIsHome = homeTeam.overall > awayTeam.overall;
  if (strongerIsHome) {
    return awayGoalsTotal > homeGoalsTotal;
  }
  return homeGoalsTotal > awayGoalsTotal;
}

function countTrailingResult(form: ('W'|'D'|'L')[], target: 'W'|'D'|'L'): number {
  let count = 0;
  for (let i = form.length - 1; i >= 0; i--) {
    if (form[i] === target) count++;
    else break;
  }
  return count;
}

function countTrailingNotResult(form: ('W'|'D'|'L')[], exclude: 'W'|'D'|'L'): number {
  let count = 0;
  for (let i = form.length - 1; i >= 0; i--) {
    if (form[i] !== exclude) count++;
    else break;
  }
  return count;
}

// Count completed super cup group windows so far
function countCompletedSuperCupGroupWindows(calendar: CalendarWindow[]): number {
  return calendar.filter((w) => w.type === 'super_cup_group' && w.completed).length;
}

// ── Main public functions ────────────────────────────────────────

/**
 * Initialize a fresh game world from a seed.
 */
export function initializeGameWorld(seed: number): GameWorld {
  // 1. Team bases
  const teamBases: Record<string, TeamBase> = {};
  for (const team of defaultTeams) {
    teamBases[team.id] = team;
  }

  // 2. Team states
  const teamStates = createInitialTeamStates(defaultTeams);

  // 3. Coach bases
  const coachBases: Record<string, CoachBase> = {};
  for (const coach of defaultCoaches) {
    coachBases[coach.id] = coach;
  }

  // 4. Coach states
  const coachStates = createInitialCoachStates(defaultCoaches, defaultCoachAssignments);

  // 5. Apply coach assignments to team states
  for (const [teamId, coachId] of Object.entries(defaultCoachAssignments)) {
    if (teamStates[teamId]) {
      teamStates[teamId] = { ...teamStates[teamId], currentCoachId: coachId };
    }
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
  const squads = generateAllSquads(defaultTeams, seed + 7777);
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
    honorHistory: [],
    teamTrophies: {},
    coachTrophies: {},
    teamSeasonRecords: {},
    coachChangesThisSeason: [],
    squads,
    playerStats,
    newsLog: [],
    seed,
    rngState: rng.getState(),
  };

  // Initialize empty trophies / records for every team
  for (const teamId of Object.keys(teamBases)) {
    world.teamTrophies[teamId] = [];
    world.teamSeasonRecords[teamId] = [];
  }
  for (const coachId of Object.keys(coachBases)) {
    world.coachTrophies[coachId] = [];
  }

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

  return {
    ...world,
    seasonState,
    league1Standings,
    league2Standings,
    league3Standings,
    leagueCup,
    superCup,
    worldCup: null,
    coachChangesThisSeason: [],
    playerStats: createInitialPlayerStats(world.squads),
    rngState,
  };
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
  let results: MatchResult[] = [];
  const news: NewsItem[] = [];
  const teamsPlayed = new Set<string>();

  // Deep-copy mutable parts of world for immutability
  let teamStates = { ...world.teamStates };
  let league1Standings = world.league1Standings;
  let league2Standings = world.league2Standings;
  let league3Standings = world.league3Standings;
  let leagueCup = world.leagueCup;
  let superCup = world.superCup;
  let worldCup = world.worldCup;
  let coachStates = { ...world.coachStates };
  let coachCareers = { ...world.coachCareers };
  const coachChanges = [...world.coachChangesThisSeason];
  let seasonState = { ...world.seasonState };

  switch (window.type) {
    // ── League matches ─────────────────────────────────────────
    case 'league': {
      const fixtures = window.fixtures;
      for (const fixture of fixtures) {
        const ctx = buildSimulationContext(fixture, { ...world, teamStates }, rng);
        // League matches are never knockout
        ctx.isKnockout = false;
        const simResult = simulateMatch(ctx, fixture);
        results.push(simResult.matchResult);
        teamsPlayed.add(fixture.homeTeamId);
        teamsPlayed.add(fixture.awayTeamId);

        // Apply state changes
        teamStates[fixture.homeTeamId] = applyMatchStateChanges(
          teamStates[fixture.homeTeamId],
          world.teamBases[fixture.homeTeamId],
          simResult.matchResult,
          true,
        );
        teamStates[fixture.awayTeamId] = applyMatchStateChanges(
          teamStates[fixture.awayTeamId],
          world.teamBases[fixture.awayTeamId],
          simResult.matchResult,
          false,
        );

        // Apply pressure changes
        teamStates[fixture.homeTeamId] = {
          ...teamStates[fixture.homeTeamId],
          coachPressure: teamStates[fixture.homeTeamId].coachPressure + simResult.homePressureChange,
        };
        teamStates[fixture.awayTeamId] = {
          ...teamStates[fixture.awayTeamId],
          coachPressure: teamStates[fixture.awayTeamId].coachPressure + simResult.awayPressureChange,
        };
      }

      // Update standings by league level
      const l1Results = results.filter((r) => r.competitionName === '顶级联赛');
      const l2Results = results.filter((r) => r.competitionName === '甲级联赛');
      const l3Results = results.filter((r) => r.competitionName === '乙级联赛');

      if (l1Results.length > 0) league1Standings = updateStandings(league1Standings, l1Results);
      if (l2Results.length > 0) league2Standings = updateStandings(league2Standings, l2Results);
      if (l3Results.length > 0) league3Standings = updateStandings(league3Standings, l3Results);
      break;
    }

    // ── League cup matches ─────────────────────────────────────
    case 'league_cup': {
      const cupFixtures = getLeagueCupCurrentFixtures(leagueCup);
      const matchFixtures: MatchFixture[] = cupFixtures.map((cf) => ({
        id: cf.id,
        homeTeamId: cf.homeTeamId,
        awayTeamId: cf.awayTeamId,
        competitionType: 'league_cup' as const,
        competitionName: '联赛杯',
        roundLabel: cf.roundName,
      }));

      for (const fixture of matchFixtures) {
        const ctx = buildSimulationContext(fixture, { ...world, teamStates }, rng);
        ctx.isKnockout = true;
        const simResult = simulateMatch(ctx, fixture);
        results.push(simResult.matchResult);
        teamsPlayed.add(fixture.homeTeamId);
        teamsPlayed.add(fixture.awayTeamId);

        teamStates[fixture.homeTeamId] = applyMatchStateChanges(
          teamStates[fixture.homeTeamId],
          world.teamBases[fixture.homeTeamId],
          simResult.matchResult,
          true,
        );
        teamStates[fixture.awayTeamId] = applyMatchStateChanges(
          teamStates[fixture.awayTeamId],
          world.teamBases[fixture.awayTeamId],
          simResult.matchResult,
          false,
        );

        teamStates[fixture.homeTeamId] = {
          ...teamStates[fixture.homeTeamId],
          coachPressure: teamStates[fixture.homeTeamId].coachPressure + simResult.homePressureChange,
        };
        teamStates[fixture.awayTeamId] = {
          ...teamStates[fixture.awayTeamId],
          coachPressure: teamStates[fixture.awayTeamId].coachPressure + simResult.awayPressureChange,
        };
      }

      // Advance the cup
      leagueCup = advanceLeagueCup(leagueCup, results);

      // Update the window's fixtures for display
      window.fixtures = matchFixtures;

      // Populate NEXT league cup window with the new round's fixtures
      if (!leagueCup.completed) {
        const nextLCWindow = seasonState.calendar.find(
          (w) => w.type === 'league_cup' && !w.completed && w.id !== window.id,
        );
        if (nextLCWindow && nextLCWindow.fixtures.length === 0) {
          const nextCupFixtures = getLeagueCupCurrentFixtures(leagueCup);
          nextLCWindow.fixtures = nextCupFixtures.map((cf) => ({
            id: cf.id,
            homeTeamId: cf.homeTeamId,
            awayTeamId: cf.awayTeamId,
            competitionType: 'league_cup' as const,
            competitionName: '联赛杯',
            roundLabel: cf.roundName,
          }));
        }
      }
      break;
    }

    // ── Super cup group stage ──────────────────────────────────
    case 'super_cup_group': {
      // Determine which group round this is (1-6)
      const completedGroupWindows = countCompletedSuperCupGroupWindows(seasonState.calendar);
      const groupRound = completedGroupWindows + 1;

      const cupFixtures = getSuperCupGroupFixtures(superCup, groupRound);
      const matchFixtures: MatchFixture[] = cupFixtures.map((cf) => ({
        id: cf.id,
        homeTeamId: cf.homeTeamId,
        awayTeamId: cf.awayTeamId,
        competitionType: 'super_cup_group' as const,
        competitionName: '超级杯',
        roundLabel: cf.roundName,
      }));

      for (const fixture of matchFixtures) {
        const ctx = buildSimulationContext(fixture, { ...world, teamStates }, rng);
        ctx.isKnockout = false; // Group stage is not knockout
        const simResult = simulateMatch(ctx, fixture);
        results.push(simResult.matchResult);
        teamsPlayed.add(fixture.homeTeamId);
        teamsPlayed.add(fixture.awayTeamId);

        teamStates[fixture.homeTeamId] = applyMatchStateChanges(
          teamStates[fixture.homeTeamId],
          world.teamBases[fixture.homeTeamId],
          simResult.matchResult,
          true,
        );
        teamStates[fixture.awayTeamId] = applyMatchStateChanges(
          teamStates[fixture.awayTeamId],
          world.teamBases[fixture.awayTeamId],
          simResult.matchResult,
          false,
        );

        teamStates[fixture.homeTeamId] = {
          ...teamStates[fixture.homeTeamId],
          coachPressure: teamStates[fixture.homeTeamId].coachPressure + simResult.homePressureChange,
        };
        teamStates[fixture.awayTeamId] = {
          ...teamStates[fixture.awayTeamId],
          coachPressure: teamStates[fixture.awayTeamId].coachPressure + simResult.awayPressureChange,
        };
      }

      // Update group standings
      superCup = updateSuperCupGroupStandings(superCup, results);

      // If this is group round 6, complete group stage and populate knockout fixtures
      if (groupRound === 6) {
        superCup = completeSuperCupGroupStage(superCup, rng);

        // Populate QF L1 and QF L2 knockout windows with fixtures
        const qfL1Round = superCup.knockoutRounds.find((r) => r.roundName === 'QF-L1');
        const qfL2Round = superCup.knockoutRounds.find((r) => r.roundName === 'QF-L2');

        if (qfL1Round) {
          const qfL1Window = seasonState.calendar.find(
            (w) => w.type === 'super_cup' && !w.completed && w.label.includes('QF') && w.label.includes('首回合'),
          );
          if (qfL1Window) {
            qfL1Window.fixtures = qfL1Round.fixtures.map((cf) => ({
              id: cf.id,
              homeTeamId: cf.homeTeamId,
              awayTeamId: cf.awayTeamId,
              competitionType: 'super_cup' as const,
              competitionName: '超级杯',
              roundLabel: cf.roundName,
            }));
          }
        }
        if (qfL2Round) {
          const qfL2Window = seasonState.calendar.find(
            (w) => w.type === 'super_cup' && !w.completed && w.label.includes('QF') && w.label.includes('次回合'),
          );
          if (qfL2Window) {
            qfL2Window.fixtures = qfL2Round.fixtures.map((cf) => ({
              id: cf.id,
              homeTeamId: cf.homeTeamId,
              awayTeamId: cf.awayTeamId,
              competitionType: 'super_cup' as const,
              competitionName: '超级杯',
              roundLabel: cf.roundName,
            }));
          }
        }
      }

      window.fixtures = matchFixtures;
      break;
    }

    // ── Super cup knockout ─────────────────────────────────────
    case 'super_cup': {
      // Find the current incomplete knockout round
      const currentKOIdx = superCup.knockoutRounds.findIndex((r) => !r.completed);
      if (currentKOIdx === -1) break;
      const currentKORound = superCup.knockoutRounds[currentKOIdx];

      const isFinal = currentKORound.roundName === 'Final';
      const matchFixtures: MatchFixture[] = currentKORound.fixtures.map((cf) => ({
        id: cf.id,
        homeTeamId: cf.homeTeamId,
        awayTeamId: cf.awayTeamId,
        competitionType: 'super_cup' as const,
        competitionName: '超级杯',
        roundLabel: cf.roundName,
      }));

      for (const fixture of matchFixtures) {
        const ctx = buildSimulationContext(fixture, { ...world, teamStates }, rng);
        // Final is single-leg knockout; two-legged rounds are not strictly knockout
        // but we still need a winner for the second leg (handled by advanceSuperCupKnockout)
        ctx.isKnockout = isFinal;
        const simResult = simulateMatch(ctx, fixture);
        results.push(simResult.matchResult);
        teamsPlayed.add(fixture.homeTeamId);
        teamsPlayed.add(fixture.awayTeamId);

        teamStates[fixture.homeTeamId] = applyMatchStateChanges(
          teamStates[fixture.homeTeamId],
          world.teamBases[fixture.homeTeamId],
          simResult.matchResult,
          true,
        );
        teamStates[fixture.awayTeamId] = applyMatchStateChanges(
          teamStates[fixture.awayTeamId],
          world.teamBases[fixture.awayTeamId],
          simResult.matchResult,
          false,
        );

        teamStates[fixture.homeTeamId] = {
          ...teamStates[fixture.homeTeamId],
          coachPressure: teamStates[fixture.homeTeamId].coachPressure + simResult.homePressureChange,
        };
        teamStates[fixture.awayTeamId] = {
          ...teamStates[fixture.awayTeamId],
          coachPressure: teamStates[fixture.awayTeamId].coachPressure + simResult.awayPressureChange,
        };
      }

      // Advance the knockout
      superCup = advanceSuperCupKnockout(superCup, results, rng);

      // After advancing, populate the next window's fixtures if new rounds were created
      const nextKOIdx = superCup.knockoutRounds.findIndex((r) => !r.completed);
      if (nextKOIdx !== -1) {
        const nextKORound = superCup.knockoutRounds[nextKOIdx];
        // Find the next super_cup window that hasn't been completed yet
        const nextSCWindow = seasonState.calendar.find(
          (w) => w.type === 'super_cup' && !w.completed && w.id > window.id,
        );
        if (nextSCWindow && nextSCWindow.fixtures.length === 0) {
          nextSCWindow.fixtures = nextKORound.fixtures.map((cf) => ({
            id: cf.id,
            homeTeamId: cf.homeTeamId,
            awayTeamId: cf.awayTeamId,
            competitionType: 'super_cup' as const,
            competitionName: '超级杯',
            roundLabel: cf.roundName,
          }));
        }
      }

      window.fixtures = matchFixtures;
      break;
    }

    // ── Relegation playoff ─────────────────────────────────────
    case 'relegation_playoff': {
      const proRelResult = determinePromotionRelegation(
        league1Standings,
        league2Standings,
        league3Standings,
        seasonNumber,
      );

      const playoffFixtures = proRelResult.playoffFixtures;

      // Populate the window's fixtures for Dashboard display
      window.fixtures = playoffFixtures;

      for (const fixture of playoffFixtures) {
        const ctx = buildSimulationContext(fixture, { ...world, teamStates }, rng);
        ctx.isKnockout = true;
        const simResult = simulateMatch(ctx, fixture);
        results.push(simResult.matchResult);
        teamsPlayed.add(fixture.homeTeamId);
        teamsPlayed.add(fixture.awayTeamId);

        teamStates[fixture.homeTeamId] = applyMatchStateChanges(
          teamStates[fixture.homeTeamId],
          world.teamBases[fixture.homeTeamId],
          simResult.matchResult,
          true,
        );
        teamStates[fixture.awayTeamId] = applyMatchStateChanges(
          teamStates[fixture.awayTeamId],
          world.teamBases[fixture.awayTeamId],
          simResult.matchResult,
          false,
        );
      }

      // Apply playoff outcomes
      const finalProRel = applyPlayoffResults(proRelResult, results);

      // Apply league level changes to team states
      for (const p of finalProRel.promoted) {
        teamStates[p.teamId] = {
          ...teamStates[p.teamId],
          leagueLevel: p.to as 1 | 2 | 3,
        };
        news.push({
          id: createNewsId(seasonNumber, windowIndex, `promo-${p.teamId}`),
          seasonNumber,
          windowIndex,
          type: 'promotion',
          title: `${world.teamBases[p.teamId].name} 附加赛升级成功!`,
          description: `${world.teamBases[p.teamId].name} 在升降级附加赛中获胜，从${p.from}级联赛升入${p.to}级联赛。`,
        });
      }
      for (const r of finalProRel.relegated) {
        teamStates[r.teamId] = {
          ...teamStates[r.teamId],
          leagueLevel: r.to as 1 | 2 | 3,
        };
        news.push({
          id: createNewsId(seasonNumber, windowIndex, `releg-${r.teamId}`),
          seasonNumber,
          windowIndex,
          type: 'relegation',
          title: `${world.teamBases[r.teamId].name} 附加赛降级`,
          description: `${world.teamBases[r.teamId].name} 在升降级附加赛中失利，从${r.from}级联赛降入${r.to}级联赛。`,
        });
      }

      window.fixtures = playoffFixtures;
      break;
    }

    // ── Season end ─────────────────────────────────────────────
    case 'season_end': {
      const updatedWorld = handleSeasonEnd({
        ...world,
        teamStates,
        league1Standings,
        league2Standings,
        league3Standings,
        leagueCup,
        superCup,
        worldCup,
        coachStates,
        coachCareers,
        coachChangesThisSeason: coachChanges,
        seasonState,
        rngState: rng.getState(),
      });

      // Mark current window complete
      const currentCal = [...updatedWorld.seasonState.calendar];
      if (windowIndex < currentCal.length) {
        currentCal[windowIndex] = { ...currentCal[windowIndex], completed: true, results };
      }

      return {
        world: {
          ...updatedWorld,
          seasonState: {
            ...updatedWorld.seasonState,
            calendar: currentCal,
          },
          rngState: rng.getState(),
        },
        results: [],
        news,
      };
    }

    // ── World cup group stage ──────────────────────────────────
    case 'world_cup_group': {
      if (!worldCup) break;

      // Determine which group round this is
      const completedWCGroupWindows = seasonState.calendar.filter(
        (w) => w.type === 'world_cup_group' && w.completed,
      ).length;
      const groupRound = completedWCGroupWindows + 1;

      const cupFixtures = getSuperCupGroupFixtures(
        // WorldCupState has the same group structure; reuse by extracting fixtures manually
        { groups: worldCup.groups } as any,
        groupRound,
      );

      // Actually use the world cup group fixtures directly
      const wcGroupFixtures: import('../../types/cup').CupFixture[] = [];
      for (const group of worldCup.groups) {
        for (const fixture of group.fixtures) {
          if (fixture.round === groupRound) {
            wcGroupFixtures.push(fixture);
          }
        }
      }

      const matchFixtures: MatchFixture[] = wcGroupFixtures.map((cf) => ({
        id: cf.id,
        homeTeamId: cf.homeTeamId,
        awayTeamId: cf.awayTeamId,
        competitionType: 'world_cup_group' as const,
        competitionName: '环球冠军杯',
        roundLabel: cf.roundName,
      }));

      for (const fixture of matchFixtures) {
        const ctx = buildSimulationContext(fixture, { ...world, teamStates }, rng);
        ctx.isKnockout = false;
        const simResult = simulateMatch(ctx, fixture);
        results.push(simResult.matchResult);
        teamsPlayed.add(fixture.homeTeamId);
        teamsPlayed.add(fixture.awayTeamId);

        teamStates[fixture.homeTeamId] = applyMatchStateChanges(
          teamStates[fixture.homeTeamId],
          world.teamBases[fixture.homeTeamId],
          simResult.matchResult,
          true,
        );
        teamStates[fixture.awayTeamId] = applyMatchStateChanges(
          teamStates[fixture.awayTeamId],
          world.teamBases[fixture.awayTeamId],
          simResult.matchResult,
          false,
        );
      }

      worldCup = updateWorldCupGroupStandings(worldCup, results);

      // If group round 6, complete group stage
      if (groupRound === 6) {
        worldCup = completeWorldCupGroupStage(worldCup, rng);

        // Populate next world_cup knockout window with R16 fixtures
        const r16Round = worldCup.knockoutRounds.find((r) => r.roundName === 'R16');
        if (r16Round) {
          const nextWCWindow = seasonState.calendar.find(
            (w) => w.type === 'world_cup' && !w.completed,
          );
          if (nextWCWindow) {
            nextWCWindow.fixtures = r16Round.fixtures.map((cf) => ({
              id: cf.id,
              homeTeamId: cf.homeTeamId,
              awayTeamId: cf.awayTeamId,
              competitionType: 'world_cup' as const,
              competitionName: '环球冠军杯',
              roundLabel: cf.roundName,
            }));
          }
        }
      }

      window.fixtures = matchFixtures;
      break;
    }

    // ── World cup knockout ─────────────────────────────────────
    case 'world_cup': {
      if (!worldCup) break;

      const currentKOIdx = worldCup.knockoutRounds.findIndex((r) => !r.completed);
      if (currentKOIdx === -1) break;
      const currentKORound = worldCup.knockoutRounds[currentKOIdx];

      const matchFixtures: MatchFixture[] = currentKORound.fixtures.map((cf) => ({
        id: cf.id,
        homeTeamId: cf.homeTeamId,
        awayTeamId: cf.awayTeamId,
        competitionType: 'world_cup' as const,
        competitionName: '环球冠军杯',
        roundLabel: cf.roundName,
      }));

      for (const fixture of matchFixtures) {
        const ctx = buildSimulationContext(fixture, { ...world, teamStates }, rng);
        ctx.isKnockout = true;
        const simResult = simulateMatch(ctx, fixture);
        results.push(simResult.matchResult);
        teamsPlayed.add(fixture.homeTeamId);
        teamsPlayed.add(fixture.awayTeamId);

        teamStates[fixture.homeTeamId] = applyMatchStateChanges(
          teamStates[fixture.homeTeamId],
          world.teamBases[fixture.homeTeamId],
          simResult.matchResult,
          true,
        );
        teamStates[fixture.awayTeamId] = applyMatchStateChanges(
          teamStates[fixture.awayTeamId],
          world.teamBases[fixture.awayTeamId],
          simResult.matchResult,
          false,
        );
      }

      worldCup = advanceWorldCupKnockout(worldCup, results, rng);

      // Populate next knockout window if available
      const nextKOIdx = worldCup.knockoutRounds.findIndex((r) => !r.completed);
      if (nextKOIdx !== -1) {
        const nextKORound = worldCup.knockoutRounds[nextKOIdx];
        const nextWCWindow = seasonState.calendar.find(
          (w) => w.type === 'world_cup' && !w.completed && w.id > window.id,
        );
        if (nextWCWindow && nextWCWindow.fixtures.length === 0) {
          nextWCWindow.fixtures = nextKORound.fixtures.map((cf) => ({
            id: cf.id,
            homeTeamId: cf.homeTeamId,
            awayTeamId: cf.awayTeamId,
            competitionType: 'world_cup' as const,
            competitionName: '环球冠军杯',
            roundLabel: cf.roundName,
          }));
        }
      }

      window.fixtures = matchFixtures;
      break;
    }

    default:
      break;
  }

  // ── Rest recovery for teams that did not play ────────────────
  for (const teamId of getAllTeamIds(teamStates)) {
    if (!teamsPlayed.has(teamId)) {
      teamStates[teamId] = applyRestRecovery(teamStates[teamId]);
    }
  }

  // ── Coach pressure and firing ────────────────────────────────
  for (const teamId of teamsPlayed) {
    const state = teamStates[teamId];
    const teamBase = world.teamBases[teamId];
    const coachId = state.currentCoachId;
    if (!coachId) continue;

    // Find this team's match result
    const teamResult = results.find(
      (r) => r.homeTeamId === teamId || r.awayTeamId === teamId,
    );
    if (!teamResult) continue;

    // Check for cup elimination
    const isCupElimination =
      (window.type === 'league_cup' || window.type === 'super_cup' || window.type === 'world_cup') &&
      isTeamEliminated(teamId, teamResult);

    const pressureUpdate = updateCoachPressure(
      state.coachPressure,
      teamResult,
      teamId,
      teamBase,
      state.recentForm,
      isCupElimination,
    );

    teamStates[teamId] = {
      ...teamStates[teamId],
      coachPressure: pressureUpdate.newPressure,
    };

    if (pressureUpdate.shouldFire) {
      // Process coach firing
      const allCoachData = Object.entries(coachStates).map(([id, cs]) => ({
        base: world.coachBases[id],
        state: cs,
      })).filter((c) => c.base != null);

      const firingResult = processCoachFiring(
        teamId,
        coachId,
        teamBase,
        allCoachData,
        seasonNumber,
        rng,
      );

      // Update fired coach state
      coachStates[coachId] = { ...coachStates[coachId], ...firingResult.firedCoachUpdate };

      // Update or create new coach state
      if (coachStates[firingResult.newCoachId]) {
        coachStates[firingResult.newCoachId] = {
          ...coachStates[firingResult.newCoachId],
          ...firingResult.newCoachUpdate,
        };
      } else {
        // Caretaker coach
        coachStates[firingResult.newCoachId] = {
          id: firingResult.newCoachId,
          currentTeamId: teamId,
          isUnemployed: false,
          unemployedSince: null,
        };
      }

      // Update team state
      teamStates[teamId] = {
        ...teamStates[teamId],
        currentCoachId: firingResult.newCoachId,
        coachPressure: 10, // Reset pressure for new coach
      };

      // Update careers
      const firedCoachCareer = [...(coachCareers[coachId] ?? [])];
      const lastEntry = firedCoachCareer[firedCoachCareer.length - 1];
      if (lastEntry && lastEntry.toSeason === null) {
        firedCoachCareer[firedCoachCareer.length - 1] = {
          ...lastEntry,
          ...firingResult.firedCareerUpdate,
        };
      }
      coachCareers[coachId] = firedCoachCareer;

      const newCoachCareerList = [...(coachCareers[firingResult.newCoachId] ?? [])];
      newCoachCareerList.push(firingResult.newCareerEntry);
      coachCareers[firingResult.newCoachId] = newCoachCareerList;

      coachChanges.push({
        teamId,
        oldCoachId: coachId,
        newCoachId: firingResult.newCoachId,
        reason: pressureUpdate.fireReason ?? 'Pressure too high',
      });

      const newCoachName = world.coachBases[firingResult.newCoachId]?.name ?? firingResult.newCoachId;
      const firedCoachName = world.coachBases[coachId]?.name ?? coachId;

      news.push({
        id: createNewsId(seasonNumber, windowIndex, `fire-${teamId}`),
        seasonNumber,
        windowIndex,
        type: 'coach_fired',
        title: `${firedCoachName} 被解雇 — ${teamBase.name}`,
        description: `${firedCoachName} 已被解雇。原因: ${pressureUpdate.fireReason}`,
      });
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `hire-${teamId}`),
        seasonNumber,
        windowIndex,
        type: 'coach_hired',
        title: `${teamBase.name} 聘用新帅 ${newCoachName}`,
        description: `${newCoachName} 正式执教 ${teamBase.name}.`,
      });
    }
  }

  // ── Generate upset news ──────────────────────────────────────
  for (const result of results) {
    const homeTeam = world.teamBases[result.homeTeamId];
    const awayTeam = world.teamBases[result.awayTeamId];
    if (homeTeam && awayTeam && isUpset(homeTeam, awayTeam, result)) {
      const winnerIsHome = result.homeGoals + (result.etHomeGoals ?? 0) > result.awayGoals + (result.etAwayGoals ?? 0);
      const winner = winnerIsHome ? homeTeam : awayTeam;
      const loser = winnerIsHome ? awayTeam : homeTeam;
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `upset-${result.fixtureId}`),
        seasonNumber,
        windowIndex,
        type: 'upset',
        title: `爆冷! ${winner.name} 击败 ${loser.name}`,
        description: `${winner.name} (综合实力 ${winner.overall}) 爆冷击败了 ${loser.name} (综合实力 ${loser.overall}).`,
      });
    }
  }

  // ── Streak news (win/loss streaks) ──────────────────────────────
  for (const teamId of teamsPlayed) {
    const state = teamStates[teamId];
    const form = state.recentForm;
    if (form.length < 3) continue;
    const teamName = world.teamBases[teamId]?.name ?? teamId;

    // Check win streak (3+)
    const winStreak = countTrailingResult(form, 'W');
    if (winStreak >= 3) {
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `streak-w-${teamId}`),
        seasonNumber, windowIndex, type: 'streak',
        title: `${teamName} ${winStreak}连胜！`,
        description: `${teamName}近期状态火热，已经取得${winStreak}连胜。`,
      });
    }

    // Check loss streak (3+)
    const lossStreak = countTrailingResult(form, 'L');
    if (lossStreak >= 3) {
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `streak-l-${teamId}`),
        seasonNumber, windowIndex, type: 'streak',
        title: `${teamName} 遭遇${lossStreak}连败`,
        description: `${teamName}深陷低谷，已经连续${lossStreak}场不胜。`,
      });
    }

    // Check unbeaten streak (5+)
    const unbeaten = countTrailingNotResult(form, 'L');
    if (unbeaten >= 5) {
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `streak-u-${teamId}`),
        seasonNumber, windowIndex, type: 'streak',
        title: `${teamName} ${unbeaten}场不败`,
        description: `${teamName}保持了${unbeaten}场不败的优异战绩。`,
      });
    }
  }

  // ── Special match event news ────────────────────────────────
  for (const result of results) {
    const goalEvents = result.events.filter(e => e.type === 'goal' || e.type === 'penalty_goal');

    // Hat trick detection (3+ goals by same player number)
    const playerGoals = new Map<string, number>();
    for (const e of goalEvents) {
      if (e.playerId) {
        playerGoals.set(e.playerId, (playerGoals.get(e.playerId) ?? 0) + 1);
      }
    }
    for (const [playerId, count] of playerGoals) {
      if (count >= 3) {
        const parts = playerId.split('-');
        const num = parts[parts.length - 1];
        const teamId = parts.slice(0, -1).join('-');
        const teamName = world.teamBases[teamId]?.name ?? teamId;
        news.push({
          id: createNewsId(seasonNumber, windowIndex, `hattrick-${playerId}`),
          seasonNumber, windowIndex, type: 'match_result',
          title: `帽子戏法! ${teamName} ${num}号独进${count}球`,
          description: `${teamName}的${num}号球员上演帽子戏法，独中${count}元。`,
        });
      }
    }

    // Late drama (goal at 85+ min that changed the result)
    const lateGoals = goalEvents.filter(e => e.minute >= 85 && e.minute <= 90);
    if (lateGoals.length > 0) {
      const totalHome = result.homeGoals;
      const totalAway = result.awayGoals;
      const diff = Math.abs(totalHome - totalAway);
      if (diff <= 1) {
        const scorer = lateGoals[lateGoals.length - 1];
        const teamName = world.teamBases[scorer.teamId]?.name ?? scorer.teamId;
        const numStr = scorer.playerNumber ? `${scorer.playerNumber}号` : '';
        news.push({
          id: createNewsId(seasonNumber, windowIndex, `latedrama-${result.fixtureId}`),
          seasonNumber, windowIndex, type: 'match_result',
          title: `绝杀! ${teamName} ${numStr}补时建功`,
          description: `${teamName}在第${scorer.minute}分钟打入关键进球，上演绝杀好戏！`,
        });
      }
    }
  }

  // ── Update player stats ──────────────────────────────────────
  const updatedPlayerStats = results.length > 0
    ? updatePlayerStatsFromResults(world.playerStats, results, world.squads)
    : world.playerStats;

  // ── Mark window completed, advance index ─────────────────────
  const updatedCalendar = [...seasonState.calendar];
  updatedCalendar[windowIndex] = {
    ...updatedCalendar[windowIndex],
    completed: true,
    results,
  };

  const nextWindowIndex = windowIndex + 1;
  const isSeasonDone = nextWindowIndex >= updatedCalendar.length;

  seasonState = {
    ...seasonState,
    calendar: updatedCalendar,
    currentWindowIndex: nextWindowIndex,
    completed: isSeasonDone,
  };

  let updatedWorld: GameWorld = {
    ...world,
    seasonState,
    teamStates,
    league1Standings,
    league2Standings,
    league3Standings,
    leagueCup,
    superCup,
    worldCup,
    coachStates,
    coachCareers,
    coachChangesThisSeason: coachChanges,
    playerStats: updatedPlayerStats,
    newsLog: [...world.newsLog, ...news],
    rngState: rng.getState(),
  };

  // If the season (including world cup) just ended, auto-start next season
  if (isSeasonDone && seasonState.worldCupPhase) {
    // World cup year finished — start next season
    updatedWorld = initializeNewSeason(updatedWorld);
  }

  // Pre-populate NEXT window if it needs dynamic fixtures (relegation playoff)
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
    results,
    news,
  };
}

/**
 * Handle end-of-season processing: honors, trophies, records, and prep next season.
 */
export function handleSeasonEnd(world: GameWorld): GameWorld {
  const seasonNumber = world.seasonState.seasonNumber;
  const rng = new SeededRNG(world.rngState);

  // Determine champions
  const league1Champion = world.league1Standings[0]?.teamId ?? '';
  const league2Champion = world.league2Standings[0]?.teamId ?? '';
  const league3Champion = world.league3Standings[0]?.teamId ?? '';
  const leagueCupWinner = world.leagueCup.winnerId ?? '';
  const superCupWinner = world.superCup.winnerId ?? '';
  const worldCupWinner = world.worldCup?.winnerId;

  // Promotion / relegation (already applied during relegation_playoff window)
  // Collect the movements that happened
  const proRelResult = determinePromotionRelegation(
    world.league1Standings,
    world.league2Standings,
    world.league3Standings,
    seasonNumber,
  );

  // Create honor record
  const honor = createHonorRecord(
    seasonNumber,
    league1Champion,
    league2Champion,
    league3Champion,
    leagueCupWinner,
    superCupWinner,
    worldCupWinner,
    proRelResult.promoted,
    proRelResult.relegated,
    world.coachChangesThisSeason,
  );
  const honorHistory = [...world.honorHistory, honor];

  // Generate trophies for all teams
  const teamTrophies = { ...world.teamTrophies };
  const coachTrophies = { ...world.coachTrophies };
  for (const teamId of getAllTeamIds(world.teamStates)) {
    const teamState = world.teamStates[teamId];
    const trophies = generateTeamTrophies(
      teamId,
      seasonNumber,
      league1Champion,
      league2Champion,
      league3Champion,
      leagueCupWinner,
      superCupWinner,
      worldCupWinner,
      teamState.leagueLevel,
    );
    teamTrophies[teamId] = [...(teamTrophies[teamId] ?? []), ...trophies];

    // Also attribute trophies to the coach
    const coachId = teamState.currentCoachId;
    if (coachId && trophies.length > 0) {
      coachTrophies[coachId] = [...(coachTrophies[coachId] ?? []), ...trophies];

      // Update coach career entry with trophies
      const careerList = [...(world.coachCareers[coachId] ?? [])];
      const lastEntry = careerList[careerList.length - 1];
      if (lastEntry && lastEntry.toSeason === null) {
        careerList[careerList.length - 1] = {
          ...lastEntry,
          trophies: [...lastEntry.trophies, ...trophies],
        };
      }
      world.coachCareers[coachId] = careerList;
    }
  }

  // Generate trophy news + season summary news
  const news: NewsItem[] = [];
  const windowIndex = world.seasonState.currentWindowIndex;

  if (league1Champion) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'trophy-l1'),
      seasonNumber, windowIndex, type: 'trophy',
      title: `${world.teamBases[league1Champion]?.name} 夺得顶级联赛冠军!`,
      description: `${world.teamBases[league1Champion]?.name} 加冕顶级联赛冠军，以${world.league1Standings[0]?.points}分的成绩登顶。`,
    });
  }
  if (league2Champion) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'trophy-l2'),
      seasonNumber, windowIndex, type: 'trophy',
      title: `${world.teamBases[league2Champion]?.name} 夺得甲级联赛冠军!`,
      description: `${world.teamBases[league2Champion]?.name} 以${world.league2Standings[0]?.points}分荣膺甲级联赛冠军。`,
    });
  }
  if (leagueCupWinner) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'trophy-lc'),
      seasonNumber, windowIndex, type: 'trophy',
      title: `${world.teamBases[leagueCupWinner]?.name} 夺得联赛杯冠军!`,
      description: `${world.teamBases[leagueCupWinner]?.name} 捧得联赛杯冠军奖杯。`,
    });
  }
  if (superCupWinner) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'trophy-sc'),
      seasonNumber, windowIndex, type: 'trophy',
      title: `${world.teamBases[superCupWinner]?.name} 夺得超级杯冠军!`,
      description: `${world.teamBases[superCupWinner]?.name} 赢得超级杯冠军荣耀。`,
    });
  }

  // ── Multi-crown detection ──
  const allWinners = [league1Champion, leagueCupWinner, superCupWinner, worldCupWinner].filter(Boolean);
  const crownCounts = new Map<string, number>();
  for (const w of allWinners) { if (w) crownCounts.set(w, (crownCounts.get(w) ?? 0) + 1); }
  for (const [teamId, count] of crownCounts) {
    if (count >= 4) {
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `crown-${teamId}`),
        seasonNumber, windowIndex, type: 'trophy',
        title: `四冠王！${world.teamBases[teamId]?.name} 包揽所有冠军！`,
        description: `${world.teamBases[teamId]?.name}创造历史，在一个赛季内夺得全部冠军头衔！`,
      });
    } else if (count >= 3) {
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `crown-${teamId}`),
        seasonNumber, windowIndex, type: 'trophy',
        title: `三冠王！${world.teamBases[teamId]?.name} 创造伟业！`,
        description: `${world.teamBases[teamId]?.name}一个赛季夺得三座冠军奖杯，成就三冠王荣耀！`,
      });
    } else if (count >= 2) {
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `crown-${teamId}`),
        seasonNumber, windowIndex, type: 'trophy',
        title: `双冠王！${world.teamBases[teamId]?.name}`,
        description: `${world.teamBases[teamId]?.name}本赛季荣获两座冠军奖杯，成就双冠王！`,
      });
    }
  }

  // ── Underdog achievements ──
  // Cup finalist from lower leagues
  const cupFinalists = [leagueCupWinner, superCupWinner].filter(Boolean);
  for (const fId of cupFinalists) {
    if (!fId) continue;
    const teamState = world.teamStates[fId];
    if (teamState && teamState.leagueLevel >= 2) {
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `underdog-${fId}`),
        seasonNumber, windowIndex, type: 'upset',
        title: `黑马奇迹！${world.teamBases[fId]?.name} 以下克上夺冠！`,
        description: `来自${teamState.leagueLevel === 2 ? '甲级' : '乙级'}联赛的${world.teamBases[fId]?.name}在杯赛中上演了不可思议的夺冠之旅！`,
      });
    }
  }

  // ── Season summary news ──

  // Top scorer
  const allPlayerStats = Object.values(world.playerStats);
  const topScorer = allPlayerStats.reduce((best, s) => s.goals > (best?.goals ?? 0) ? s : best, null as any);
  if (topScorer && topScorer.goals > 0) {
    const parts = topScorer.playerId.split('-');
    const num = parts[parts.length - 1];
    const teamName = world.teamBases[topScorer.teamId]?.name ?? topScorer.teamId;
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'scorer'),
      seasonNumber, windowIndex, type: 'trophy',
      title: `赛季射手王: ${teamName} ${num}号 (${topScorer.goals}球)`,
      description: `${teamName}的${num}号球员以${topScorer.goals}粒进球荣获本赛季射手王。`,
    });
  }

  // Best defense (least goals conceded in top league)
  const bestDefense = [...world.league1Standings].sort((a, b) => a.goalsAgainst - b.goalsAgainst)[0];
  if (bestDefense && bestDefense.played > 0) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'defense'),
      seasonNumber, windowIndex, type: 'streak',
      title: `最佳防守: ${world.teamBases[bestDefense.teamId]?.name} (仅失${bestDefense.goalsAgainst}球)`,
      description: `${world.teamBases[bestDefense.teamId]?.name}以全赛季仅丢${bestDefense.goalsAgainst}球成为顶级联赛最佳防线。`,
    });
  }

  // Most goals scored in top league
  const bestAttack = [...world.league1Standings].sort((a, b) => b.goalsFor - a.goalsFor)[0];
  if (bestAttack && bestAttack.played > 0 && bestAttack.teamId !== league1Champion) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'attack'),
      seasonNumber, windowIndex, type: 'streak',
      title: `火力最猛: ${world.teamBases[bestAttack.teamId]?.name} (${bestAttack.goalsFor}球)`,
      description: `${world.teamBases[bestAttack.teamId]?.name}以${bestAttack.goalsFor}粒进球成为顶级联赛最强火力。`,
    });
  }

  // Promoted teams
  for (const p of proRelResult.promoted) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, `promo-${p.teamId}`),
      seasonNumber, windowIndex, type: 'promotion',
      title: `${world.teamBases[p.teamId]?.name} 升级成功!`,
      description: `${world.teamBases[p.teamId]?.name} 从${p.from}级联赛升入${p.to}级联赛。`,
    });
  }

  // Relegated teams
  for (const r of proRelResult.relegated) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, `releg-${r.teamId}`),
      seasonNumber, windowIndex, type: 'relegation',
      title: `${world.teamBases[r.teamId]?.name} 不幸降级`,
      description: `${world.teamBases[r.teamId]?.name} 从${r.from}级联赛降入${r.to}级联赛。`,
    });
  }

  // Coach changes summary
  if (world.coachChangesThisSeason.length > 0) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'coach-summary'),
      seasonNumber, windowIndex, type: 'coach_fired',
      title: `本赛季共有 ${world.coachChangesThisSeason.length} 次换帅`,
      description: world.coachChangesThisSeason.map(c => `${world.teamBases[c.teamId]?.name}`).join('、') + ' 更换了教练。',
    });
  }

  // Create season records for all teams
  const teamSeasonRecords = { ...world.teamSeasonRecords };
  const allStandings: Record<number, StandingEntry[]> = {
    1: world.league1Standings,
    2: world.league2Standings,
    3: world.league3Standings,
  };

  for (const teamId of getAllTeamIds(world.teamStates)) {
    const teamState = world.teamStates[teamId];
    // Find this team's standings entry — search ALL leagues since leagueLevel
    // may have changed due to promotion/relegation
    let entry: StandingEntry | undefined;
    let foundLevel: 1 | 2 | 3 = teamState.leagueLevel;
    for (const [lvStr, st] of Object.entries(allStandings)) {
      const found = st.find((s) => s.teamId === teamId);
      if (found && found.played > 0) {
        entry = found;
        foundLevel = parseInt(lvStr) as 1 | 2 | 3;
        break;
      }
    }
    const standings = allStandings[foundLevel] ?? [];
    const position = entry ? standings.indexOf(entry) + 1 : standings.length;

    const record: SeasonRecord = {
      seasonNumber,
      leagueLevel: foundLevel, // the league they actually played in this season
      leaguePosition: position,
      leaguePlayed: entry?.played ?? 0,
      leagueWon: entry?.won ?? 0,
      leagueDrawn: entry?.drawn ?? 0,
      leagueLost: entry?.lost ?? 0,
      leagueGF: entry?.goalsFor ?? 0,
      leagueGA: entry?.goalsAgainst ?? 0,
      leaguePoints: entry?.points ?? 0,
      coachId: teamState.currentCoachId ?? '',
      promoted: teamState.leagueLevel < world.teamBases[teamId].initialLeagueLevel,
      relegated: teamState.leagueLevel > world.teamBases[teamId].initialLeagueLevel,
    };

    teamSeasonRecords[teamId] = [...(teamSeasonRecords[teamId] ?? []), record];
  }

  // Apply season-end reset to team states
  let teamStates = { ...world.teamStates };
  for (const teamId of getAllTeamIds(teamStates)) {
    const state = teamStates[teamId];
    const standings = allStandings[state.leagueLevel] ?? [];
    const entry = standings.find((s) => s.teamId === teamId);
    const position = entry ? standings.indexOf(entry) + 1 : standings.length;

    teamStates[teamId] = applySeasonEndReset(state, position, standings.length);
  }

  // ── Team growth/decline based on season performance ─────────
  const teamBases = { ...world.teamBases };
  for (const teamId of getAllTeamIds(teamStates)) {
    const base = { ...teamBases[teamId] };
    const state = teamStates[teamId];
    const standings = allStandings[state.leagueLevel] ?? [];
    const entry = standings.find((s) => s.teamId === teamId);
    const position = entry ? standings.indexOf(entry) + 1 : standings.length;
    const total = standings.length;
    const ratio = position / total; // 0=champion, 1=last

    // Champions and top finishers grow slightly
    if (ratio <= 0.15) {
      base.overall = Math.min(99, base.overall + rng.nextInt(0, 2));
      base.attack = Math.min(99, base.attack + rng.nextInt(0, 1));
      base.defense = Math.min(99, base.defense + rng.nextInt(0, 1));
    } else if (ratio <= 0.35) {
      base.overall = Math.min(99, base.overall + rng.nextInt(0, 1));
    }
    // Bottom finishers decline slightly
    else if (ratio >= 0.85) {
      base.overall = Math.max(30, base.overall - rng.nextInt(0, 2));
      base.attack = Math.max(30, base.attack - rng.nextInt(0, 1));
      base.defense = Math.max(30, base.defense - rng.nextInt(0, 1));
    } else if (ratio >= 0.7) {
      base.overall = Math.max(30, base.overall - rng.nextInt(0, 1));
    }

    // Promoted teams get a small boost
    if (state.leagueLevel < base.initialLeagueLevel) {
      base.overall = Math.min(99, base.overall + 1);
      base.depth = Math.min(99, base.depth + 1);
    }
    // Relegated teams decline
    if (state.leagueLevel > base.initialLeagueLevel) {
      base.overall = Math.max(30, base.overall - 1);
      base.depth = Math.max(30, base.depth - 1);
    }

    // Clamp midfield/stability based on overall shift
    base.midfield = Math.max(30, Math.min(99, base.midfield + (base.overall - teamBases[teamId].overall)));

    teamBases[teamId] = base;
  }

  // Update season state awards
  const seasonState: SeasonState = {
    ...world.seasonState,
    completed: true,
    awards: {
      league1Champion,
      league1RunnerUp: world.league1Standings[1]?.teamId,
      league2Champion,
      league3Champion,
      leagueCupWinner,
      leagueCupRunnerUp: world.leagueCup.rounds.at(-1)?.fixtures[0]
        ? (world.leagueCup.rounds.at(-1)!.fixtures[0].homeTeamId === leagueCupWinner
          ? world.leagueCup.rounds.at(-1)!.fixtures[0].awayTeamId
          : world.leagueCup.rounds.at(-1)!.fixtures[0].homeTeamId)
        : undefined,
      superCupWinner,
      superCupRunnerUp: world.superCup.knockoutRounds.at(-1)?.fixtures[0]
        ? (world.superCup.knockoutRounds.at(-1)!.fixtures[0].homeTeamId === superCupWinner
          ? world.superCup.knockoutRounds.at(-1)!.fixtures[0].awayTeamId
          : world.superCup.knockoutRounds.at(-1)!.fixtures[0].homeTeamId)
        : undefined,
      worldCupWinner,
      worldCupRunnerUp: world.worldCup?.knockoutRounds.at(-1)?.fixtures[0]
        ? (world.worldCup!.knockoutRounds.at(-1)!.fixtures[0].homeTeamId === worldCupWinner
          ? world.worldCup!.knockoutRounds.at(-1)!.fixtures[0].awayTeamId
          : world.worldCup!.knockoutRounds.at(-1)!.fixtures[0].homeTeamId)
        : undefined,
      promoted: proRelResult.promoted.map((p) => p.teamId),
      relegated: proRelResult.relegated.map((r) => r.teamId),
    },
  };

  const updatedWorld: GameWorld = {
    ...world,
    seasonState,
    teamBases,
    teamStates,
    teamTrophies,
    coachTrophies,
    teamSeasonRecords,
    honorHistory,
    newsLog: [...world.newsLog, ...news],
    rngState: rng.getState(),
  };

  // Check for world cup year
  if (seasonState.isWorldCupYear) {
    return initializeWorldCup(updatedWorld);
  }

  // Otherwise, start next season
  return initializeNewSeason(updatedWorld);
}

/**
 * Initialize the world cup phase after a world cup year season ends.
 */
function initializeWorldCup(world: GameWorld): GameWorld {
  const seasonNumber = world.seasonState.seasonNumber;
  const rng = new SeededRNG(world.rngState);

  // Select participants: top 16 teams by overall
  const allTeamIds = getAllTeamIds(world.teamStates);
  const teamOveralls: Record<string, number> = {};
  for (const id of allTeamIds) {
    teamOveralls[id] = world.teamBases[id]?.overall ?? 0;
  }
  const participants = selectWorldCupParticipants(allTeamIds, teamOveralls);

  // Initialize world cup
  const worldCup = initWorldCup(participants, seasonNumber, rng);

  // Get group fixtures for all 6 rounds
  const groupRoundFixtures: import('../../types/cup').CupFixture[][] = [];
  for (let r = 1; r <= 6; r++) {
    const roundFixtures: import('../../types/cup').CupFixture[] = [];
    for (const group of worldCup.groups) {
      for (const fixture of group.fixtures) {
        if (fixture.round === r) {
          roundFixtures.push(fixture);
        }
      }
    }
    groupRoundFixtures.push(roundFixtures);
  }

  // Append world cup windows to the calendar
  const calendar = appendWorldCupWindows(
    world.seasonState.calendar,
    seasonNumber,
    groupRoundFixtures,
  );

  // Update season state to continue into world cup phase
  const seasonState: SeasonState = {
    ...world.seasonState,
    calendar,
    completed: false,
    worldCupPhase: true,
    // Reset current window to the first world cup window
    currentWindowIndex: world.seasonState.calendar.length, // starts at first new window
  };

  return {
    ...world,
    seasonState,
    worldCup,
    rngState: rng.getState(),
  };
}

/**
 * Check if the entire season (including potential world cup) is complete.
 */
export function isSeasonFullyComplete(world: GameWorld): boolean {
  const { calendar } = world.seasonState;
  return calendar.every((w) => w.completed);
}

/**
 * Determine if a team was eliminated in a knockout match.
 */
function isTeamEliminated(teamId: string, result: MatchResult): boolean {
  const homeGoalsTotal = result.homeGoals + (result.etHomeGoals ?? 0);
  const awayGoalsTotal = result.awayGoals + (result.etAwayGoals ?? 0);

  let winnerId: string;
  if (homeGoalsTotal !== awayGoalsTotal) {
    winnerId = homeGoalsTotal > awayGoalsTotal ? result.homeTeamId : result.awayTeamId;
  } else if (result.penalties && result.penaltyHome != null && result.penaltyAway != null) {
    winnerId = result.penaltyHome > result.penaltyAway ? result.homeTeamId : result.awayTeamId;
  } else {
    winnerId = result.homeTeamId;
  }

  return winnerId !== teamId;
}

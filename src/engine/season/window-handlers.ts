import { SeasonState, CalendarWindow } from '../../types/season';
import { TeamBase, TeamState } from '../../types/team';
import { MatchResult, MatchFixture } from '../../types/match';
import { StandingEntry } from '../../types/league';
import { CupState, SuperCupState, WorldCupState, ContinentalCupState, CupFixture } from '../../types/cup';
import { simulateMatch, SimulationContext } from '../match/simulator';
import { SeededRNG } from '../match/rng';
import { applyMatchStateChanges } from '../state-updater';
import { updateStandings } from '../standings/standings';
import { determinePromotionRelegation, applyPlayoffResults } from '../standings/promotion-relegation';
import { advanceLeagueCup, getLeagueCupCurrentFixtures } from '../cups/league-cup';
import { getSuperCupGroupFixtures, updateSuperCupGroupStandings, completeSuperCupGroupStage, advanceSuperCupKnockout } from '../cups/super-cup';
import { updateWorldCupGroupStandings, completeWorldCupGroupStage, advanceWorldCupKnockout } from '../cups/world-cup';
import { advanceContinentalCup, getContinentalCupCurrentFixtures } from '../cups/continental-cup';
import { buildSimulationContext, countCompletedSuperCupGroupWindows, createNewsId } from './helpers';
import { GameWorld, NewsItem } from './season-manager';

// ── Public interface ────────────────────────────────────────────────

export interface WindowResult {
  results: MatchResult[];
  teamsPlayed: Set<string>;
  teamStates: Record<string, TeamState>;
  news: NewsItem[];
  league1Standings?: StandingEntry[];
  league2Standings?: StandingEntry[];
  league3Standings?: StandingEntry[];
  leagueCup?: CupState;
  superCup?: SuperCupState;
  worldCup?: WorldCupState | null;
  continentalCups?: GameWorld['continentalCups'];
  windowFixtures?: MatchFixture[];
}

// ── Shared simulation loop ──────────────────────────────────────────

/**
 * Simulate a batch of fixtures: build context, run simulation, apply state changes.
 * Does NOT apply coach pressure changes — those are handled separately.
 */
export function simulateFixtures(
  fixtures: MatchFixture[],
  world: GameWorld,
  teamStates: Record<string, TeamState>,
  rng: SeededRNG,
  isKnockout: boolean,
): { results: MatchResult[]; teamsPlayed: Set<string>; teamStates: Record<string, TeamState> } {
  const results: MatchResult[] = [];
  const teamsPlayed = new Set<string>();

  for (const fixture of fixtures) {
    const ctx = buildSimulationContext(fixture, { ...world, teamStates }, rng);
    ctx.isKnockout = isKnockout;
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

  return { results, teamsPlayed, teamStates };
}

// ── Window-type handlers ────────────────────────────────────────────

export function handleLeague(
  world: GameWorld,
  window: CalendarWindow,
  teamStates: Record<string, TeamState>,
  seasonState: SeasonState,
  rng: SeededRNG,
  league1Standings: StandingEntry[],
  league2Standings: StandingEntry[],
  league3Standings: StandingEntry[],
): WindowResult {
  const fixtures = window.fixtures;
  const sim = simulateFixtures(fixtures, world, teamStates, rng, false);

  // Update standings by league level
  const l1Results = sim.results.filter((r) => r.competitionName === '顶级联赛');
  const l2Results = sim.results.filter((r) => r.competitionName === '甲级联赛');
  const l3Results = sim.results.filter((r) => r.competitionName === '乙级联赛');

  let updatedL1 = league1Standings;
  let updatedL2 = league2Standings;
  let updatedL3 = league3Standings;

  if (l1Results.length > 0) updatedL1 = updateStandings(league1Standings, l1Results);
  if (l2Results.length > 0) updatedL2 = updateStandings(league2Standings, l2Results);
  if (l3Results.length > 0) updatedL3 = updateStandings(league3Standings, l3Results);

  return {
    results: sim.results,
    teamsPlayed: sim.teamsPlayed,
    teamStates: sim.teamStates,
    news: [],
    league1Standings: updatedL1,
    league2Standings: updatedL2,
    league3Standings: updatedL3,
  };
}

export function handleLeagueCup(
  world: GameWorld,
  window: CalendarWindow,
  teamStates: Record<string, TeamState>,
  seasonState: SeasonState,
  rng: SeededRNG,
  leagueCup: CupState,
): WindowResult {
  const cupFixtures = getLeagueCupCurrentFixtures(leagueCup);
  const matchFixtures: MatchFixture[] = cupFixtures.map((cf) => ({
    id: cf.id,
    homeTeamId: cf.homeTeamId,
    awayTeamId: cf.awayTeamId,
    competitionType: 'league_cup' as const,
    competitionName: '联赛杯',
    roundLabel: cf.roundName,
  }));

  const sim = simulateFixtures(matchFixtures, world, teamStates, rng, true);

  // Advance the cup
  const updatedCup = advanceLeagueCup(leagueCup, sim.results);

  // Update the window's fixtures for display
  window.fixtures = matchFixtures;

  // Populate NEXT league cup window with the new round's fixtures
  if (!updatedCup.completed) {
    const nextLCWindow = seasonState.calendar.find(
      (w) => w.type === 'league_cup' && !w.completed && w.id !== window.id,
    );
    if (nextLCWindow && nextLCWindow.fixtures.length === 0) {
      const nextCupFixtures = getLeagueCupCurrentFixtures(updatedCup);
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

  return {
    results: sim.results,
    teamsPlayed: sim.teamsPlayed,
    teamStates: sim.teamStates,
    news: [],
    leagueCup: updatedCup,
    windowFixtures: matchFixtures,
  };
}

export function handleSuperCupGroup(
  world: GameWorld,
  window: CalendarWindow,
  teamStates: Record<string, TeamState>,
  seasonState: SeasonState,
  rng: SeededRNG,
  superCup: SuperCupState,
): WindowResult {
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

  const sim = simulateFixtures(matchFixtures, world, teamStates, rng, false);

  // Update group standings
  let updatedSuperCup = updateSuperCupGroupStandings(superCup, sim.results);

  // If this is group round 6, complete group stage and populate knockout fixtures
  if (groupRound === 6) {
    updatedSuperCup = completeSuperCupGroupStage(updatedSuperCup, rng);

    // Populate QF L1 and QF L2 knockout windows with fixtures
    const qfL1Round = updatedSuperCup.knockoutRounds.find((r) => r.roundName === 'QF-L1');
    const qfL2Round = updatedSuperCup.knockoutRounds.find((r) => r.roundName === 'QF-L2');

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

  return {
    results: sim.results,
    teamsPlayed: sim.teamsPlayed,
    teamStates: sim.teamStates,
    news: [],
    superCup: updatedSuperCup,
    windowFixtures: matchFixtures,
  };
}

export function handleSuperCup(
  world: GameWorld,
  window: CalendarWindow,
  teamStates: Record<string, TeamState>,
  seasonState: SeasonState,
  rng: SeededRNG,
  superCup: SuperCupState,
): WindowResult {
  // Find the current incomplete knockout round
  const currentKOIdx = superCup.knockoutRounds.findIndex((r) => !r.completed);
  if (currentKOIdx === -1) {
    return { results: [], teamsPlayed: new Set(), teamStates, news: [] };
  }
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

  const sim = simulateFixtures(matchFixtures, world, teamStates, rng, isFinal);

  // Advance the knockout
  const updatedSuperCup = advanceSuperCupKnockout(superCup, sim.results, rng);

  // After advancing, populate the next window's fixtures if new rounds were created
  const nextKOIdx = updatedSuperCup.knockoutRounds.findIndex((r) => !r.completed);
  if (nextKOIdx !== -1) {
    const nextKORound = updatedSuperCup.knockoutRounds[nextKOIdx];
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

  return {
    results: sim.results,
    teamsPlayed: sim.teamsPlayed,
    teamStates: sim.teamStates,
    news: [],
    superCup: updatedSuperCup,
    windowFixtures: matchFixtures,
  };
}

export function handleRelegationPlayoff(
  world: GameWorld,
  window: CalendarWindow,
  teamStates: Record<string, TeamState>,
  seasonState: SeasonState,
  rng: SeededRNG,
  league1Standings: StandingEntry[],
  league2Standings: StandingEntry[],
  league3Standings: StandingEntry[],
): WindowResult {
  const seasonNumber = seasonState.seasonNumber;
  const windowIndex = seasonState.currentWindowIndex;
  const news: NewsItem[] = [];

  const proRelResult = determinePromotionRelegation(
    league1Standings,
    league2Standings,
    league3Standings,
    seasonNumber,
  );

  const playoffFixtures = proRelResult.playoffFixtures;

  // Populate the window's fixtures for Dashboard display
  window.fixtures = playoffFixtures;

  const sim = simulateFixtures(playoffFixtures, world, teamStates, rng, true);

  // Apply playoff outcomes
  const finalProRel = applyPlayoffResults(proRelResult, sim.results);

  // Apply league level changes to team states
  for (const p of finalProRel.promoted) {
    sim.teamStates[p.teamId] = {
      ...sim.teamStates[p.teamId],
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
    sim.teamStates[r.teamId] = {
      ...sim.teamStates[r.teamId],
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

  return {
    results: sim.results,
    teamsPlayed: sim.teamsPlayed,
    teamStates: sim.teamStates,
    news,
    windowFixtures: playoffFixtures,
  };
}

export function handleWorldCupGroup(
  world: GameWorld,
  window: CalendarWindow,
  teamStates: Record<string, TeamState>,
  seasonState: SeasonState,
  rng: SeededRNG,
  worldCup: WorldCupState,
): WindowResult {
  // Determine which group round this is
  const completedWCGroupWindows = seasonState.calendar.filter(
    (w) => w.type === 'world_cup_group' && w.completed,
  ).length;
  const groupRound = completedWCGroupWindows + 1;

  // World cup groups have the same shape as super cup groups, but we extract
  // fixtures directly from worldCup.groups below — no need to massage state.
  const wcGroupFixtures: CupFixture[] = [];
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

  const sim = simulateFixtures(matchFixtures, world, teamStates, rng, false);

  let updatedWorldCup = updateWorldCupGroupStandings(worldCup, sim.results);

  // If group round 6, complete group stage
  if (groupRound === 6) {
    updatedWorldCup = completeWorldCupGroupStage(updatedWorldCup, rng);

    // Populate next world_cup knockout window with R16 fixtures
    const r16Round = updatedWorldCup.knockoutRounds.find((r) => r.roundName === 'R16');
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

  return {
    results: sim.results,
    teamsPlayed: sim.teamsPlayed,
    teamStates: sim.teamStates,
    news: [],
    worldCup: updatedWorldCup,
    windowFixtures: matchFixtures,
  };
}

export function handleWorldCup(
  world: GameWorld,
  window: CalendarWindow,
  teamStates: Record<string, TeamState>,
  seasonState: SeasonState,
  rng: SeededRNG,
  worldCup: WorldCupState,
): WindowResult {
  const currentKOIdx = worldCup.knockoutRounds.findIndex((r) => !r.completed);
  if (currentKOIdx === -1) {
    return { results: [], teamsPlayed: new Set(), teamStates, news: [] };
  }
  const currentKORound = worldCup.knockoutRounds[currentKOIdx];

  const matchFixtures: MatchFixture[] = currentKORound.fixtures.map((cf) => ({
    id: cf.id,
    homeTeamId: cf.homeTeamId,
    awayTeamId: cf.awayTeamId,
    competitionType: 'world_cup' as const,
    competitionName: '环球冠军杯',
    roundLabel: cf.roundName,
  }));

  const sim = simulateFixtures(matchFixtures, world, teamStates, rng, true);

  const updatedWorldCup = advanceWorldCupKnockout(worldCup, sim.results, rng);

  // Populate next knockout window if available
  const nextKOIdx = updatedWorldCup.knockoutRounds.findIndex((r) => !r.completed);
  if (nextKOIdx !== -1) {
    const nextKORound = updatedWorldCup.knockoutRounds[nextKOIdx];
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

  return {
    results: sim.results,
    teamsPlayed: sim.teamsPlayed,
    teamStates: sim.teamStates,
    news: [],
    worldCup: updatedWorldCup,
    windowFixtures: matchFixtures,
  };
}

// ── Dispatcher ──────────────────────────────────────────────────────

/**
 * Continental cup window — advances all three continental cups (大陆/南洲/东洲)
 * in parallel. Cups are disjoint by team so a single window can play matches
 * across all three without conflict.
 *
 * Round 1 (R16) only the 16-team mainland cup plays — the smaller 8-team
 * cups don't have an R16. From round 2 onward all three cups play QF / SF /
 * Final on the same window.
 */
export function handleContinentalCup(
  world: GameWorld,
  window: CalendarWindow,
  teamStates: Record<string, TeamState>,
  seasonState: SeasonState,
  rng: SeededRNG,
  continentalCups: GameWorld['continentalCups'],
): WindowResult {
  // Collect this round's fixtures across all three cups (those that still have an active round)
  const allCupFixtures: { cup: ContinentalCupState; fixtures: CupFixture[] }[] = [];
  for (const key of ['mainland_cup', 'southern_cup', 'eastern_cup'] as const) {
    const cup = continentalCups[key];
    if (!cup || cup.completed) continue;
    const fixtures = getContinentalCupCurrentFixtures(cup);
    if (fixtures.length > 0) {
      allCupFixtures.push({ cup, fixtures });
    }
  }

  if (allCupFixtures.length === 0) {
    // Nothing to play (e.g. all cups completed) — mark window done with no
    // matches. This also covers the (illegal) case of even-season pollution.
    window.fixtures = [];
    return { results: [], teamsPlayed: new Set(), teamStates, news: [] };
  }

  // Build a unified MatchFixture list and remember which cup each belongs to
  const matchFixtures: MatchFixture[] = [];
  const fixtureCupMap = new Map<string, ContinentalCupState>();
  for (const { cup, fixtures } of allCupFixtures) {
    for (const cf of fixtures) {
      matchFixtures.push({
        id: cf.id,
        homeTeamId: cf.homeTeamId,
        awayTeamId: cf.awayTeamId,
        competitionType: 'continental_cup' as const,
        competitionName: cup.name,
        roundLabel: cf.roundName,
      });
      fixtureCupMap.set(cf.id, cup);
    }
  }

  const sim = simulateFixtures(matchFixtures, world, teamStates, rng, true);

  // Group results by cup and advance each cup independently
  const updatedCups: GameWorld['continentalCups'] = { ...continentalCups };
  for (const { cup, fixtures } of allCupFixtures) {
    const ids = new Set(fixtures.map((f) => f.id));
    const cupResults = sim.results.filter((r) => ids.has(r.fixtureId));
    const advanced = advanceContinentalCup(cup, cupResults);
    if (cup.type === 'mainland_cup') updatedCups.mainland_cup = advanced;
    else if (cup.type === 'southern_cup') updatedCups.southern_cup = advanced;
    else if (cup.type === 'eastern_cup') updatedCups.eastern_cup = advanced;
  }

  window.fixtures = matchFixtures;

  return {
    results: sim.results,
    teamsPlayed: sim.teamsPlayed,
    teamStates: sim.teamStates,
    news: [],
    continentalCups: updatedCups,
    windowFixtures: matchFixtures,
  };
}

/**
 * Dispatch the current window to the appropriate handler based on window.type.
 */
export function dispatchWindow(
  world: GameWorld,
  window: CalendarWindow,
  teamStates: Record<string, TeamState>,
  seasonState: SeasonState,
  rng: SeededRNG,
  league1Standings: StandingEntry[],
  league2Standings: StandingEntry[],
  league3Standings: StandingEntry[],
  leagueCup: CupState,
  superCup: SuperCupState,
  worldCup: WorldCupState | null,
  continentalCups: GameWorld['continentalCups'],
): WindowResult {
  switch (window.type) {
    case 'league':
      return handleLeague(world, window, teamStates, seasonState, rng, league1Standings, league2Standings, league3Standings);
    case 'league_cup':
      return handleLeagueCup(world, window, teamStates, seasonState, rng, leagueCup);
    case 'super_cup_group':
      return handleSuperCupGroup(world, window, teamStates, seasonState, rng, superCup);
    case 'super_cup':
      return handleSuperCup(world, window, teamStates, seasonState, rng, superCup);
    case 'continental_cup':
      return handleContinentalCup(world, window, teamStates, seasonState, rng, continentalCups);
    case 'relegation_playoff':
      return handleRelegationPlayoff(world, window, teamStates, seasonState, rng, league1Standings, league2Standings, league3Standings);
    case 'world_cup_group':
      if (!worldCup) return { results: [], teamsPlayed: new Set(), teamStates, news: [] };
      return handleWorldCupGroup(world, window, teamStates, seasonState, rng, worldCup);
    case 'world_cup':
      if (!worldCup) return { results: [], teamsPlayed: new Set(), teamStates, news: [] };
      return handleWorldCup(world, window, teamStates, seasonState, rng, worldCup);
    default:
      return { results: [], teamsPlayed: new Set(), teamStates, news: [] };
  }
}

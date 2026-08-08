import { describe, it, expect } from 'vitest';
import {
  initializeGameWorld,
  initializeNewSeason,
  executeCurrentWindow,
  getCurrentWindow,
  type NewsItem,
} from './season-manager';
import { defaultTeams } from '../../config/teams';
import { playerTeamStatKey } from '../players/stats';
import { validateWorldData } from '../validation/world-data';
import type { StandingEntry } from '../../types/league';
import type { TeamBase } from '../../types/team';
import type { PlayerRetirement } from '../../types/player';
import type { Storyline } from './storylines';

function makeCustomTeams(): TeamBase[] {
  return defaultTeams.map((team, idx) => ({
    ...team,
    id: `custom_${idx}`,
    name: `自定义${idx}`,
    shortName: `C${idx}`,
  }));
}

function makeStanding(teamId: string): StandingEntry {
  return {
    teamId,
    played: 30,
    won: 18,
    drawn: 6,
    lost: 6,
    goalsFor: 58,
    goalsAgainst: 24,
    goalDifference: 34,
    points: 60,
    form: [],
  };
}

describe('initializeGameWorld', () => {
  it('returns a valid world with 32 teams + 36 coaches + non-empty calendar', () => {
    const world = initializeGameWorld(2024);

    expect(Object.keys(world.teamBases)).toHaveLength(32);
    expect(Object.keys(world.teamStates)).toHaveLength(32);
    expect(Object.keys(world.coachBases)).toHaveLength(36);
    expect(Object.keys(world.coachStates)).toHaveLength(36);

    // Calendar built and non-empty
    expect(world.seasonState).toBeTruthy();
    expect(world.seasonState.seasonNumber).toBe(1);
    expect(world.seasonState.calendar.length).toBeGreaterThan(0);
    expect(world.seasonState.currentWindowIndex).toBe(0);
    expect(world.seasonState.completed).toBe(false);

    // Cups initialised
    expect(world.leagueCup.type).toBe('league_cup');
    expect(world.leagueCup.rounds).toHaveLength(1);
    expect(world.superCup.groups).toHaveLength(4);

    // Squads exist for every team
    for (const teamId of Object.keys(world.teamBases)) {
      expect(world.squads[teamId]).toBeTruthy();
      expect(world.squads[teamId].length).toBeGreaterThan(0);
    }
    expect(Object.keys(world.playerStats).length).toBeGreaterThan(0);
    expect(Object.keys(world.playerStatSegments ?? {}).length).toBe(Object.keys(world.playerStats).length);
  });

  it('is deterministic for a fixed seed', () => {
    const a = initializeGameWorld(2024);
    const b = initializeGameWorld(2024);
    expect(a.seasonState.calendar.length).toBe(b.seasonState.calendar.length);
    expect(Object.keys(a.squads).sort()).toEqual(Object.keys(b.squads).sort());
    // Same number of fixtures in the league cup
    expect(a.leagueCup.rounds[0].fixtures.length).toBe(b.leagueCup.rounds[0].fixtures.length);
  });

  it('schedules group-based continental cups in S5 and every six seasons', () => {
    let world = initializeGameWorld(2024);
    for (let season = 1; season <= 4; season++) {
      expect(Object.values(world.continentalCups).every(cup => cup === null)).toBe(true);
      expect(world.seasonState.calendar.filter(window => window.type === 'continental_cup')).toHaveLength(0);
      world = initializeNewSeason(world);
    }

    expect(world.seasonState.seasonNumber).toBe(5);
    expect(world.continentalCups.mainland_cup?.groups).toHaveLength(4);
    expect(world.continentalCups.southern_cup?.groups).toHaveLength(2);
    expect(world.continentalCups.eastern_cup?.groups).toHaveLength(2);
    expect(world.seasonState.calendar.filter(window => window.type === 'continental_cup')).toHaveLength(6);
    const continentalParticipants = Object.values(world.continentalCups)
      .flatMap(cup => cup?.participantIds ?? []);
    expect(new Set(continentalParticipants)).toEqual(new Set(Object.keys(world.teamBases)));

    let firstContinentalWindow = world;
    while (getCurrentWindow(firstContinentalWindow)?.type !== 'continental_cup') {
      firstContinentalWindow = executeCurrentWindow(firstContinentalWindow).world;
    }
    const continentalRound = executeCurrentWindow(firstContinentalWindow);
    expect(continentalRound.results).toHaveLength(16);
    expect(continentalRound.results.every(result => result.isNeutralVenue)).toBe(true);
    expect(continentalRound.results.every(result =>
      result.prediction?.factors?.every(factor => factor.source !== 'home_advantage'),
    )).toBe(true);

    const seasonSix = initializeNewSeason(world);
    expect(Object.values(seasonSix.continentalCups).every(cup => cup === null)).toBe(true);
    const seasonEleven = initializeNewSeason({
      ...seasonSix,
      seasonState: { ...seasonSix.seasonState, seasonNumber: 10 },
    });
    expect(seasonEleven.continentalCups.mainland_cup).not.toBeNull();
    expect(seasonEleven.seasonState.isWorldCupYear).toBe(false);
  });

  it('completes the all-region continental format before season settlement', () => {
    const seasonOne = initializeGameWorld(20260808);
    let world = initializeNewSeason({
      ...seasonOne,
      seasonState: { ...seasonOne.seasonState, seasonNumber: 4 },
    });
    let safety = 0;
    while (getCurrentWindow(world)?.type !== 'season_end' && safety < 100) {
      world = executeCurrentWindow(world).world;
      safety += 1;
    }

    expect(safety).toBeLessThan(100);
    expect(world.continentalCups.mainland_cup).toMatchObject({ completed: true });
    expect(world.continentalCups.southern_cup).toMatchObject({ completed: true });
    expect(world.continentalCups.eastern_cup).toMatchObject({ completed: true });
    expect(world.continentalCups.mainland_cup?.rounds.map(round => round.roundName)).toEqual(['QF', 'SF', 'Final']);
    expect(world.continentalCups.southern_cup?.rounds.map(round => round.roundName)).toEqual(['SF', 'Final']);
    expect(world.continentalCups.eastern_cup?.rounds.map(round => round.roundName)).toEqual(['SF', 'Final']);
    expect(validateWorldData(world).errors).toEqual([]);
  });

  it('does not reserve empty continental windows when custom regions have no eligible cup', () => {
    const seasonOne = initializeGameWorld(2024, {
      gameMode: 'sandbox',
      customTeams: makeCustomTeams().map(team => ({ ...team, region: '自定义洲+地区' })),
    });
    const seasonFive = initializeNewSeason({
      ...seasonOne,
      seasonState: { ...seasonOne.seasonState, seasonNumber: 4 },
    });

    expect(Object.values(seasonFive.continentalCups).every(cup => cup === null)).toBe(true);
    expect(seasonFive.seasonState.calendar.filter(window => window.type === 'continental_cup')).toHaveLength(0);
  });

  it('generates squads and player stats from custom final teams', () => {
    const customTeams = makeCustomTeams();
    const customIds = customTeams.map((team) => team.id).sort();
    const world = initializeGameWorld(2024, { gameMode: 'sandbox', customTeams });

    expect(Object.keys(world.teamBases).sort()).toEqual(customIds);
    expect(Object.keys(world.teamStates).sort()).toEqual(customIds);
    expect(Object.keys(world.squads).sort()).toEqual(customIds);

    for (const teamId of customIds) {
      expect(world.squads[teamId]).toHaveLength(22);
      for (const player of world.squads[teamId]) {
        expect(player.teamId).toBe(teamId);
        expect(world.playerStats[player.uuid]?.teamId).toBe(teamId);
        expect(world.playerStatSegments?.[playerTeamStatKey(player.uuid, teamId)]?.teamId).toBe(teamId);
      }
    }

    for (const defaultTeam of defaultTeams) {
      expect(world.squads[defaultTeam.id]).toBeUndefined();
    }
  });

  it('snapshots frozen player identity before resetting a new season', () => {
    const world = initializeGameWorld(2024);
    const [teamId, squad] = Object.entries(world.squads)[0];
    const player = squad.find((p) => p.position === 'FW') ?? squad[0];
    const playerStats = {
      ...world.playerStats,
      [player.uuid]: {
        ...world.playerStats[player.uuid],
        goals: 16,
        assists: 7,
        appearances: 24,
        starts: 24,
        minutesPlayed: 2160,
        teamMatchesAllCompetitions: 24,
        yellowCards: 2,
        redCards: 0,
        bigChances: 20,
        keyPasses: 9,
      },
    };

    const next = initializeNewSeason({
      ...world,
      playerStats,
      league1Standings: world.league1Standings.map((row) => row.teamId === teamId ? makeStanding(teamId) : row),
      league2Standings: world.league2Standings.map((row) => row.teamId === teamId ? makeStanding(teamId) : row),
      league3Standings: world.league3Standings.map((row) => row.teamId === teamId ? makeStanding(teamId) : row),
    });

    const history = next.playerStatsHistory[player.uuid]?.find((entry) => entry.season === 1);
    expect(history).toBeDefined();
    expect(history?.playerName).toBe(player.name);
    expect(history?.playerNumber).toBe(player.number);
    expect(history?.teamName).toBe(world.teamBases[teamId].name);
    expect(history?.teamShortName).toBe(world.teamBases[teamId].shortName);
    expect(history?.teamLeagueLevel).toBe(1);
    expect(history?.teamLeaguePosition).toBeGreaterThan(0);
    expect(history?.teamGoalsFor).toBe(58);
    expect(history?.teamGoalsAgainst).toBe(24);
    expect(history?.teamPoints).toBe(60);
    expect(history?.rating).toBe(player.rating);
    expect(history?.age).toBe(player.age);
    expect(history?.goals).toBe(16);
    expect(history?.seasonScore).toBeGreaterThan(0);
    expect(history?.seasonScore).toBeLessThanOrEqual(100);
    expect(history?.positionQuality).toBeGreaterThanOrEqual(0);
    expect(history?.availabilityScore).toBeGreaterThanOrEqual(0);
    expect(history?.scoreConfidence).toBeGreaterThan(0);
    expect(history?.scoreVersion).toBe(1);
    expect(next.playerStats[player.uuid].goals).toBe(0);
  });

  it('snapshots a just-retired player even after they leave the active squad', () => {
    const world = initializeGameWorld(2024);
    const [teamId, squad] = Object.entries(world.squads)[0];
    const player = squad.find((p) => p.position === 'FW') ?? squad[0];
    const retired: PlayerRetirement = {
      uuid: player.uuid,
      name: player.name,
      teamId,
      teamName: world.teamBases[teamId].name,
      position: player.position,
      peakRating: player.peakRating,
      age: player.age,
      seasonRetired: world.seasonState.seasonNumber,
      careerGoals: 23,
    };
    const playerStats = {
      ...world.playerStats,
      [player.uuid]: {
        ...world.playerStats[player.uuid],
        goals: 6,
        assists: 3,
        appearances: 14,
        bigChances: 8,
        keyPasses: 4,
      },
    };

    const next = initializeNewSeason({
      ...world,
      squads: {
        ...world.squads,
        [teamId]: squad.filter((p) => p.uuid !== player.uuid),
      },
      playerStats,
      retirementHistory: [...world.retirementHistory, retired],
      league1Standings: world.league1Standings.map((row) => row.teamId === teamId ? makeStanding(teamId) : row),
      league2Standings: world.league2Standings.map((row) => row.teamId === teamId ? makeStanding(teamId) : row),
      league3Standings: world.league3Standings.map((row) => row.teamId === teamId ? makeStanding(teamId) : row),
    });

    const history = next.playerStatsHistory[player.uuid]?.find((entry) => entry.season === 1);
    expect(history).toBeDefined();
    expect(history?.playerName).toBe(player.name);
    expect(history?.position).toBe(player.position);
    expect(history?.goals).toBe(6);
    expect(next.playerStats[player.uuid]).toBeUndefined();
  });

  it('isolates squad ownership while resetting offseason injuries and suspensions', () => {
    const initial = initializeGameWorld(20260730);
    const [teamId, originalSquad] = Object.entries(initial.squads)[0];
    const [shortAbsence, longAbsence] = originalSquad;
    const input = {
      ...initial,
      squads: {
        ...initial.squads,
        [teamId]: originalSquad.map(player => {
          if (player.uuid === shortAbsence.uuid) {
            return {
              ...player,
              injuredUntilWindow: 999,
              suspendedUntilWindow: 999,
              injuryHistory: [{
                type: 'major' as const,
                startSeason: 1,
                startWindow: 1,
                durationMatches: 10,
                reason: '膝伤',
              }],
              suspensionHistory: [{
                startSeason: 1,
                startWindow: 2,
                unavailableFromWindow: 3,
                suspendedUntilWindow: 5,
                banWindows: 2,
                reason: 'red_cards' as const,
              }],
            };
          }
          if (player.uuid === longAbsence.uuid) {
            return {
              ...player,
              injuredUntilWindow: 999,
              suspendedUntilWindow: 999,
              injuryHistory: [{
                type: 'long_term' as const,
                startSeason: 1,
                startWindow: 1,
                durationMatches: 30,
                reason: '十字韧带断裂',
              }],
            };
          }
          return player;
        }),
      },
    };
    const before = structuredClone(input);
    const sourceShort = input.squads[teamId].find(player => player.uuid === shortAbsence.uuid)!;
    const sourceLong = input.squads[teamId].find(player => player.uuid === longAbsence.uuid)!;

    const next = initializeNewSeason(input);
    const repeated = initializeNewSeason(structuredClone(before));
    const nextShort = next.squads[teamId].find(player => player.uuid === shortAbsence.uuid)!;
    const nextLong = next.squads[teamId].find(player => player.uuid === longAbsence.uuid)!;

    expect(input).toEqual(before);
    expect(next.squads).not.toBe(input.squads);
    expect(next.squads[teamId]).not.toBe(input.squads[teamId]);
    expect(nextShort).not.toBe(sourceShort);
    expect(nextLong).not.toBe(sourceLong);
    expect(nextShort.injuryHistory).not.toBe(sourceShort.injuryHistory);
    expect(nextShort.suspensionHistory).not.toBe(sourceShort.suspensionHistory);
    expect(nextShort.injuredUntilWindow).toBe(0);
    expect(nextShort.suspendedUntilWindow).toBe(0);
    expect(nextLong.injuredUntilWindow).toBe(999);
    expect(nextLong.suspendedUntilWindow).toBe(0);
    expect(next.rngState).toEqual(repeated.rngState);
    expect(next.seasonState.calendar).toEqual(repeated.seasonState.calendar);
    expect(next.squads).toEqual(repeated.squads);
  });
});

describe('executeCurrentWindow', () => {
  it('advances state and produces results for the first window', () => {
    let world = initializeGameWorld(2024);
    const initialIdx = world.seasonState.currentWindowIndex;
    const initialWindow = getCurrentWindow(world);
    expect(initialWindow).toBeTruthy();

    const out = executeCurrentWindow(world);
    world = out.world;

    expect(world.seasonState.currentWindowIndex).toBe(initialIdx + 1);
    // The previous window is now marked completed
    expect(world.seasonState.calendar[initialIdx].completed).toBe(true);
    // Returned results are an array (might be empty for pre-season-style windows)
    expect(Array.isArray(out.results)).toBe(true);
  });

  it('does not mutate the input world or its player objects', () => {
    const world = initializeGameWorld(20260729);
    const before = structuredClone(world);
    const firstTeamId = Object.keys(world.squads)[0];

    const out = executeCurrentWindow(world);

    expect(world).toEqual(before);
    expect(out.world).not.toBe(world);
    expect(out.world.squads).not.toBe(world.squads);
    expect(out.world.squads[firstTeamId]).not.toBe(world.squads[firstTeamId]);
    expect(out.world.squads[firstTeamId][0]).not.toBe(world.squads[firstTeamId][0]);
  });

  it('smoke test: advance 5 windows in sequence; world stays consistent and index increments', () => {
    let world = initializeGameWorld(2024);
    const startIdx = world.seasonState.currentWindowIndex;

    for (let i = 0; i < 5; i++) {
      // Stop if season is already complete (calendar exhausted)
      if (world.seasonState.completed) break;
      const before = world.seasonState.currentWindowIndex;
      const out = executeCurrentWindow(world);
      world = out.world;
      // Index should increment by exactly 1 (or we hit a season-end pivot that
      // re-initialises a new season at index 0).
      const after = world.seasonState.currentWindowIndex;
      const sameSeasonStep = after === before + 1;
      const newSeasonRollover = after === 0;
      expect(sameSeasonStep || newSeasonRollover).toBe(true);

      // Calendar always exists
      expect(world.seasonState.calendar.length).toBeGreaterThan(0);
      // Team / coach state maps remain populated
      expect(Object.keys(world.teamBases).length).toBe(32);
      expect(Object.keys(world.coachBases).length).toBe(36);
    }

    // We should have moved at least once (probably 5 times).
    expect(world.seasonState.currentWindowIndex).not.toBe(startIdx);
  });

  it('updates deterministic storylines through the real window execution path', () => {
    let world = initializeGameWorld(20260718);
    const storylineNews: NewsItem[] = [];
    for (let index = 0; index < 12; index++) {
      const result = executeCurrentWindow(world);
      world = result.world;
      storylineNews.push(...result.news.filter(item => item.type === 'storyline'));
    }

    expect((world.activeStorylines?.length ?? 0) + (world.storylineHistory?.length ?? 0)).toBeGreaterThan(0);
    expect(storylineNews.some(item => item.title.includes('故事出现'))).toBe(true);
  });

  it('finalizes active stories before season rollover resets the league tables', () => {
    let world = initializeGameWorld(20260718);
    while (getCurrentWindow(world)?.type !== 'season_end') {
      world = executeCurrentWindow(world).world;
    }
    const teamId = world.league1Standings[0].teamId;
    const forcedStory: Storyline = {
      id: 'forced-season-ending-story',
      type: 'dark_horse',
      teamId,
      seasonNumber: world.seasonState.seasonNumber,
      startedWindow: 4,
      startedElapsedWindow: 4,
      phase: '高潮',
      evidence: ['赛季末构造证据'],
      lastUpdatedWindow: world.seasonState.currentWindowIndex - 1,
      lastUpdatedElapsedWindow: world.totalElapsedWindows,
      quietWindows: 0,
    };
    const historyBefore = world.storylineHistory?.length ?? 0;
    world = { ...world, activeStorylines: [forcedStory] };

    const rollover = executeCurrentWindow(world);

    expect(rollover.world.activeStorylines).toHaveLength(0);
    expect(rollover.world.storylineHistory).toHaveLength(historyBefore + 1);
    expect(rollover.world.storylineHistory?.at(-1)).toMatchObject({
      id: forcedStory.id,
      phase: '落幕',
      outcome: expect.stringMatching(/success|failure/),
    });
    expect(rollover.news.some(item => item.type === 'storyline' && item.title.includes('故事落幕'))).toBe(true);
  });

  it('archives completed-season player identity before annual aging and revaluation', () => {
    let world = initializeGameWorld(2024);
    while (getCurrentWindow(world)?.type !== 'season_end') {
      world = executeCurrentWindow(world).world;
    }
    const player = Object.values(world.squads).flat().find(entry => world.playerStats[entry.uuid]?.appearances > 0)!;
    const finishedIdentity = { age: player.age, rating: player.rating };

    const rollover = executeCurrentWindow(world);
    world = rollover.world;
    const archived = world.playerStatsHistory[player.uuid]?.find(entry => entry.season === 1);

    expect(archived).toMatchObject(finishedIdentity);
    expect(Object.values(world.squads).flat().find(entry => entry.uuid === player.uuid)?.age).toBe(finishedIdentity.age + 1);
    expect(rollover.news.some(item => item.type === 'trophy' && item.importance === 'major')).toBe(true);
  });

  it('does not mutate season-end input while aging players and carrying only long-term injuries', () => {
    let world = initializeGameWorld(20260730);
    while (getCurrentWindow(world)?.type !== 'season_end') {
      world = executeCurrentWindow(world).world;
    }
    const [teamId, squad] = Object.entries(world.squads)[0];
    const [shortAbsence, longAbsence] = squad.filter(player => player.age < 30).slice(0, 2);
    world = {
      ...world,
      squads: {
        ...world.squads,
        [teamId]: squad.map(player => {
          if (player.uuid === shortAbsence.uuid) {
            return {
              ...player,
              injuredUntilWindow: 9999,
              suspendedUntilWindow: 9999,
              injuryHistory: [{
                type: 'major' as const,
                startSeason: 1,
                startWindow: world.totalElapsedWindows,
                durationMatches: 10,
                reason: '膝伤',
              }],
            };
          }
          if (player.uuid === longAbsence.uuid) {
            return {
              ...player,
              injuredUntilWindow: 9999,
              suspendedUntilWindow: 9999,
              injuryHistory: [{
                type: 'long_term' as const,
                startSeason: 1,
                startWindow: world.totalElapsedWindows,
                durationMatches: 30,
                reason: '十字韧带断裂',
              }],
            };
          }
          return player;
        }),
      },
    };
    const before = structuredClone(world);
    const sourceShort = world.squads[teamId].find(player => player.uuid === shortAbsence.uuid)!;
    const sourceLong = world.squads[teamId].find(player => player.uuid === longAbsence.uuid)!;

    const rollover = executeCurrentWindow(world);
    const nextShort = Object.values(rollover.world.squads).flat()
      .find(player => player.uuid === shortAbsence.uuid)!;
    const nextLong = Object.values(rollover.world.squads).flat()
      .find(player => player.uuid === longAbsence.uuid)!;

    expect(world).toEqual(before);
    expect(rollover.world.squads).not.toBe(world.squads);
    expect(nextShort).not.toBe(sourceShort);
    expect(nextLong).not.toBe(sourceLong);
    expect(sourceShort.age).toBe(before.squads[teamId].find(player => player.uuid === shortAbsence.uuid)!.age);
    expect(nextShort.age).toBe(sourceShort.age + 1);
    expect(nextShort.injuredUntilWindow).toBe(0);
    expect(nextShort.suspendedUntilWindow).toBe(0);
    expect(nextLong.injuredUntilWindow).toBe(9999);
    expect(nextLong.suspendedUntilWindow).toBe(0);
  });

  it('refreshes World Cup season stats without replacing the pre-aging identity', () => {
    let world = initializeGameWorld(20260720);
    while (world.seasonState.seasonNumber < 4 || getCurrentWindow(world)?.type !== 'season_end') {
      world = executeCurrentWindow(world).world;
    }
    const identityByPlayer = new Map(Object.values(world.squads).flat().map(player => [
      player.uuid,
      { age: player.age, rating: player.rating },
    ]));
    const domesticInput = world;
    const domesticBefore = structuredClone(domesticInput);
    world = executeCurrentWindow(domesticInput).world;
    expect(domesticInput).toEqual(domesticBefore);
    expect(world.squads).not.toBe(domesticInput.squads);
    expect(world.seasonState.calendar.filter(window => window.type === 'world_cup_group')).toHaveLength(3);
    expect(world.seasonState.calendar.filter(window => window.type === 'world_cup')).toHaveLength(4);
    expect(world.worldCup!.groups.flatMap(group => group.fixtures).every(fixture => fixture.isNeutralVenue)).toBe(true);
    const worldCupTeamId = world.worldCup!.participantIds[0];
    const starter = [...world.squads[worldCupTeamId]].sort((a, b) => b.rating - a.rating)[0];
    const domesticAppearances = world.playerStats[starter.uuid].appearances;

    const firstGroupRound = executeCurrentWindow(world);
    expect(firstGroupRound.results).toHaveLength(16);
    expect(firstGroupRound.results.every(result => result.isNeutralVenue)).toBe(true);
    expect(firstGroupRound.results.every(result =>
      result.prediction?.factors?.every(factor => factor.source !== 'home_advantage'),
    )).toBe(true);
    world = firstGroupRound.world;

    let completionNews = [] as ReturnType<typeof executeCurrentWindow>['news'];
    while (world.seasonState.seasonNumber === 4) {
      const worldCupInput = world;
      const worldCupBefore = structuredClone(worldCupInput);
      const result = executeCurrentWindow(worldCupInput);
      expect(worldCupInput).toEqual(worldCupBefore);
      world = result.world;
      completionNews = result.news;
    }
    const archived = world.playerStatsHistory[starter.uuid]?.find(entry => entry.season === 4);

    expect(archived).toMatchObject(identityByPlayer.get(starter.uuid)!);
    expect(archived!.appearances).toBeGreaterThan(domesticAppearances);
    expect(completionNews.some(item => item.title.includes('环球冠军杯冠军') && item.importance === 'major')).toBe(true);
  });

  it('long smoke test: advances multiple seasons without validation errors', () => {
    let world = initializeGameWorld(2024);
    let turns = 0;

    while (world.seasonState.seasonNumber < 3 && turns < 220) {
      const out = executeCurrentWindow(world);
      world = out.world;
      turns++;

      const validation = validateWorldData(world);
      expect(validation.errors.map((issue) => issue.code)).toEqual([]);
    }

    expect(world.seasonState.seasonNumber).toBeGreaterThanOrEqual(3);
    expect(turns).toBeLessThan(220);
  });
});

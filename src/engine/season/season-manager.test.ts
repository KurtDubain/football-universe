import { describe, it, expect } from 'vitest';
import { initializeGameWorld, initializeNewSeason, executeCurrentWindow, getCurrentWindow } from './season-manager';
import { defaultTeams } from '../../config/teams';
import { playerTeamStatKey } from '../players/stats';
import type { StandingEntry } from '../../types/league';
import type { TeamBase } from '../../types/team';

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
    expect(history?.rating).toBe(player.rating);
    expect(history?.age).toBe(player.age);
    expect(history?.goals).toBe(16);
    expect(next.playerStats[player.uuid].goals).toBe(0);
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
});

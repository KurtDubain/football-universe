import { describe, it, expect } from 'vitest';
import {
  advanceWorldCupKnockout,
  completeWorldCupGroupStage,
  initWorldCup,
  updateWorldCupGroupStandings,
} from './world-cup';
import { SeededRNG } from '../match/rng';
import type { CupFixture } from '../../types/cup';
import type { MatchResult } from '../../types/match';

function draw(fixture: CupFixture): MatchResult {
  return {
    fixtureId: fixture.id,
    homeTeamId: fixture.homeTeamId,
    awayTeamId: fixture.awayTeamId,
    homeGoals: 0,
    awayGoals: 0,
    extraTime: false,
    penalties: false,
    events: [],
    stats: {
      possession: [50, 50],
      shots: [0, 0],
      shotsOnTarget: [0, 0],
      corners: [0, 0],
      fouls: [0, 0],
      yellowCards: [0, 0],
      redCards: [0, 0],
    },
    competitionType: 'world_cup_group',
    competitionName: '环球冠军杯',
    roundLabel: fixture.roundName,
    isNeutralVenue: true,
  };
}

describe('initWorldCup', () => {
  it('throws on non-32 inputs', () => {
    expect(() => initWorldCup(['a', 'b'], 1, new SeededRNG(0))).toThrow(/32 teams/);
    expect(() =>
      initWorldCup(Array.from({ length: 31 }, (_, i) => `t${i}`), 1, new SeededRNG(0)),
    ).toThrow(/32 teams/);
  });

  it('creates 8 groups of 4 teams each', () => {
    const teams = Array.from({ length: 32 }, (_, i) => `t${i + 1}`);
    const wc = initWorldCup(teams, 1, new SeededRNG(11));
    expect(wc.groups).toHaveLength(8);
    wc.groups.forEach((g, i) => {
      expect(g.groupName).toBe(String.fromCharCode(65 + i)); // A..H
      expect(g.teamIds).toHaveLength(4);
      expect(g.standings).toHaveLength(4);
    });
    expect(wc.participantIds).toEqual(teams);
    expect(wc.completed).toBe(false);
    expect(wc.groupStageCompleted).toBe(false);
    expect(wc.knockoutRounds).toHaveLength(0);
  });

  it('uses pots: each group has exactly one team from each of the 4 OVR-sorted pots', () => {
    // Participants are already sorted by overall (descending) by selectWorldCupParticipants.
    // initWorldCup slices: pot1=[0..7], pot2=[8..15], pot3=[16..23], pot4=[24..31].
    const teams = Array.from({ length: 32 }, (_, i) => `t${i}`);
    const wc = initWorldCup(teams, 1, new SeededRNG(99));

    const pot1 = new Set(teams.slice(0, 8));
    const pot2 = new Set(teams.slice(8, 16));
    const pot3 = new Set(teams.slice(16, 24));
    const pot4 = new Set(teams.slice(24, 32));

    for (const g of wc.groups) {
      expect(g.teamIds.filter((t) => pot1.has(t)).length).toBe(1);
      expect(g.teamIds.filter((t) => pot2.has(t)).length).toBe(1);
      expect(g.teamIds.filter((t) => pot3.has(t)).length).toBe(1);
      expect(g.teamIds.filter((t) => pot4.has(t)).length).toBe(1);
    }

    // All 32 teams placed exactly once
    const allInGroups = wc.groups.flatMap((g) => g.teamIds);
    expect(new Set(allInGroups).size).toBe(32);
  });

  it('generates one neutral match per pair: 6 fixtures per group, 48 total', () => {
    const teams = Array.from({ length: 32 }, (_, i) => `t${i + 1}`);
    const wc = initWorldCup(teams, 1, new SeededRNG(11), 't32');
    expect(wc.hostTeamId).toBe('t32');
    const total = wc.groups.reduce((s, g) => s + g.fixtures.length, 0);
    expect(total).toBe(48);
    for (const group of wc.groups) {
      expect(group.fixtures).toHaveLength(6);
      expect(group.fixtures.every(fixture => fixture.isNeutralVenue)).toBe(true);
      expect(group.fixtures.every(fixture => fixture.tournamentHostTeamId === 't32')).toBe(true);
      expect(new Set(group.fixtures.map(fixture => fixture.round))).toEqual(new Set([1, 2, 3]));
      const appearances = new Map(group.teamIds.map(teamId => [teamId, 0]));
      const pairs = new Set<string>();
      for (const fixture of group.fixtures) {
        appearances.set(fixture.homeTeamId, appearances.get(fixture.homeTeamId)! + 1);
        appearances.set(fixture.awayTeamId, appearances.get(fixture.awayTeamId)! + 1);
        pairs.add([fixture.homeTeamId, fixture.awayTeamId].sort().join(':'));
      }
      expect([...appearances.values()]).toEqual([3, 3, 3, 3]);
      expect(pairs.size).toBe(6);
    }
  });

  it('completes three neutral group rounds without mutating the input states', () => {
    const teams = Array.from({ length: 32 }, (_, i) => `t${i + 1}`);
    let wc = initWorldCup(teams, 4, new SeededRNG(11), 't32');
    for (let round = 1; round <= 3; round++) {
      const input = wc;
      const before = structuredClone(input);
      const fixtures = wc.groups.flatMap(group =>
        group.fixtures.filter(fixture => fixture.round === round),
      );
      wc = updateWorldCupGroupStandings(input, fixtures.map(draw));
      expect(input).toEqual(before);
    }
    expect(wc.groups.every(group => group.standings.every(entry => entry.played === 3))).toBe(true);

    const completed = completeWorldCupGroupStage(wc, new SeededRNG(11));
    expect(completed.knockoutRounds[0].roundName).toBe('R16');
    expect(completed.knockoutRounds[0].fixtures).toHaveLength(8);
    expect(completed.knockoutRounds[0].fixtures.every(fixture => fixture.isNeutralVenue)).toBe(true);
    expect(completed.knockoutRounds[0].fixtures.every(fixture => fixture.tournamentHostTeamId === 't32')).toBe(true);
  });

  it('rejects partial or unresolved knockout results without favoring a team slot', () => {
    const teams = Array.from({ length: 32 }, (_, i) => `t${i + 1}`);
    let wc = initWorldCup(teams, 4, new SeededRNG(11));
    for (let round = 1; round <= 3; round++) {
      const fixtures = wc.groups.flatMap(group =>
        group.fixtures.filter(fixture => fixture.round === round),
      );
      wc = updateWorldCupGroupStandings(wc, fixtures.map(draw));
    }
    wc = completeWorldCupGroupStage(wc, new SeededRNG(11));
    const before = structuredClone(wc);
    const fixtures = wc.knockoutRounds[0].fixtures;

    expect(() => advanceWorldCupKnockout(wc, [draw(fixtures[0])], new SeededRNG(11)))
      .toThrow(/Missing result/);
    expect(() => advanceWorldCupKnockout(wc, fixtures.map(draw), new SeededRNG(11)))
      .toThrow(/Unresolved knockout result/);
    expect(wc).toEqual(before);
  });
});

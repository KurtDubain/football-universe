import { describe, it, expect } from 'vitest';
import {
  initSuperCup,
  updateSuperCupGroupStandings,
  completeSuperCupGroupStage,
} from './super-cup';
import { SeededRNG } from '../match/rng';
import { MatchResult, MatchStats } from '../../types/match';
import { CupFixture } from '../../types/cup';

const EMPTY_STATS: MatchStats = {
  possession: [50, 50],
  shots: [0, 0],
  shotsOnTarget: [0, 0],
  corners: [0, 0],
  fouls: [0, 0],
  yellowCards: [0, 0],
  redCards: [0, 0],
};

function homeWins(fixture: CupFixture, hg = 1, ag = 0): MatchResult {
  return {
    fixtureId: fixture.id,
    homeTeamId: fixture.homeTeamId,
    awayTeamId: fixture.awayTeamId,
    homeGoals: hg,
    awayGoals: ag,
    extraTime: false,
    penalties: false,
    events: [],
    stats: EMPTY_STATS,
    competitionType: 'super_cup_group',
    competitionName: '超级杯',
    roundLabel: fixture.roundName,
  };
}

describe('initSuperCup', () => {
  it('throws on non-16 inputs', () => {
    expect(() => initSuperCup(['a', 'b'], 1, new SeededRNG(0), false)).toThrow(/16 teams/);
    expect(() =>
      initSuperCup(
        Array.from({ length: 15 }, (_, i) => `t${i}`),
        1,
        new SeededRNG(0),
        false,
      ),
    ).toThrow(/16 teams/);
  });

  it('creates 4 groups of 4 teams', () => {
    const teams = Array.from({ length: 16 }, (_, i) => `t${i + 1}`);
    const sc = initSuperCup(teams, 1, new SeededRNG(7), false);
    expect(sc.groups).toHaveLength(4);
    sc.groups.forEach((g, i) => {
      expect(g.groupName).toBe(String.fromCharCode(65 + i)); // 'A','B','C','D'
      expect(g.teamIds).toHaveLength(4);
      expect(g.standings).toHaveLength(4);
    });
    const allInGroups = sc.groups.flatMap((g) => g.teamIds);
    expect(new Set(allInGroups).size).toBe(16);
    expect(sc.groupStageCompleted).toBe(false);
    expect(sc.completed).toBe(false);
    expect(sc.knockoutRounds).toHaveLength(0);
  });

  it('generates correct fixture counts (double round-robin)', () => {
    const teams = Array.from({ length: 16 }, (_, i) => `t${i + 1}`);
    const sc = initSuperCup(teams, 1, new SeededRNG(7), false);
    // Each group of 4 → 6 rounds × 2 matches per round = 12 fixtures (each team plays 6)
    // Total: 4 groups × 12 = 48 fixtures
    const totalFixtures = sc.groups.reduce((sum, g) => sum + g.fixtures.length, 0);
    expect(totalFixtures).toBe(48);
    sc.groups.forEach((g) => {
      expect(g.fixtures).toHaveLength(12);
      const rounds = new Set(g.fixtures.map((f) => f.round));
      expect(rounds.size).toBe(6);
    });
  });

  it('respects awayGoalRule flag', () => {
    const teams = Array.from({ length: 16 }, (_, i) => `t${i + 1}`);
    const a = initSuperCup(teams, 1, new SeededRNG(7), true);
    const b = initSuperCup(teams, 1, new SeededRNG(7), false);
    expect(a.awayGoalRule).toBe(true);
    expect(b.awayGoalRule).toBe(false);
  });
});

describe('completeSuperCupGroupStage', () => {
  it('creates QF (not R16) two-legged fixtures after group stage finishes', () => {
    const teams = Array.from({ length: 16 }, (_, i) => `t${i + 1}`);
    let sc = initSuperCup(teams, 1, new SeededRNG(7), true);

    // Feed every fixture as a "home wins" result. Aggregating positions doesn't matter
    // for the structural assertion below — we just need standings to be populated.
    const allFixtures = sc.groups.flatMap((g) => g.fixtures);
    const allResults = allFixtures.map((f) => homeWins(f));
    sc = updateSuperCupGroupStandings(sc, allResults);

    sc = completeSuperCupGroupStage(sc, new SeededRNG(7));
    expect(sc.groupStageCompleted).toBe(true);

    // Knockout starts with QF (4 ties, 2 legs each = 8 fixtures across 2 rounds)
    expect(sc.knockoutRounds.length).toBe(2);
    expect(sc.knockoutRounds[0].roundName).toBe('QF-L1');
    expect(sc.knockoutRounds[0].fixtures).toHaveLength(4);
    expect(sc.knockoutRounds[1].roundName).toBe('QF-L2');
    expect(sc.knockoutRounds[1].fixtures).toHaveLength(4);

    // L1 home == L2 away (and vice versa) for each tie
    for (let i = 0; i < 4; i++) {
      const l1 = sc.knockoutRounds[0].fixtures[i];
      const l2 = sc.knockoutRounds[1].fixtures[i];
      expect(l1.homeTeamId).toBe(l2.awayTeamId);
      expect(l1.awayTeamId).toBe(l2.homeTeamId);
    }
  });
});


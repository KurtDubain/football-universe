import { describe, expect, it } from 'vitest';
import type { CoachBase, CoachFormation, CoachStyle } from '../../types/coach';
import type { MatchFixture } from '../../types/match';
import type { Player, PlayerPosition } from '../../types/player';
import type { TeamBase, TeamState } from '../../types/team';
import {
  deriveMatchTactics,
  deriveMatchTacticsPair,
  derivePreferredFormation,
  getFormationShape,
  selectMatchFormation,
} from './tactics';

function team(id: string, overall: number): TeamBase {
  return {
    id, name: id, shortName: id, color: '#000', tier: 'mid', overall,
    attack: overall, midfield: overall, defense: overall, stability: overall,
    depth: overall, reputation: overall, initialLeagueLevel: 1, expectation: 3,
    region: '测试',
  };
}

function state(id: string, fatigue = 10): TeamState {
  return {
    id, leagueLevel: 1, morale: 60, fatigue, momentum: 0,
    squadHealth: 90, coachPressure: 10, recentForm: [],
  };
}

function coach(id: string, style: CoachStyle, rating = 80, preferredFormation?: CoachFormation): CoachBase {
  return {
    id, name: id, rating, style, preferredFormation,
    attackBuff: 3, defenseBuff: 3, moraleBuff: 3, leagueBuff: 2, cupBuff: 2,
    pressureResistance: 70, riskBias: 0, stabilityBuff: 3, age: 50,
  };
}

function players(teamId: string, counts: Record<PlayerPosition, number>): Player[] {
  return (Object.keys(counts) as PlayerPosition[]).flatMap(position =>
    Array.from({ length: counts[position] }, (_, index) => ({
      uuid: `${teamId}-${position}-${index}`,
      teamId,
      name: `${position}-${index}`,
      number: index + 1,
      position,
      rating: 80 - index,
      peakRating: 82,
      peakAge: 27,
      goalScoring: position === 'FW' ? 75 : 20,
      marketValue: 20,
      age: 26,
    })),
  );
}

const fixture: MatchFixture = {
  id: 'tactics-test',
  homeTeamId: 'home',
  awayTeamId: 'away',
  competitionType: 'league',
  competitionName: '测试联赛',
  roundLabel: 'R1',
};

describe('coach tactics', () => {
  it('derives a stable supported identity formation for legacy coaches', () => {
    const legacy = coach('legacy-possession', 'possession');
    const first = derivePreferredFormation(legacy);
    expect(['4-2-3-1', '4-3-3']).toContain(first);
    expect(derivePreferredFormation(legacy)).toBe(first);
    expect(Object.values(getFormationShape(first)).reduce((sum, count) => sum + count, 0)).toBe(11);
  });

  it('keeps the preferred shape when the squad can support it', () => {
    const manager = coach('five-back', 'defensive', 82, '5-4-1');
    const squad = players('home', { GK: 2, DF: 6, MF: 6, FW: 4 });
    expect(selectMatchFormation(manager, squad)).toBe('5-4-1');
  });

  it('falls back when injuries make the preferred shape materially incomplete', () => {
    const manager = coach('five-back', 'defensive', 82, '5-4-1');
    const squad = players('home', { GK: 2, DF: 3, MF: 6, FW: 5 });
    expect(selectMatchFormation(manager, squad)).toBe('4-4-2');
  });

  it('keeps a style identity without making every ordinary match identical', () => {
    const manager = coach('press-with-variation', 'attacking', 84);
    const approaches = Array.from({ length: 80 }, (_, index) => deriveMatchTactics({
      coach: manager,
      team: team('home', 82),
      opponent: team('away', 81),
      state: state('home'),
      opponentState: state('away'),
      fixture: { ...fixture, id: `identity-${index}` },
    }).approach);
    const pressingCount = approaches.filter(approach => approach === 'pressing').length;

    expect(new Set(approaches).size).toBeGreaterThan(1);
    expect(pressingCount).toBeGreaterThan(approaches.length * 0.55);
    expect(pressingCount).toBeLessThan(approaches.length * 0.9);
    expect(deriveMatchTactics({
      coach: manager,
      team: team('home', 82),
      opponent: team('away', 81),
      state: state('home'),
      opponentState: state('away'),
      fixture: { ...fixture, id: 'identity-repeat' },
    })).toEqual(deriveMatchTactics({
      coach: manager,
      team: team('home', 82),
      opponent: team('away', 81),
      state: state('home'),
      opponentState: state('away'),
      fixture: { ...fixture, id: 'identity-repeat' },
    }));
  });

  it('turns a large underdog into a low block or counter without a hidden generic boost', () => {
    const home = team('home', 58);
    const away = team('away', 90);
    const tactics = deriveMatchTactics({
      coach: coach('underdog', 'balanced'),
      team: home,
      opponent: away,
      state: state('home'),
      opponentState: state('away'),
      fixture,
      squad: players('home', { GK: 2, DF: 6, MF: 6, FW: 4 }),
    });

    expect(['low_block', 'counter']).toContain(tactics.approach);
    expect(tactics.reason).toBe('underdog_response');
    expect(tactics.tags).toContain('以弱抗强');
  });

  it('keeps a coach-less team genuinely neutral', () => {
    const homeInput = {
      coach: null,
      team: team('home', 55),
      opponent: team('away', 95),
      state: state('home'),
      opponentState: state('away'),
      fixture,
    };
    const tactics = deriveMatchTactics(homeInput);

    expect(tactics).toMatchObject({
      formation: '4-3-3',
      approach: 'balanced',
      reason: 'coach_identity',
      attackDelta: 0,
      midfieldDelta: 0,
      defenseDelta: 0,
    });
    const pair = deriveMatchTacticsPair(homeInput, {
      coach: coach('away-manager', 'attacking'),
      team: team('away', 95),
      opponent: team('home', 55),
      state: state('away'),
      opponentState: state('home'),
      fixture,
    });
    expect(pair.home).toMatchObject({
      attackDelta: 0,
      midfieldDelta: 0,
      defenseDelta: 0,
      tags: ['保持平衡'],
    });
  });

  it('is deterministic and keeps every tactical dimension inside the small effect budget', () => {
    const home = team('home', 84);
    const away = team('away', 82);
    const homeInput = {
      coach: coach('press', 'attacking', 91), team: home, opponent: away,
      state: state('home'), opponentState: state('away'), fixture,
    };
    const awayInput = {
      coach: coach('control', 'possession', 88), team: away, opponent: home,
      state: state('away'), opponentState: state('home'), fixture,
    };
    const first = deriveMatchTacticsPair(homeInput, awayInput);
    const second = deriveMatchTacticsPair(homeInput, awayInput);

    expect(first).toEqual(second);
    expect(Math.abs(first.matchupEdge)).toBeLessThanOrEqual(1.2);
    for (const tactics of [first.home, first.away]) {
      expect(Math.max(
        Math.abs(tactics.attackDelta),
        Math.abs(tactics.midfieldDelta),
        Math.abs(tactics.defenseDelta),
      )).toBeLessThanOrEqual(3);
    }
  });
});

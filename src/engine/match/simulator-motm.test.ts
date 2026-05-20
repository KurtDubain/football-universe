import { describe, it, expect } from 'vitest';
import { pickMotm, simulateMatch, SimulationContext } from './simulator';
import { SeededRNG } from './rng';
import { MatchEvent, MatchFixture } from '../../types/match';
import { TeamBase, TeamState } from '../../types/team';
import { Player } from '../../types/player';

function ev(partial: Partial<MatchEvent> & Pick<MatchEvent, 'type' | 'teamId'>): MatchEvent {
  return {
    minute: 30,
    description: '',
    ...partial,
  };
}

describe('pickMotm', () => {
  it('returns the top scorer when one player has multiple goals', () => {
    const events: MatchEvent[] = [
      ev({ type: 'goal', teamId: 'home', playerName: 'Alice', minute: 12 }),
      ev({ type: 'goal', teamId: 'home', playerName: 'Alice', minute: 55 }),
      ev({ type: 'goal', teamId: 'away', playerName: 'Bob', minute: 78 }),
    ];
    expect(pickMotm(events, 'home')).toBe('Alice');
  });

  it('weights goals (3) > assists (2) > saves (0.5)', () => {
    const events: MatchEvent[] = [
      ev({ type: 'goal', teamId: 'home', playerName: 'Striker', minute: 10 }),
      ev({ type: 'assist', teamId: 'home', playerName: 'Maker', minute: 10 }),
      ev({ type: 'assist', teamId: 'home', playerName: 'Maker', minute: 60 }),
      ev({ type: 'goal', teamId: 'home', playerName: 'Striker', minute: 60 }),
      ev({ type: 'save', teamId: 'home', playerName: 'Keeper', minute: 22 }),
      ev({ type: 'save', teamId: 'home', playerName: 'Keeper', minute: 44 }),
    ];
    // Striker on winning side: 3*2 = 6, *1.2 = 7.2
    // Maker on winning side: 2*2 = 4, *1.2 = 4.8
    // Keeper on winning side: 0.5*2 = 1, *1.2 = 1.2
    expect(pickMotm(events, 'home')).toBe('Striker');
  });

  it('applies winner-side bonus (1.2×) over draw scoring', () => {
    const events: MatchEvent[] = [
      // Both score the same numeric line, but Alice is on the winning side
      ev({ type: 'goal', teamId: 'home', playerName: 'Alice', minute: 10 }),
      ev({ type: 'goal', teamId: 'away', playerName: 'Carol', minute: 50 }),
      ev({ type: 'assist', teamId: 'home', playerName: 'Alice', minute: 10 }),
      ev({ type: 'assist', teamId: 'away', playerName: 'Carol', minute: 50 }),
    ];
    // Alice (home, winner): (3+2)*1.2 = 6
    // Carol (away, loser): (3+2) = 5
    expect(pickMotm(events, 'home')).toBe('Alice');
  });

  it('returns undefined when no player reaches threshold (3 points)', () => {
    const events: MatchEvent[] = [
      // Pure assist + saves on a drawn match — no winner bonus, score
      // never crosses the 3-point threshold.
      ev({ type: 'assist', teamId: 'home', playerName: 'Helper', minute: 22 }),
      ev({ type: 'save', teamId: 'home', playerName: 'Keeper', minute: 30 }),
      ev({ type: 'save', teamId: 'away', playerName: 'Keeper2', minute: 50 }),
    ];
    expect(pickMotm(events, null)).toBeUndefined();
  });

  it('penalises cards from the running total', () => {
    const events: MatchEvent[] = [
      ev({ type: 'goal', teamId: 'home', playerName: 'Bad', minute: 5 }),
      ev({ type: 'red_card', teamId: 'home', playerName: 'Bad', minute: 30 }),
      ev({ type: 'goal', teamId: 'home', playerName: 'Clean', minute: 70 }),
    ];
    // Bad: (3 - 2) * 1.2 = 1.2
    // Clean: 3 * 1.2 = 3.6
    expect(pickMotm(events, 'home')).toBe('Clean');
  });

  it('skips shootout kicks (minute > 120)', () => {
    const events: MatchEvent[] = [
      ev({ type: 'goal', teamId: 'home', playerName: 'OpenPlay', minute: 60 }),
      // These shootout kicks should NOT count toward MotM.
      ev({ type: 'penalty_goal', teamId: 'home', playerName: 'Shootout', minute: 121 }),
      ev({ type: 'penalty_goal', teamId: 'home', playerName: 'Shootout', minute: 123 }),
    ];
    // OpenPlay: 3 * 1.2 = 3.6 (qualifies)
    // Shootout kicks at minute > 120 are filtered → score = 0
    expect(pickMotm(events, 'home')).toBe('OpenPlay');
  });

  it('counts ET goals (penalty_goal at minute ≤ 120) toward MotM', () => {
    const events: MatchEvent[] = [
      ev({ type: 'penalty_goal', teamId: 'home', playerName: 'Penaltaker', minute: 110 }),
    ];
    expect(pickMotm(events, 'home')).toBe('Penaltaker');
  });

  it('handles a draw (winnerTeamId = null) without applying any bonus', () => {
    const events: MatchEvent[] = [
      ev({ type: 'goal', teamId: 'home', playerName: 'A', minute: 20 }),
      ev({ type: 'goal', teamId: 'away', playerName: 'B', minute: 65 }),
      ev({ type: 'assist', teamId: 'away', playerName: 'B', minute: 65 }),
    ];
    // A (no bonus): 3
    // B (no bonus): 3 + 2 = 5
    expect(pickMotm(events, null)).toBe('B');
  });

  it('ignores events without playerName', () => {
    const events: MatchEvent[] = [
      ev({ type: 'goal', teamId: 'home', minute: 10 }), // no playerName
      ev({ type: 'goal', teamId: 'home', playerName: 'Real', minute: 50 }),
    ];
    expect(pickMotm(events, 'home')).toBe('Real');
  });
});

// ─── Integration: simulator wire-up ───────────────────────────────

function makeTeam(id: string, overall: number): TeamBase {
  return {
    id, name: id, shortName: id.slice(0, 3), color: '#000', tier: 'mid',
    overall, attack: overall, midfield: overall, defense: overall,
    stability: overall, depth: overall, reputation: overall,
    initialLeagueLevel: 1, expectation: 3, region: '大陆+测试',
  };
}
function makeState(id: string): TeamState {
  return { id, leagueLevel: 1, morale: 60, fatigue: 10, momentum: 0, squadHealth: 90, coachPressure: 10, recentForm: [] };
}
function makeSquad(teamId: string, prefix: string): Player[] {
  const squad: Player[] = [];
  let n = 1;
  const add = (pos: Player['position'], rating: number, count: number) => {
    for (let i = 0; i < count; i++) {
      squad.push({
        uuid: `${prefix}-${n}`,
        teamId, name: `${prefix}${n}`, number: n,
        position: pos, rating, age: 25,
        goalScoring: pos === 'FW' ? 80 : pos === 'MF' ? 50 : pos === 'DF' ? 20 : 5,
        marketValue: rating,
      });
      n++;
    }
  };
  add('GK', 75, 2);
  add('DF', 75, 6);
  add('MF', 80, 7);
  add('FW', 85, 5);
  return squad;
}

describe('simulateMatch — motm integration', () => {
  it('populates result.motm when a player accrues enough scoring contributions', () => {
    const ctx: SimulationContext = {
      homeTeam: makeTeam('home', 88),
      awayTeam: makeTeam('away', 72), // big gap → home should usually score
      homeState: makeState('home'),
      awayState: makeState('away'),
      homeCoach: null,
      awayCoach: null,
      competitionType: 'league',
      isKnockout: false,
      rng: new SeededRNG(2026),
      homeSquad: makeSquad('home', 'HM'),
      awaySquad: makeSquad('away', 'AW'),
    };
    const fixture: MatchFixture = {
      id: 'mfx-1',
      homeTeamId: 'home',
      awayTeamId: 'away',
      competitionType: 'league',
      competitionName: '测试联赛',
      roundLabel: 'R1',
    };
    // Try a handful of seeds to dodge a 0-0 freak. With this overall gap and
    // squad shape the home side should produce at least one goal in most.
    let foundMotm = false;
    for (const seed of [2026, 1, 7, 42, 99]) {
      ctx.rng = new SeededRNG(seed);
      const r = simulateMatch(ctx, fixture).matchResult;
      if (r.motm) {
        foundMotm = true;
        // The MotM should be the name of a player from either squad.
        const allNames = new Set<string>([...ctx.homeSquad!, ...ctx.awaySquad!].map(p => p.name!));
        expect(allNames.has(r.motm)).toBe(true);
        break;
      }
    }
    expect(foundMotm).toBe(true);
  });

  it('omits motm when no player crosses the threshold (very rare 0-0 draw)', () => {
    // Use synthetic events: empty event list → no motm.
    const r = pickMotm([], null);
    expect(r).toBeUndefined();
  });
});

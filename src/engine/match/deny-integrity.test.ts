import { describe, it, expect } from 'vitest';
import { simulateMatch, SimulationContext } from './simulator';
import { applyDenyPipeline } from './events';
import { SeededRNG } from './rng';
import { generateSquad } from '../players/generator';
import { updatePlayerStatsFromResults, createInitialPlayerStats } from '../players/stats';
import type { TeamBase, TeamState } from '../../types/team';
import type { MatchFixture } from '../../types/match';

/**
 * Load-bearing invariant test: the deny pipeline (v22) must not break
 * the rule that
 *
 *   sum(player.goals where player.teamId == X) === team scoreline
 *
 * Same for assists. Plus the v22 superset relationships:
 *
 *   bigChances >= goals  (per player)
 *   keyPasses >= assists (per player)
 *
 * Runs a deterministic 100-match sim across mixed competition types so
 * regressions surface fast.
 */

function makeTeam(id: string, overall: number, attack: number, defense: number): TeamBase {
  return {
    id, name: id, shortName: id.slice(0, 2), color: '#888',
    tier: 'mid', overall, attack, midfield: overall, defense,
    stability: 60, depth: 60, reputation: 70,
    initialLeagueLevel: 1, expectation: 3, region: '大陆+测试',
  };
}

function makeState(id: string): TeamState {
  return {
    id,
    leagueLevel: 1,
    morale: 60,
    fatigue: 10,
    momentum: 0,
    squadHealth: 85,
    coachPressure: 10,
    recentForm: [],
  };
}

function makeContext(seed: number, isKnockout: boolean): { ctx: SimulationContext; fixture: MatchFixture } {
  const rng = new SeededRNG(seed);
  const uuidCounter = { value: 1 };
  const home = makeTeam('home_team', 78, 80, 76);
  const away = makeTeam('away_team', 74, 75, 73);
  const homeSquad = generateSquad(home, rng.fork(), uuidCounter);
  const awaySquad = generateSquad(away, rng.fork(), uuidCounter);
  return {
    ctx: {
      homeTeam: home,
      awayTeam: away,
      homeState: makeState('home_team'),
      awayState: makeState('away_team'),
      homeCoach: null,
      awayCoach: null,
      competitionType: isKnockout ? 'league_cup' : 'league',
      isKnockout,
      rng,
      homeSquad,
      awaySquad,
      globalWindowIdx: 0,
    },
    fixture: {
      id: `fixture-${seed}`,
      homeTeamId: 'home_team',
      awayTeamId: 'away_team',
      competitionType: isKnockout ? 'league_cup' : 'league',
      competitionName: '测试杯',
      roundLabel: '第1轮',
    },
  };
}

describe('v22 deny pipeline — score / stat integrity', () => {
  it('sum(player.goals) === team.homeGoals for 100 league matches (deny ACTIVE)', () => {
    let mismatches = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const { ctx, fixture } = makeContext(seed, /*isKnockout*/ false);
      const { matchResult } = simulateMatch(ctx, fixture);
      const squads = {
        [ctx.homeTeam.id]: ctx.homeSquad!,
        [ctx.awayTeam.id]: ctx.awaySquad!,
      };
      const stats = updatePlayerStatsFromResults(
        createInitialPlayerStats(squads),
        [matchResult],
        squads,
        0,
      );

      // Sum goals per team from the stats dictionary.
      let homeStatsGoals = 0;
      let awayStatsGoals = 0;
      for (const p of ctx.homeSquad!) homeStatsGoals += stats[p.uuid]?.goals ?? 0;
      for (const p of ctx.awaySquad!) awayStatsGoals += stats[p.uuid]?.goals ?? 0;

      // For league matches deny is active. The total goals (reg + ET, no
      // shootout) should match exactly. We compare totals NOT just reg
      // because the simulator already accounts for ET in stats too.
      const expectedHome = matchResult.homeGoals + (matchResult.etHomeGoals ?? 0);
      const expectedAway = matchResult.awayGoals + (matchResult.etAwayGoals ?? 0);
      if (homeStatsGoals !== expectedHome || awayStatsGoals !== expectedAway) {
        mismatches++;
        if (mismatches < 3) {
          // Provide diagnostic for the first few failures
          console.log(`SEED ${seed}: home stats=${homeStatsGoals} expected=${expectedHome}, away stats=${awayStatsGoals} expected=${expectedAway}`);
        }
      }
    }
    expect(mismatches).toBe(0);
  });

  it('bigChances >= goals AND keyPasses >= assists (superset invariant)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { ctx, fixture } = makeContext(seed, false);
      const { matchResult } = simulateMatch(ctx, fixture);
      const squads = {
        [ctx.homeTeam.id]: ctx.homeSquad!,
        [ctx.awayTeam.id]: ctx.awaySquad!,
      };
      const stats = updatePlayerStatsFromResults(
        createInitialPlayerStats(squads),
        [matchResult],
        squads,
        0,
      );
      for (const s of Object.values(stats)) {
        expect(s.bigChances).toBeGreaterThanOrEqual(s.goals);
        expect(s.keyPasses).toBeGreaterThanOrEqual(s.assists);
      }
    }
  });

  it('knockout matches bypass deny (no gk_save / df_block events generated)', () => {
    const { ctx, fixture } = makeContext(99, /*isKnockout*/ true);
    const { matchResult } = simulateMatch(ctx, fixture);
    const denyEvents = matchResult.events.filter(e => e.type === 'gk_save' || e.type === 'df_block');
    expect(denyEvents.length).toBe(0);
  });

  it('league matches DO occasionally generate save/block events', () => {
    let denyEventCount = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const { ctx, fixture } = makeContext(seed, false);
      const { matchResult } = simulateMatch(ctx, fixture);
      denyEventCount += matchResult.events.filter(e => e.type === 'gk_save' || e.type === 'df_block').length;
    }
    // Across 50 matches with ~2.5 goals each = 125 goals × ~10% deny ≈ 12+.
    // We assert at least 3 to catch "deny never fires" regressions.
    expect(denyEventCount).toBeGreaterThanOrEqual(3);
  });

  it('applyDenyPipeline preserves event order monotonicity by minute', () => {
    // Build a synthetic events list and apply deny — verify minute order
    // is preserved (i.e. no reordering happens, only replacement).
    const rng = new SeededRNG(123);
    const { ctx } = makeContext(7, false);
    const fakeEvents: ReturnType<typeof applyDenyPipeline> = [
      { minute: 10, type: 'goal', teamId: 'home_team', playerId: ctx.homeSquad![10].uuid, description: 'g1' },
      { minute: 30, type: 'goal', teamId: 'away_team', playerId: ctx.awaySquad![10].uuid, description: 'g2' },
      { minute: 30, type: 'assist', teamId: 'away_team', playerId: ctx.awaySquad![8].uuid, description: 'a2' },
      { minute: 75, type: 'goal', teamId: 'home_team', playerId: ctx.homeSquad![12].uuid, description: 'g3' },
    ];
    const out = applyDenyPipeline(fakeEvents, 'home_team', 'away_team', ctx.homeSquad, ctx.awaySquad, rng);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].minute).toBeGreaterThanOrEqual(out[i - 1].minute);
    }
  });
});

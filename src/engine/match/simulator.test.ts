import { describe, it, expect } from 'vitest';
import { simulateMatch, SimulationContext } from './simulator';
import { SeededRNG } from './rng';
import { TeamBase, TeamState } from '../../types/team';
import { CoachBase } from '../../types/coach';
import { MatchFixture } from '../../types/match';
import type { Player, PlayerPosition } from '../../types/player';
import { pickMatchday } from '../players/injuries';

function eventPlayerWasOnField(result: ReturnType<typeof simulateMatch>['matchResult'], event: typeof result.events[number]): boolean {
  if (!event.playerId || event.type === 'own_goal') return true;
  const snapshot = event.teamId === result.homeTeamId ? result.homeMatchday : result.awayMatchday;
  if (!snapshot) return true;
  const entry = snapshot.players.find(player => player.playerId === event.playerId);
  if (!entry || entry.enteredMinute == null || entry.exitedMinute == null) return false;
  const minute = Math.min(event.minute, (snapshot.durationMinutes ?? 90) - 1);
  return entry.enteredMinute <= minute
    && (entry.exitedMinute > minute || (event.type === 'red_card' && entry.exitedMinute === minute));
}

// ─── Test fixtures ────────────────────────────────────────────────

function makeTeam(id: string, overall: number): TeamBase {
  return {
    id,
    name: id,
    shortName: id.slice(0, 3),
    color: '#000000',
    tier: 'mid',
    overall,
    attack: overall,
    midfield: overall,
    defense: overall,
    stability: overall,
    depth: overall,
    reputation: overall,
    initialLeagueLevel: 1,
    expectation: 3,
    region: '大陆+测试',
  };
}

function makeState(id: string): TeamState {
  return {
    id,
    leagueLevel: 1,
    morale: 60,
    fatigue: 10,
    momentum: 0,
    squadHealth: 90,
    coachPressure: 10,
    recentForm: [],
  };
}

function makeCoach(id: string): CoachBase {
  return {
    id,
    name: id,
    rating: 80,
    style: 'balanced',
    attackBuff: 5,
    defenseBuff: 5,
    moraleBuff: 5,
    leagueBuff: 5,
    cupBuff: 5,
    pressureResistance: 70,
    riskBias: 0,
    stabilityBuff: 5,
    age: 50,
  };
}

function makePlayer(
  teamId: string,
  index: number,
  position: PlayerPosition,
  rating: number,
  goalScoring: number,
): Player {
  return {
    uuid: `${teamId}-player-${index}`,
    teamId,
    name: `${teamId} ${index}`,
    number: index + 1,
    position,
    rating,
    goalScoring,
    marketValue: rating,
    age: 25,
    peakRating: rating,
    peakAge: 27,
  };
}

function makeDeepSquad(teamId: string): Player[] {
  const positions: PlayerPosition[] = [
    'GK',
    'DF', 'DF', 'DF', 'DF', 'DF',
    'MF', 'MF', 'MF', 'MF', 'MF',
    'FW', 'FW', 'FW',
    'FW', 'FW', 'MF', 'MF', 'DF', 'DF', 'GK', 'FW',
  ];
  return positions.map((position, index) => {
    const inMatchdayBand = index < 14;
    return makePlayer(
      teamId,
      index,
      position,
      inMatchdayBand ? 92 - index : 45 - index,
      inMatchdayBand ? 5 : 100,
    );
  });
}

function makeFixture(): MatchFixture {
  return {
    id: 'TEST-FX-1',
    homeTeamId: 'home',
    awayTeamId: 'away',
    competitionType: 'league',
    competitionName: '测试联赛',
    roundLabel: 'R1',
  };
}

function buildContext(seed: number, isKnockout = false): SimulationContext {
  return {
    homeTeam: makeTeam('home', 80),
    awayTeam: makeTeam('away', 78),
    homeState: makeState('home'),
    awayState: makeState('away'),
    homeCoach: makeCoach('coach_home'),
    awayCoach: makeCoach('coach_away'),
    competitionType: isKnockout ? 'league_cup' : 'league',
    isKnockout,
    rng: new SeededRNG(seed),
  };
}

describe('simulateMatch', () => {
  describe('determinism', () => {
    it('produces identical results for identical inputs and seed', () => {
      const ctx1 = buildContext(2024);
      const ctx2 = buildContext(2024);
      const fixture = makeFixture();

      const r1 = simulateMatch(ctx1, fixture);
      const r2 = simulateMatch(ctx2, fixture);

      expect(r1.matchResult.homeGoals).toBe(r2.matchResult.homeGoals);
      expect(r1.matchResult.awayGoals).toBe(r2.matchResult.awayGoals);
      expect(r1.matchResult.events.length).toBe(r2.matchResult.events.length);
      // Events should match minute-by-minute
      r1.matchResult.events.forEach((ev, i) => {
        const ev2 = r2.matchResult.events[i];
        expect(ev.minute).toBe(ev2.minute);
        expect(ev.type).toBe(ev2.type);
        expect(ev.teamId).toBe(ev2.teamId);
      });
    });

    it('produces different results for different seeds (statistically)', () => {
      const a = simulateMatch(buildContext(1), makeFixture());
      const b = simulateMatch(buildContext(99999), makeFixture());
      // Either goals differ, or shot stats differ, or events differ.
      const same =
        a.matchResult.homeGoals === b.matchResult.homeGoals &&
        a.matchResult.awayGoals === b.matchResult.awayGoals &&
        a.matchResult.events.length === b.matchResult.events.length;
      expect(same).toBe(false);
    });
  });

  describe('structural sanity', () => {
    it('returns a well-formed MatchResult (league)', () => {
      const r = simulateMatch(buildContext(7), makeFixture()).matchResult;

      expect(r.fixtureId).toBe('TEST-FX-1');
      expect(r.homeTeamId).toBe('home');
      expect(r.awayTeamId).toBe('away');
      expect(typeof r.homeGoals).toBe('number');
      expect(typeof r.awayGoals).toBe('number');
      expect(r.homeGoals).toBeGreaterThanOrEqual(0);
      expect(r.awayGoals).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(r.events)).toBe(true);
      expect(r.events).not.toBeNull();
      expect(r.stats).toBeTruthy();
      expect(r.stats.possession[0] + r.stats.possession[1]).toBe(100);
      expect(r.competitionType).toBe('league');
      // League matches do not go to extra time
      expect(r.extraTime).toBe(false);
      expect(r.penalties).toBe(false);
    });

    it('handles knockout draws via extra time / penalties (totals are numeric)', () => {
      // Run many seeds; assert that whenever extraTime fires, the et fields are valid numbers
      for (let seed = 1; seed <= 50; seed++) {
        const ctx = buildContext(seed, true);
        // Force knockout against equal teams to maximise draw rate
        ctx.awayTeam = makeTeam('away', 80);
        const r = simulateMatch(ctx, makeFixture()).matchResult;

        if (r.extraTime) {
          expect(typeof r.etHomeGoals).toBe('number');
          expect(typeof r.etAwayGoals).toBe('number');
          const total =
            r.homeGoals + (r.etHomeGoals ?? 0) + r.awayGoals + (r.etAwayGoals ?? 0);
          expect(Number.isFinite(total)).toBe(true);
          if (r.penalties) {
            expect(typeof r.penaltyHome).toBe('number');
            expect(typeof r.penaltyAway).toBe('number');
            expect(r.penaltyHome).not.toBe(r.penaltyAway);
          }
        }
      }
    });

    it('returns state changes that update morale / fatigue / momentum', () => {
      const sim = simulateMatch(buildContext(42), makeFixture());
      expect(sim.homeStateChanges.morale).toBeGreaterThanOrEqual(0);
      expect(sim.homeStateChanges.morale).toBeLessThanOrEqual(100);
      expect(sim.awayStateChanges.fatigue).toBeGreaterThan(10); // baseline + match fatigue
      expect(typeof sim.homePressureChange).toBe('number');
      expect(typeof sim.awayPressureChange).toBe('number');
    });

    it('generates player events only from the matchday squad when given full squads', () => {
      for (let seed = 1; seed <= 40; seed++) {
        const homeSquad = makeDeepSquad('home');
        const awaySquad = makeDeepSquad('away');
        const ctx = {
          ...buildContext(seed),
          homeTeam: makeTeam('home', 95),
          awayTeam: makeTeam('away', 88),
          homeSquad,
          awaySquad,
          globalWindowIdx: 12,
        };
        const result = simulateMatch(ctx, makeFixture()).matchResult;
        const homeMatchdayIds = new Set((pickMatchday(homeSquad, 12) ?? []).map((player) => player.uuid));
        const awayMatchdayIds = new Set((pickMatchday(awaySquad, 12) ?? []).map((player) => player.uuid));
        expect(new Set(result.homeMatchday?.players.map((player) => player.playerId))).toEqual(homeMatchdayIds);
        expect(new Set(result.awayMatchday?.players.map((player) => player.playerId))).toEqual(awayMatchdayIds);
        expect(result.homeMatchday?.availableCount).toBe(homeSquad.length);
        expect(result.awayMatchday?.availableCount).toBe(awaySquad.length);
        const eventPlayerIds = result.events
          .filter((event) => event.playerId)
          .map((event) => ({
            teamId: event.teamId,
            playerId: event.playerId!,
          }));

        expect(eventPlayerIds.length).toBeGreaterThan(0);
        for (const eventPlayer of eventPlayerIds) {
          const allowedIds = eventPlayer.teamId === 'home' ? homeMatchdayIds : awayMatchdayIds;
          expect(allowedIds.has(eventPlayer.playerId)).toBe(true);
        }
        for (const event of result.events) {
          if (event.deniedScorerId) {
            const attackingIds = event.teamId === 'home' ? awayMatchdayIds : homeMatchdayIds;
            expect(attackingIds.has(event.deniedScorerId)).toBe(true);
          }
          if (event.deniedAssisterId) {
            const attackingIds = event.teamId === 'home' ? awayMatchdayIds : homeMatchdayIds;
            expect(attackingIds.has(event.deniedAssisterId)).toBe(true);
          }
        }
      }
    });

    it('assigns every event to an on-field player and emits nothing after a dismissal', () => {
      let redCardsSeen = 0;
      for (let seed = 1; seed <= 250; seed++) {
        const result = simulateMatch({
          ...buildContext(seed),
          homeSquad: makeDeepSquad('home'),
          awaySquad: makeDeepSquad('away'),
          globalWindowIdx: 0,
        }, makeFixture()).matchResult;

        for (const event of result.events) {
          expect(eventPlayerWasOnField(result, event)).toBe(true);
          for (const deniedPlayerId of [event.deniedScorerId, event.deniedAssisterId]) {
            if (!deniedPlayerId) continue;
            const attackingTeamId = event.teamId === result.homeTeamId
              ? result.awayTeamId
              : result.homeTeamId;
            const proxy = { ...event, teamId: attackingTeamId, playerId: deniedPlayerId };
            expect(eventPlayerWasOnField(result, proxy)).toBe(true);
          }
        }

        for (const red of result.events.filter(event => event.type === 'red_card' && event.playerId)) {
          redCardsSeen++;
          expect(result.events.some(event =>
            event.minute > red.minute
            && (event.playerId === red.playerId
              || event.deniedScorerId === red.playerId
              || event.deniedAssisterId === red.playerId),
          )).toBe(false);
        }
      }
      expect(redCardsSeen).toBeGreaterThan(0);
    });

    it('never labels an outfield player as a goalkeeper when no goalkeeper is available', () => {
      const homeSquad = makeDeepSquad('home').filter(player => player.position !== 'GK');
      const awaySquad = makeDeepSquad('away').filter(player => player.position !== 'GK');
      const playersById = new Map([...homeSquad, ...awaySquad].map(player => [player.uuid, player]));

      for (let seed = 1; seed <= 100; seed++) {
        const result = simulateMatch({
          ...buildContext(seed),
          homeSquad,
          awaySquad,
          globalWindowIdx: 0,
        }, makeFixture()).matchResult;
        for (const event of result.events) {
          if (event.type === 'save') expect(event.playerId).toBeUndefined();
          if (event.type === 'gk_save') expect(event.playerId).toBeUndefined();
          if (event.type === 'df_block' && event.playerId) {
            expect(playersById.get(event.playerId)?.position).toBe('DF');
          }
        }
      }
    });
  });
});

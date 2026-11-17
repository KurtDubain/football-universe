import { describe, expect, it } from 'vitest';
import type { CupFixture, WorldCupState } from '../../types/cup';
import { initializeGameWorld, type GameWorld } from '../../engine/season/season-manager';
import { pastSeasonOpening } from '../../engine/season/test-world';
import { CEREMONY_PRIORITY, ceremonyScope, deriveCeremonies, formatCupScore } from './ceremony-content';

const SEED = 20260722;

function baseWorld(): GameWorld {
  return initializeGameWorld(SEED);
}

function teamIds(world: GameWorld): [string, string] {
  const ids = Object.keys(world.teamBases);
  return [ids[0], ids[1]];
}

function finalFixture(home: string, away: string, winner: string): CupFixture {
  return {
    id: 'final',
    round: 1,
    roundName: '决赛',
    homeTeamId: home,
    awayTeamId: away,
    isNeutralVenue: true,
    result: { home: 2, away: 1 },
    winnerId: winner,
  };
}

/** Put the world on a completed window of the given type, keeping its shape. */
function onCompletedWindow(world: GameWorld, type: GameWorld['seasonState']['calendar'][number]['type']): GameWorld {
  const calendar = world.seasonState.calendar.map((window, index) => (
    index === 0 ? { ...window, type, completed: true } : window
  ));
  return { ...world, seasonState: { ...world.seasonState, calendar } };
}

function withLeagueCupDecided(world: GameWorld): GameWorld {
  const [home, away] = teamIds(world);
  return {
    ...onCompletedWindow(world, 'league_cup'),
    leagueCup: {
      ...world.leagueCup,
      completed: true,
      winnerId: home,
      rounds: [{
        roundNumber: 1,
        roundName: '决赛',
        completed: true,
        fixtures: [finalFixture(home, away, home)],
      }],
    },
  };
}

function drawnWorldCup(world: GameWorld, played: boolean): WorldCupState {
  const [home, away] = teamIds(world);
  const group = {
    groupName: 'A',
    teamIds: [home, away],
    standings: [],
    fixtures: [finalFixture(home, away, home)],
  };
  return {
    groups: [{ ...group, fixtures: played ? group.fixtures : group.fixtures.map(f => ({ ...f, result: undefined, winnerId: undefined })) }],
    knockoutRounds: [],
    groupStageCompleted: false,
    completed: false,
    participantIds: [home, away],
    hostTeamId: home,
  };
}

describe('formatCupScore', () => {
  it('prints the score, and the extra time or shoot-out that decided it', () => {
    expect(formatCupScore(null)).toBe('—');
    const plain = finalFixture('a', 'b', 'a');
    expect(formatCupScore(plain)).toBe('2-1');
    expect(formatCupScore({ ...plain, result: { home: 1, away: 1, extraTime: true } })).toBe('1-1 · 加时');
    expect(formatCupScore({
      ...plain,
      result: { home: 1, away: 1, extraTime: true, penalties: true, penHome: 4, penAway: 3 },
    })).toBe('1-1 · 点球 4-3');
  });
});

describe('deriveCeremonies', () => {
  it('opens a season on the pre-season window and nowhere else', () => {
    const world = baseWorld();
    const opening = deriveCeremonies(world).find(r => r.kind === 'season_opening');
    expect(opening).toBeDefined();
    expect(opening?.kind === 'season_opening' && opening.seasonNumber).toBe(1);

    const past = pastSeasonOpening(world);
    expect(deriveCeremonies(past).some(r => r.kind === 'season_opening')).toBe(false);
  });

  it('stays silent on an ordinary matchday', () => {
    expect(deriveCeremonies(pastSeasonOpening(baseWorld()))).toEqual([]);
  });

  it('stamps a cup only once its final window is the last one played', () => {
    const world = baseWorld();
    const [home] = teamIds(world);
    const decided = withLeagueCupDecided(world);
    const stamp = deriveCeremonies(decided).find(r => r.kind === 'cup_stamp');
    expect(stamp).toBeDefined();
    expect(stamp?.kind === 'cup_stamp' && stamp.champion.teamId).toBe(home);
    expect(stamp?.kind === 'cup_stamp' && stamp.roundLabel).toBe('决赛');
    expect(stamp?.kind === 'cup_stamp' && stamp.score).toBe('2-1');

    // The same cup, one window later, is history rather than news.
    const later = {
      ...decided,
      seasonState: {
        ...decided.seasonState,
        calendar: decided.seasonState.calendar.map((window, index) => (
          index === 1 ? { ...window, type: 'league' as const, completed: true } : window
        )),
      },
    };
    expect(deriveCeremonies(later).some(r => r.kind === 'cup_stamp')).toBe(false);
  });

  it('opens a World Cup on the draw and not after the first whistle', () => {
    const world = baseWorld();
    const drawn = { ...world, worldCup: drawnWorldCup(world, false) };
    const opening = deriveCeremonies(drawn).find(r => r.kind === 'world_cup_opening');
    expect(opening).toBeDefined();
    expect(opening?.kind === 'world_cup_opening' && opening.entrants).toHaveLength(2);

    const kickedOff = { ...world, worldCup: drawnWorldCup(world, true) };
    expect(deriveCeremonies(kickedOff).some(r => r.kind === 'world_cup_opening')).toBe(false);
  });

  it('closes a World Cup only while the final is the last thing decided', () => {
    const world = baseWorld();
    const [home, away] = teamIds(world);
    const cup: WorldCupState = {
      ...drawnWorldCup(world, true),
      completed: true,
      winnerId: home,
      knockoutRounds: [{
        roundNumber: 1,
        roundName: '决赛',
        completed: true,
        fixtures: [finalFixture(home, away, home)],
      }],
    };
    const decided = { ...onCompletedWindow(world, 'world_cup'), worldCup: cup };
    const closing = deriveCeremonies(decided).find(r => r.kind === 'world_cup_closing');
    expect(closing).toBeDefined();
    expect(closing?.kind === 'world_cup_closing' && closing.champion.teamId).toBe(home);

    const later = {
      ...decided,
      seasonState: {
        ...decided.seasonState,
        calendar: decided.seasonState.calendar.map((window, index) => (
          index === 1 ? { ...window, type: 'league' as const, completed: true } : window
        )),
      },
    };
    expect(deriveCeremonies(later).some(r => r.kind === 'world_cup_closing')).toBe(false);
  });

  it('turns the rarest page when a World Cup year opens a season at the same time', () => {
    const world = baseWorld();
    const both = { ...world, worldCup: drawnWorldCup(world, false) };
    const kinds = deriveCeremonies(both).map(r => r.kind);
    expect(kinds).toContain('season_opening');
    expect(kinds).toContain('world_cup_opening');
    expect(kinds.indexOf('world_cup_opening')).toBeLessThan(kinds.indexOf('season_opening'));
  });

  it('orders every ceremony by the published priority', () => {
    const world = baseWorld();
    const kinds = deriveCeremonies({ ...world, worldCup: drawnWorldCup(world, false) }).map(r => r.kind);
    const ranks = kinds.map(kind => CEREMONY_PRIORITY.indexOf(kind));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe('ceremonyScope', () => {
  it('stays put inside a season and moves when honours arrive', () => {
    const world = baseWorld();
    expect(ceremonyScope(world)).toBe(ceremonyScope({ ...world }));
    const withHonour = {
      ...world,
      honorHistory: [{ seasonNumber: 1 } as GameWorld['honorHistory'][number]],
    };
    expect(ceremonyScope(withHonour)).not.toBe(ceremonyScope(world));
  });
});

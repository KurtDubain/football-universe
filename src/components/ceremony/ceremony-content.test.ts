import { describe, expect, it } from 'vitest';
import type { CupFixture, WorldCupState } from '../../types/cup';
import type { MatchEvent, MatchResult } from '../../types/match';
import { initializeGameWorld, type GameWorld } from '../../engine/season/season-manager';
import { pastSeasonOpening } from '../../engine/season/test-world';
import { CEREMONY_PRIORITY, ceremonyScope, countCeremonyLines, deriveCeremonies, formatCupScore } from './ceremony-content';
import type { CeremonyHonour, CeremonyTeam } from './ceremony-types';

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

const ZERO_STATS = {
  possession: [50, 50] as [number, number],
  shots: [0, 0] as [number, number],
  shotsOnTarget: [0, 0] as [number, number],
  corners: [0, 0] as [number, number],
  fouls: [0, 0] as [number, number],
  yellowCards: [0, 0] as [number, number],
  redCards: [0, 0] as [number, number],
};

function team(teamId: string): CeremonyTeam {
  return { teamId, name: teamId, shortName: teamId, color: '#000000' };
}

function podiumEntry(teamId: string, points: number) {
  return { team: team(teamId), points };
}

function honour(label: string, name: string): CeremonyHonour {
  return { label, name, detail: '', team: null };
}

function matchEvent(
  type: MatchEvent['type'],
  teamId: string,
  playerId: string,
  playerName: string,
): MatchEvent {
  return { minute: 10, type, teamId, playerId, playerName, description: playerName };
}

/** The decided cup final, with the match the calendar actually recorded for it. */
function withFinalEvents(world: GameWorld, events: MatchEvent[]): GameWorld {
  const decided = withLeagueCupDecided(world);
  const [home, away] = teamIds(world);
  const result: MatchResult = {
    fixtureId: 'final',
    homeTeamId: home,
    awayTeamId: away,
    homeGoals: 2,
    awayGoals: 1,
    extraTime: false,
    penalties: false,
    events,
    stats: ZERO_STATS,
    competitionType: 'league_cup',
    competitionName: '联赛杯',
    roundLabel: '决赛',
  };
  return {
    ...decided,
    seasonState: {
      ...decided.seasonState,
      calendar: decided.seasonState.calendar.map((window, index) => (
        index === 0 ? { ...window, results: [result] } : window
      )),
    },
  };
}

function cupStampOf(world: GameWorld) {
  const stamp = deriveCeremonies(world).find(request => request.kind === 'cup_stamp');
  if (stamp?.kind !== 'cup_stamp') throw new Error('expected a cup stamp');
  return stamp;
}

describe('countCeremonyLines', () => {
  it('lets the longest of the three closing pages set the rhythm', () => {
    const base = {
      kind: 'season_closing' as const,
      seasonNumber: 1,
      champion: null,
      summary: '',
    };
    expect(countCeremonyLines({ ...base, podium: [], playerHonours: [], coachHonours: [] })).toBe(2);

    // Seven individual awards outrun a three-club podium and two coaches.
    const full = {
      ...base,
      podium: [podiumEntry('a', 70), podiumEntry('b', 68), podiumEntry('c', 66)],
      playerHonours: Array.from({ length: 7 }, (_, index) => honour('奖项', '球员' + index)),
      coachHonours: [honour('冠军教头', '教练甲'), honour('最佳教练', '教练乙')],
    };
    expect(countCeremonyLines(full)).toBe(7);

    // A short award list falls back to the podium it shares the key with.
    expect(countCeremonyLines({ ...full, playerHonours: [honour('金球奖', '球员')] })).toBe(5);
  });

  it('adds a line per honour the cup final produced', () => {
    const stamp = {
      kind: 'cup_stamp' as const,
      competitionName: '联赛杯',
      roundLabel: '决赛',
      champion: team('a'),
      runnerUp: null,
      score: '2-1',
    };
    expect(countCeremonyLines({ ...stamp, finalMvp: null, topScorer: null })).toBe(2);
    expect(countCeremonyLines({ ...stamp, finalMvp: honour('决赛最佳球员', '甲'), topScorer: null })).toBe(3);
    expect(countCeremonyLines({
      ...stamp,
      finalMvp: honour('决赛最佳球员', '甲'),
      topScorer: honour('赛事金靴', '乙'),
    })).toBe(4);
  });
});

describe('cup stamp honours', () => {
  it('names the player who decided the final and the competition leading scorer', () => {
    const world = baseWorld();
    const [home, away] = teamIds(world);
    const stamp = cupStampOf(withFinalEvents(world, [
      matchEvent('goal', home, 'p1', '主队前锋'),
      matchEvent('assist', home, 'p2', '主队中场'),
      matchEvent('goal', home, 'p1', '主队前锋'),
      matchEvent('goal', away, 'p3', '客队前锋'),
      // Neither of these is a goal the player scored for their own club.
      matchEvent('own_goal', away, 'p4', '客队后卫'),
      matchEvent('penalty_goal', home, 'p5', '主队点球手'),
    ]));

    // Two goals outweigh one assist, and shoot-out kicks weigh nothing.
    expect(stamp.finalMvp?.name).toBe('主队前锋');
    expect(stamp.finalMvp?.detail).toBe('2 球');
    expect(stamp.topScorer?.name).toBe('主队前锋');
    expect(stamp.topScorer?.detail).toBe('2 球');
  });

  it('gives the final honour to the side that lifted it, not the top scorer', () => {
    const world = baseWorld();
    const [home, away] = teamIds(world);
    const stamp = cupStampOf(withFinalEvents(world, [
      matchEvent('goal', home, 'p1', '主队前锋'),
      matchEvent('goal', away, 'p3', '客队前锋'),
      matchEvent('goal', away, 'p3', '客队前锋'),
      matchEvent('goal', away, 'p3', '客队前锋'),
    ]));

    expect(stamp.finalMvp?.name).toBe('主队前锋');
    // The golden boot still counts every club in the competition.
    expect(stamp.topScorer?.name).toBe('客队前锋');
    expect(stamp.topScorer?.detail).toBe('3 球');
  });

  it('prints nothing rather than inventing a hero when the final recorded no player', () => {
    const stamp = cupStampOf(withFinalEvents(baseWorld(), []));
    expect(stamp.finalMvp).toBeNull();
    expect(stamp.topScorer).toBeNull();
  });
});

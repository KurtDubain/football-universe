import { describe, it, expect } from 'vitest';
import {
  buildSeasonCalendar,
  insertWorldCupWindows,
  type CalendarBuildInput,
} from './calendar-builder';
import type { CalendarWindow } from '../../types/season';
import type { CupFixture } from '../../types/cup';

function win(id: number, type: CalendarWindow['type']): CalendarWindow {
  return {
    id,
    type,
    label: type,
    description: `w${id}`,
    fixtures: [],
    completed: false,
    results: [],
  };
}

function cupFixture(id: string, round: number): CupFixture {
  return {
    id,
    round,
    roundName: `R${round}`,
    homeTeamId: `home-${id}`,
    awayTeamId: `away-${id}`,
    isNeutralVenue: true,
  };
}

/** Three group rounds, as produced by the world cup draw. */
const GROUP_ROUNDS: CupFixture[][] = [
  [cupFixture('g1a', 1), cupFixture('g1b', 1)],
  [cupFixture('g2a', 2)],
  [cupFixture('g3a', 3)],
];

/** 3 group windows + R16 / QF / SF / final. */
const WORLD_CUP_WINDOW_COUNT = 7;

function baseCalendar(): CalendarWindow[] {
  return [
    win(0, 'league'),
    win(1, 'league'),
    win(2, 'relegation_playoff'),
    win(3, 'season_end'),
  ];
}

const typesOf = (calendar: CalendarWindow[]) => calendar.map(w => w.type);

describe('insertWorldCupWindows', () => {
  it('places the tournament between the relegation playoff and season end', () => {
    const result = insertWorldCupWindows(baseCalendar(), 8, GROUP_ROUNDS);
    expect(typesOf(result)).toEqual([
      'league',
      'league',
      'relegation_playoff',
      'world_cup_group',
      'world_cup_group',
      'world_cup_group',
      'world_cup',
      'world_cup',
      'world_cup',
      'world_cup',
      'season_end',
    ]);
  });

  it('keeps the tournament inside the season it belongs to', () => {
    const result = insertWorldCupWindows(baseCalendar(), 8, GROUP_ROUNDS);
    const seasonEndIdx = result.findIndex(w => w.type === 'season_end');
    const worldCupIdx = result.findIndex(
      w => w.type === 'world_cup_group' || w.type === 'world_cup',
    );
    // The winner must exist before settlement, so every world cup window
    // has to precede the season-end window.
    expect(worldCupIdx).toBeGreaterThan(-1);
    expect(seasonEndIdx).toBeGreaterThan(worldCupIdx);
    expect(result.at(-1)?.type).toBe('season_end');
  });

  it('adds exactly the seven world cup windows', () => {
    const calendar = baseCalendar();
    const result = insertWorldCupWindows(calendar, 8, GROUP_ROUNDS);
    expect(result).toHaveLength(calendar.length + WORLD_CUP_WINDOW_COUNT);
  });

  it('renumbers window ids to stay aligned with the array index', () => {
    const result = insertWorldCupWindows(baseCalendar(), 8, GROUP_ROUNDS);
    expect(result.map(w => w.id)).toEqual(result.map((_, i) => i));
    expect(new Set(result.map(w => w.id)).size).toBe(result.length);
  });

  it('drops the post-season wording from every world cup window', () => {
    const result = insertWorldCupWindows(baseCalendar(), 8, GROUP_ROUNDS);
    const worldCupWindows = result.filter(
      w => w.type === 'world_cup_group' || w.type === 'world_cup',
    );
    expect(worldCupWindows).toHaveLength(WORLD_CUP_WINDOW_COUNT);
    for (const w of worldCupWindows) {
      expect(w.description).not.toContain('赛季后');
      expect(w.description).toContain('第8赛季');
    }
  });

  it('carries the group fixtures and leaves the knockout rounds to be drawn', () => {
    const result = insertWorldCupWindows(baseCalendar(), 8, GROUP_ROUNDS);
    const groups = result.filter(w => w.type === 'world_cup_group');
    const knockouts = result.filter(w => w.type === 'world_cup');

    expect(groups.map(w => w.fixtures.length)).toEqual([2, 1, 1]);
    expect(groups[0].fixtures[0].competitionType).toBe('world_cup_group');
    expect(knockouts.map(w => w.label)).toEqual([
      '环球冠军杯 16强',
      '环球冠军杯 QF',
      '环球冠军杯 SF',
      '环球冠军杯 决赛',
    ]);
    // Populated by the window handler once the previous round is settled.
    expect(knockouts.every(w => w.fixtures.length === 0)).toBe(true);
  });

  it('does not mutate the calendar it was given', () => {
    const calendar = baseCalendar();
    const before = JSON.stringify(calendar);
    insertWorldCupWindows(calendar, 8, GROUP_ROUNDS);
    expect(JSON.stringify(calendar)).toBe(before);
  });

  it('falls back to appending when there is no season-end window', () => {
    // Never silently drop the tournament on an unexpected calendar shape.
    const calendar = [win(0, 'league'), win(1, 'relegation_playoff')];
    const result = insertWorldCupWindows(calendar, 8, GROUP_ROUNDS);
    expect(result).toHaveLength(calendar.length + WORLD_CUP_WINDOW_COUNT);
    expect(result.at(-1)?.type).toBe('world_cup');
  });
});

describe('buildSeasonCalendar + insertWorldCupWindows', () => {
  /** The builder indexes every round positionally, so all rounds must exist. */
  const rounds = (count: number) => Array.from({ length: count }, () => []);
  const input: CalendarBuildInput = {
    seasonNumber: 8,
    league1Fixtures: rounds(30),
    league2Fixtures: rounds(14),
    league3Fixtures: rounds(14),
    leagueCupR1Fixtures: [],
    superCupGroupRoundFixtures: rounds(6),
  };

  it('splices the tournament into a real season calendar', () => {
    const calendar = buildSeasonCalendar(input);
    const result = insertWorldCupWindows(calendar, 8, GROUP_ROUNDS);

    expect(result).toHaveLength(calendar.length + WORLD_CUP_WINDOW_COUNT);
    const playoffIdx = result.findIndex(w => w.type === 'relegation_playoff');
    const seasonEndIdx = result.findIndex(w => w.type === 'season_end');
    const firstGroupIdx = result.findIndex(w => w.type === 'world_cup_group');
    const finalIdx = result.findIndex(w => w.label === '环球冠军杯 决赛');

    expect(playoffIdx).toBeGreaterThan(-1);
    expect(firstGroupIdx).toBeGreaterThan(playoffIdx);
    expect(finalIdx).toBeGreaterThan(firstGroupIdx);
    expect(seasonEndIdx).toBeGreaterThan(finalIdx);
    expect(result.map(w => w.id)).toEqual(result.map((_, i) => i));
  });

  it('leaves a non-world-cup calendar untouched when insertion is skipped', () => {
    // Callers only insert on a world cup year; the base layout must not move.
    const calendar = buildSeasonCalendar(input);
    expect(calendar.at(-1)?.type).toBe('season_end');
    expect(calendar.some(w => w.type === 'world_cup' || w.type === 'world_cup_group'))
      .toBe(false);
    expect(calendar.map(w => w.id)).toEqual(calendar.map((_, i) => i));
  });
});

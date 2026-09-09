import { describe, expect, it } from 'vitest';
import type { StandingEntry } from '../types/league';
import type { CalendarWindow } from '../types/season';
import {
  formatChineseList,
  getSeasonWindowDisplay,
  getStandingPositionLabel,
  getStandingRank,
} from './format';

function windowAt(index: number, completed: boolean): CalendarWindow {
  return {
    id: index,
    type: 'league',
    label: `Round ${index + 1}`,
    description: '联赛',
    fixtures: [],
    results: [],
    completed,
  };
}

function standing(teamId: string, played: number): StandingEntry {
  return {
    teamId,
    played,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    form: [],
  };
}

describe('formatChineseList', () => {
  it('uses Chinese enumeration punctuation for multi-team summaries', () => {
    expect(formatChineseList([])).toBe('');
    expect(formatChineseList(['大同'])).toBe('大同');
    expect(formatChineseList(['大同', '辽宁'])).toBe('大同和辽宁');
    expect(formatChineseList(['常山', '红太阳', '北海道', '太原', '水手']))
      .toBe('常山、红太阳、北海道、太原和水手');
  });
});

describe('season display semantics', () => {
  it('separates completed windows from the current pending window', () => {
    const calendar = [windowAt(0, true), windowAt(1, true), windowAt(2, false)];

    expect(getSeasonWindowDisplay(calendar, 2)).toEqual({
      completedWindows: 2,
      totalWindows: 3,
      currentWindowNumber: 3,
    });
    expect(getSeasonWindowDisplay(calendar.map(window => ({ ...window, completed: true })), 3))
      .toEqual({ completedWindows: 3, totalWindows: 3, currentWindowNumber: null });
  });

  it('does not expose the seeded table order as a rank before any match', () => {
    const standings = [standing('alpha', 0), standing('target', 0)];
    expect(getStandingPositionLabel(standings, 'target')).toBe('排名未形成');
    expect(getStandingRank(standings, 'target')).toBeNull();

    standings[1] = { ...standings[1], played: 1, points: 1 };
    expect(getStandingPositionLabel(standings, 'target')).toBe('#2');
    expect(getStandingRank(standings, 'target')).toBe(2);
  });
});

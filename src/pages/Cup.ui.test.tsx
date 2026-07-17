// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CupFixture, CupRound } from '../types/cup';
import type { TeamBase, TeamState } from '../types/team';
import { BracketView } from './Cup';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function team(id: string, name: string, shortName: string, color: string): TeamBase {
  return {
    id,
    name,
    shortName,
    color,
    tier: 'mid',
    overall: 80,
    attack: 80,
    midfield: 80,
    defense: 80,
    stability: 80,
    depth: 80,
    reputation: 80,
    initialLeagueLevel: 1,
    expectation: 3,
    region: '大陆+测试',
  };
}

const teamBases = {
  a: team('a', '广州恒大足球俱乐部', '恒大', '#ef4444'),
  b: team('b', '北京国安足球俱乐部', '国安', '#22c55e'),
  c: team('c', '山东泰山足球俱乐部', '泰山', '#f97316'),
  d: team('d', '上海申花足球俱乐部', '申花', '#3b82f6'),
};

const teamStates = Object.fromEntries(Object.keys(teamBases).map(id => [id, {
  id,
  leagueLevel: 1,
  morale: 60,
  fatigue: 10,
  momentum: 0,
  squadHealth: 90,
  coachPressure: 10,
  recentForm: [],
}])) as Record<string, TeamState>;

function fixture(id: string, round: number, roundName: string, homeTeamId: string, awayTeamId: string): CupFixture {
  return { id, round, roundName, homeTeamId, awayTeamId };
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(rounds: CupRound[]) {
  act(() => root.render(
    <BracketView rounds={rounds} tb={teamBases} ts={teamStates} onClick={() => undefined} />,
  ));
}

describe('mobile cup bracket', () => {
  it('uses a full-width two-column list for a large single round and compact team names', () => {
    render([{
      roundNumber: 1,
      roundName: 'R32',
      completed: false,
      fixtures: [
        fixture('f1', 1, 'R32', 'a', 'b'),
        fixture('f2', 1, 'R32', 'c', 'd'),
      ],
    }]);

    const panel = container.querySelector<HTMLElement>('[role="tabpanel"]')!;
    expect(panel.querySelector('.grid-cols-2')).not.toBeNull();
    expect(panel.textContent).toContain('恒大');
    expect(panel.textContent).toContain('国安');
    expect(panel.textContent).not.toContain('广州恒大足球俱乐部');
    expect(panel.querySelectorAll('button.w-full')).toHaveLength(2);
  });

  it('switches between rounds instead of compressing the whole bracket', () => {
    render([
      {
        roundNumber: 1,
        roundName: 'R32',
        completed: true,
        fixtures: [fixture('f1', 1, 'R32', 'a', 'b')],
      },
      {
        roundNumber: 2,
        roundName: 'R16',
        completed: false,
        fixtures: [fixture('f2', 2, 'R16', 'c', 'd')],
      },
    ]);

    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs).toHaveLength(2);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');

    act(() => tabs[0].click());
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain('恒大');
  });
});

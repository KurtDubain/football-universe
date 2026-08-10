// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CupFixture, CupRound } from '../types/cup';
import type { TeamBase, TeamState } from '../types/team';
import { BracketView } from '../components/CupBracket';
import { buildDisplayRounds, buildMergedRounds } from '../components/cup-bracket-model';

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
  localStorage.clear();
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
  it('opens as a classic bracket and completes the visible route to the trophy', () => {
    const teamIds = ['a', 'b', 'c', 'd'];
    render([{
      roundNumber: 1,
      roundName: 'R32',
      completed: false,
      fixtures: Array.from({ length: 16 }, (_, index) => (
        fixture(`f${index}`, 1, 'R32', teamIds[index % teamIds.length], teamIds[(index + 1) % teamIds.length])
      )),
    }]);

    expect(container.querySelector('[data-testid="classic-bracket"]')).not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[aria-controls="cup-bracket-panel"]')?.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[data-bracket-round="32强"]')).not.toBeNull();
    expect(container.querySelector('[data-bracket-round="16强"]')).not.toBeNull();
    expect(container.querySelector('[data-bracket-round="八强"]')).not.toBeNull();
    expect(container.querySelector('[data-bracket-round="半决赛"]')).not.toBeNull();
    expect(container.querySelector('[data-bracket-round="决赛"]')).not.toBeNull();
    expect(container.textContent).toContain('冠军');
    expect(container.textContent).toContain('恒大');
    expect(container.textContent).not.toContain('广州恒大足球俱乐部');
  });

  it('keeps the compact round list as a persisted alternative', () => {
    render([{
      roundNumber: 1,
      roundName: 'R32',
      completed: false,
      fixtures: [fixture('f1', 1, 'R32', 'a', 'b'), fixture('f2', 1, 'R32', 'c', 'd')],
    }]);

    const listTab = container.querySelector<HTMLButtonElement>('[aria-controls="cup-list-panel"]')!;
    act(() => listTab.click());
    const panel = container.querySelector<HTMLElement>('#cup-list-panel')!;
    expect(panel.querySelector('.grid-cols-2')).not.toBeNull();
    expect(panel.textContent).toContain('恒大');
    expect(panel.textContent).toContain('国安');
    expect(panel.textContent).not.toContain('广州恒大足球俱乐部');
    expect(panel.querySelectorAll('button.w-full')).toHaveLength(2);
    expect(localStorage.getItem('football-universe:cup-bracket-view-v1')).toBe('list');
  });

  it('opens the list on the first incomplete round and can inspect completed rounds', () => {
    localStorage.setItem('football-universe:cup-bracket-view-v1', 'list');
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

    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[aria-label="杯赛轮次"] [role="tab"]')];
    expect(tabs).toHaveLength(2);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');

    act(() => tabs[0].click());
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain('恒大');
  });

  it('keeps an unfinished first leg grouped into its eventual two-legged tie', () => {
    const merged = buildMergedRounds([{
      roundNumber: 1,
      roundName: 'QF-L1',
      completed: false,
      fixtures: [fixture('qf-1', 1, 'QF-L1', 'a', 'b')],
    }]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ label: '八强', twoLegged: true, completed: false });
    expect(merged[0].ties[0].leg2).toBeNull();
  });

  it('pairs reversed second legs by team identity and calculates aggregate scores', () => {
    const firstA = fixture('qf-a-1', 1, 'QF-L1', 'a', 'b');
    firstA.result = { home: 2, away: 1 };
    const firstB = fixture('qf-b-1', 1, 'QF-L1', 'c', 'd');
    firstB.result = { home: 0, away: 1 };
    const secondB = fixture('qf-b-2', 2, 'QF-L2', 'd', 'c');
    secondB.result = { home: 2, away: 2 };
    secondB.winnerId = 'd';
    const secondA = fixture('qf-a-2', 2, 'QF-L2', 'b', 'a');
    secondA.result = { home: 1, away: 3 };
    secondA.winnerId = 'a';

    const merged = buildMergedRounds([
      { roundNumber: 1, roundName: 'QF-L1', completed: true, fixtures: [firstA, firstB] },
      { roundNumber: 2, roundName: 'QF-L2', completed: true, fixtures: [secondB, secondA] },
    ]);

    expect(merged[0].ties[0]).toMatchObject({ leg2: secondA, agg1: 5, agg2: 2, winnerId: 'a' });
    expect(merged[0].ties[1]).toMatchObject({ leg2: secondB, agg1: 2, agg2: 3, winnerId: 'd' });
  });

  it('adds future rounds without inventing teams or fixtures', () => {
    const merged = buildMergedRounds([{
      roundNumber: 1,
      roundName: 'R16',
      completed: false,
      fixtures: Array.from({ length: 8 }, (_, index) => fixture(`r16-${index}`, 1, 'R16', 'a', 'b')),
    }]);
    const display = buildDisplayRounds(merged);

    expect(display.map(round => [round.label, round.ties.length])).toEqual([
      ['16强', 8],
      ['八强', 4],
      ['半决赛', 2],
      ['决赛', 1],
    ]);
    expect(display.slice(1).every(round => round.synthetic)).toBe(true);
    expect(display.slice(1).flatMap(round => round.ties).every(tie => tie.leg1 === null && tie.team1Id === '')).toBe(true);
  });
});

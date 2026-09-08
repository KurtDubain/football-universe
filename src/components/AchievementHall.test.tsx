// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Achievement } from '../engine/achievements';
import type { TeamBase } from '../types/team';
import AchievementHall from './AchievementHall';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function achievement(type: string, teamId: string, seasonNumber = 1): Achievement {
  return {
    id: `${type}-${teamId}-S${seasonNumber}`,
    title: type === 'first_relegation' ? '降级深渊' : `成就 ${type}`,
    description: `${teamId} 的原始成就描述`,
    seasonNumber,
    teamId,
  };
}

function team(teamId: string): TeamBase {
  return {
    id: teamId,
    name: `球队 ${teamId}`,
    shortName: teamId,
    color: '#4ade80',
    tier: 'mid',
    overall: 70,
    attack: 70,
    midfield: 70,
    defense: 70,
    stability: 70,
    depth: 70,
    reputation: 70,
    initialLeagueLevel: 1,
    expectation: 3,
    region: '大陆+测试',
  };
}

function renderHall(achievements: Achievement[], followedTeamIds: string[] = []) {
  const ids = [...new Set(achievements.map(row => row.teamId).filter((id): id is string => !!id))];
  const teamBases = Object.fromEntries(ids.map(id => [id, team(id)]));
  act(() => root.render(
    <MemoryRouter>
      <AchievementHall achievements={achievements} followedTeamIds={followedTeamIds} teamBases={teamBases} />
    </MemoryRouter>,
  ));
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

describe('AchievementHall', () => {
  it('expands a group to reveal every original achievement', () => {
    const achievements = ['a', 'b', 'c'].map(id => achievement('first_relegation', id));
    renderHall(achievements);

    const groupButton = container.querySelector<HTMLButtonElement>('[data-testid="achievement-group"] button')!;
    expect(groupButton.getAttribute('aria-expanded')).toBe('false');
    expect(groupButton.getAttribute('aria-label')).toContain('3支球队');
    expect(container.querySelectorAll('[data-testid="achievement-group-entry"]')).toHaveLength(0);

    act(() => groupButton.click());
    expect(groupButton.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelectorAll('[data-testid="achievement-group-entry"]')).toHaveLength(3);
    expect(container.textContent).toContain('a 的原始成就描述');
    expect(container.textContent).toContain('c 的原始成就描述');
  });

  it('shows no more than six items before view-all and keeps followed achievements visible', () => {
    const achievements = Array.from({ length: 8 }, (_, index) => (
      achievement(`unique_${index}`, `team-${index}`, index + 1)
    ));
    renderHall(achievements, ['team-7']);

    expect(container.querySelectorAll('[data-testid="achievement-card"]')).toHaveLength(6);
    expect(container.querySelector('[data-followed="true"]')?.textContent).toContain('成就 unique_7');
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="toggle-all-achievements"]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelectorAll('[data-testid="achievement-card"]')).toHaveLength(8);
  });
});

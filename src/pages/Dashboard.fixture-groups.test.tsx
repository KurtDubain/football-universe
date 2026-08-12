// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeGameWorld } from '../engine/season/season-manager';
import { useGameStore } from '../store/game-store';
import type { MatchFixture } from '../types/match';
import { FixtureGroupList } from './Dashboard';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

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

describe('Dashboard fixture groups', () => {
  it('opens the observed competition and does not render collapsed fixture cards', () => {
    const world = initializeGameWorld(20260813);
    const window = world.seasonState.calendar.find(entry => entry.fixtures.length > 0)!;
    const groupMap = new Map<string, MatchFixture[]>();
    for (const fixture of window.fixtures) {
      const key = fixture.competitionName || fixture.competitionType;
      groupMap.set(key, [...(groupMap.get(key) ?? []), fixture]);
    }
    const groups = [...groupMap.entries()];
    expect(groups.length).toBeGreaterThan(1);
    const primaryTeamId = groups[0][1][0].homeTeamId;
    const defaultGroup = groups.find(([, fixtures]) => fixtures.some(fixture => (
      fixture.homeTeamId === primaryTeamId || fixture.awayTeamId === primaryTeamId
    )))!;
    const defaultName = defaultGroup[0];
    const focusFixture = defaultGroup[1][0];
    useGameStore.setState({ world, starredFixtureIds: [] });

    act(() => root.render(
      <FixtureGroupList
        groups={groups}
        world={world}
        primaryTeamId={primaryTeamId}
        focusFixtureIds={new Set([focusFixture.id])}
        teamTopScorers={{}}
        onFixtureClick={() => undefined}
      />,
    ));

    const toggles = container.querySelectorAll<HTMLButtonElement>('[data-testid="fixture-group-toggle"]');
    expect(toggles).toHaveLength(groups.length);
    expect(container.querySelectorAll('[data-testid="fixture-group-content"]')).toHaveLength(1);
    expect(container.querySelectorAll('.fixture-sheet')).toHaveLength(defaultGroup[1].length - 1);

    const secondGroup = groups.find(([name]) => name !== defaultName)!;
    const secondToggle = [...toggles].find(button => button.dataset.groupName === secondGroup[0])!;
    act(() => secondToggle.click());

    expect(container.querySelectorAll('[data-testid="fixture-group-content"]')).toHaveLength(2);
    expect(container.querySelectorAll('.fixture-sheet')).toHaveLength(
      defaultGroup[1].length - 1 + secondGroup[1].length,
    );
  });
});

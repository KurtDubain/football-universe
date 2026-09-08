// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCurrentWindow, initializeGameWorld } from '../engine/season/season-manager';
import { SAVE_STORAGE_KEY } from '../store/save-schema';
import { useGameStore } from '../store/game-store';
import { ResultsTab } from './Dashboard';

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

describe('Dashboard results navigation', () => {
  it('returns to the current unplayed Matchday without advancing or persisting world state', () => {
    const initial = initializeGameWorld(20260908);
    const completed = executeCurrentWindow(initial);
    useGameStore.setState({
      world: completed.world,
      initialized: true,
      lastResults: completed.results,
      lastNews: completed.news,
      lastObservationSettlements: [],
      lastWorldResponse: null,
      isAdvancing: false,
      advanceTick: 1,
      favoriteTeamId: null,
      favoriteTeamIds: [],
      favoritePlayerIds: [],
      starredFixtureIds: [],
    });
    const onObserveNext = vi.fn();

    act(() => root.render(
      <MemoryRouter>
        <ResultsTab
          world={completed.world}
          lastResults={completed.results}
          lastNews={completed.news}
          onResultClick={() => undefined}
          onLiveView={() => undefined}
          onSeasonReview={() => undefined}
          onObserveNext={onObserveNext}
        />
      </MemoryRouter>,
    ));

    const beforeWorld = structuredClone(useGameStore.getState().world);
    const beforeResults = structuredClone(useGameStore.getState().lastResults);
    const beforeTick = useGameStore.getState().advanceTick;
    const beforeSave = localStorage.getItem(SAVE_STORAGE_KEY);
    const action = container.querySelector<HTMLButtonElement>('[data-testid="results-return-to-matchday"]');

    expect(action?.getAttribute('aria-label')).toBe('返回当前未赛比赛日');
    expect(container.querySelector('[data-testid="dashboard-advance"]')).toBeNull();
    act(() => action?.click());

    expect(onObserveNext).toHaveBeenCalledOnce();
    expect(useGameStore.getState().world).toEqual(beforeWorld);
    expect(useGameStore.getState().lastResults).toEqual(beforeResults);
    expect(useGameStore.getState().advanceTick).toBe(beforeTick);
    expect(localStorage.getItem(SAVE_STORAGE_KEY)).toBe(beforeSave);
  });
});
